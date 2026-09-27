import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { ImportJob, TranslationContextTurn } from '../src/local/contracts';
import type { LocalStore } from './database';
import { LocalServerError } from './errors';
import type { InferenceClient } from './inference';

const SAMPLE_RATE = 16_000;
const CHUNK_SECONDS = 30;
const OVERLAP_SECONDS = 1;

type Options = {
  readonly getStore: () => LocalStore;
  readonly inference: InferenceClient;
  readonly ffmpegPath: string;
  readonly importTimeoutMs: number;
};

export async function receiveImportFile(request: Request, path: string, limit: number): Promise<number> {
  if (request.body === null) throw new LocalServerError('INVALID_FILE', 400, 'An audio file is required');
  const declared = Number(request.headers.get('content-length'));
  if (declared > limit) throw new LocalServerError('PAYLOAD_TOO_LARGE', 413, 'Audio file is too large');
  const file = await open(path, 'wx', 0o600);
  const reader = request.body.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) throw new LocalServerError('PAYLOAD_TOO_LARGE', 413, 'Audio file is too large');
      let written = 0;
      while (written < value.byteLength) {
        const result = await file.write(value, written, value.byteLength - written);
        if (result.bytesWritten === 0) throw new Error('Audio upload stopped writing');
        written += result.bytesWritten;
      }
    }
    if (received === 0) throw new LocalServerError('INVALID_FILE', 400, 'An audio file is required');
    return received;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    await file.close();
  }
}

export class ImportJobRunner {
  readonly #options: Options;
  readonly #tasks = new Map<string, Promise<void>>();
  #resumed = false;

  constructor(options: Options) { this.#options = options; }

  resume(): void {
    if (this.#resumed) return;
    const store = this.#options.getStore();
    this.#resumed = true;
    for (const job of store.listUnfinishedImportJobs()) this.start(job.id);
  }

  start(id: string): void {
    if (this.#tasks.has(id)) return;
    const task = this.#process(id).catch((error: unknown) => {
      const store = this.#options.getStore();
      const job = store.getImportJob(id);
      if (job !== null) store.saveImportJob({ ...job, state: 'failed', error: error instanceof Error ? error.message : 'Import failed' });
    }).finally(() => { this.#tasks.delete(id); });
    this.#tasks.set(id, task);
  }

  async #process(id: string): Promise<void> {
    const store = this.#options.getStore();
    let job = store.getImportJob(id);
    if (job === null) throw new LocalServerError('NOT_FOUND', 404, 'Import job not found');
    const meeting = store.getMeeting(job.meetingId);
    if (meeting === null) throw new LocalServerError('NOT_FOUND', 404, 'Imported meeting not found');
    const directory = store.importJobDirectory(id);
    const source = join(directory, 'source');
    const wav = join(directory, 'decoded.wav');
    const startedAt = performance.now();
    const sampleRss = (): void => {
      job = { ...job!, metrics: { ...job!.metrics, peakRssBytes: Math.max(job!.metrics.peakRssBytes, process.memoryUsage().rss) } };
    };
    const memoryTimer = setInterval(sampleRss, 500);
    const save = (patch: Partial<ImportJob>): void => {
      sampleRss();
      job = { ...job!, ...patch };
      store.saveImportJob(job);
    };
    try {
      save({ state: 'processing', stage: 'decoding', error: null });
      const decodeStarted = performance.now();
      if (!(await Bun.file(wav).exists())) {
        const partial = join(directory, 'decoded.part.wav');
        await rm(partial, { force: true });
        try {
          await runFfmpeg(this.#options.ffmpegPath, source, partial, this.#options.importTimeoutMs);
          await rename(partial, wav);
        } catch (error) {
          await rm(partial, { force: true });
          throw error;
        }
      }
      const audio = await inspectWav(wav);
      const totalChunks = Math.ceil(audio.duration / CHUNK_SECONDS);
      if (totalChunks === 0 || audio.duration > 86_400) throw new LocalServerError('INVALID_FILE', 422, 'Audio duration must be between 0 and 24 hours');
      save({ totalChunks, stage: 'transcribing', metrics: { ...job!.metrics, decodeMs: job!.metrics.decodeMs + performance.now() - decodeStarted } });

      for (let sequence = 0; sequence < totalChunks; sequence += 1) {
        if (store.getChunkReceipt(job!.meetingId, sequence) !== null) {
          save({ completedChunks: Math.max(job!.completedChunks, sequence + 1) });
          continue;
        }
        const nominalStart = sequence * CHUNK_SECONDS;
        const nominalEnd = Math.min(audio.duration, nominalStart + CHUNK_SECONDS);
        const start = Math.max(0, nominalStart - OVERLAP_SECONDS);
        const end = Math.min(audio.duration, nominalEnd + OVERLAP_SECONDS);
        const chunk = await readWavChunk(wav, audio.dataOffset, start, end);
        const silenceStarted = performance.now();
        const silent = isDigitalSilence(chunk.pcm);
        const silenceMs = job!.metrics.silenceMs + performance.now() - silenceStarted;
        const asrStarted = performance.now();
        const recognized = silent
          ? []
          : await this.#options.inference.transcribe(chunk.blob, {
              sequence, start, duration: end - start, language: meeting.language, interpret: false,
            });
        const previous = sequence === 0 ? [] : store.getChunkReceipt(job!.meetingId, sequence - 1)?.segments ?? [];
        const segments = recognized.filter((segment) => !previous.some((item) => sameBoundaryUtterance(item, segment)));
        store.persistChunk(job!.meetingId, sequence, segments);
        const firstTranscriptMs = job!.metrics.firstTranscriptMs ?? (segments.length > 0 ? job!.metrics.uploadMs + performance.now() - startedAt : null);
        save({ completedChunks: sequence + 1, metrics: { ...job!.metrics, silenceMs, asrMs: job!.metrics.asrMs + performance.now() - asrStarted, firstTranscriptMs } });
      }

      save({ stage: 'saving' });
      const saveStarted = performance.now();
      await store.saveAudioFromPath(job!.meetingId, wav);
      save({ metrics: { ...job!.metrics, saveMs: job!.metrics.saveMs + performance.now() - saveStarted } });

      if (meeting.interpret && meeting.language === 'ja') {
        save({ stage: 'translating' });
        let lastBatchAt = performance.now();
        const turns: TranslationContextTurn[] = [];
        const segments = store.getMeeting(job!.meetingId)?.segments ?? [];
        let translationErrors = 0;
        let translatedSegments = segments.filter((segment) => segment.translation !== null).length;
        for (let offset = 0; offset < segments.length; offset += 8) {
          const batch = segments.slice(offset, offset + 8);
          const pending = batch.filter((segment) => segment.translation === null);
          let translated = new Map<string, string>();
          if (pending.length > 0 && this.#options.inference.translateBatch !== undefined) {
            try {
              const result = await this.#options.inference.translateBatch(
                pending.map((segment) => ({ id: segment.id, start: segment.start, end: segment.end, speakerId: null, text: segment.sourceText })), turns.slice(-2),
              );
              translated = new Map(result.map((item) => [item.id, item.text]));
            } catch {
              translated = new Map();
            }
          }
          for (const segment of batch) {
            if (segment.translation !== null) {
              turns.push({ sourceText: segment.sourceText, translation: segment.translation });
              continue;
            }
            try {
              const text = translated.get(segment.id)
                ?? (await this.#options.inference.translate(segment.sourceText, turns.slice(-2))).text;
              store.updateSegmentTranslation(job!.meetingId, segment.id, text, null);
              turns.push({ sourceText: segment.sourceText, translation: text });
              translatedSegments += 1;
            } catch (error) {
              store.updateSegmentTranslation(job!.meetingId, segment.id, null, error instanceof Error ? error.message : 'Translation failed');
              translationErrors += 1;
            }
          }
          const batchFinishedAt = performance.now();
          save({ metrics: { ...job!.metrics, translatedSegments, translateMs: job!.metrics.translateMs + batchFinishedAt - lastBatchAt } });
          lastBatchAt = batchFinishedAt;
        }
        if (translationErrors > 0) throw new LocalServerError('TRANSLATION_FAILED', 502, `${translationErrors} translation segments failed; retry to resume`);
      }
      save({ state: 'completed', stage: 'completed', metrics: { ...job!.metrics, totalMs: job!.metrics.uploadMs + performance.now() - startedAt } });
      await rm(directory, { recursive: true, force: true });
    } finally {
      clearInterval(memoryTimer);
    }
  }
}

async function runFfmpeg(executable: string, source: string, output: string, timeoutMs: number): Promise<void> {
  const child = Bun.spawn([executable, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
    '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', output], { stdout: 'ignore', stderr: 'pipe' });
  const timeout = setTimeout(() => child.kill(), timeoutMs);
  try {
    if (await child.exited !== 0) {
      const detail = (await new Response(child.stderr).text()).trim();
      throw new LocalServerError('CONVERSION_FAILED', 422, detail || 'Audio conversion failed');
    }
  } finally { clearTimeout(timeout); }
}

async function inspectWav(path: string): Promise<{ readonly dataOffset: number; readonly duration: number }> {
  const size = (await stat(path)).size;
  const header = new DataView(await Bun.file(path).slice(0, Math.min(size, 4096)).arrayBuffer());
  const fourcc = (offset: number): string => String.fromCharCode(...new Uint8Array(header.buffer, offset, 4));
  if (size < 44 || fourcc(0) !== 'RIFF' || fourcc(8) !== 'WAVE') throw new LocalServerError('CONVERSION_FAILED', 422, 'Invalid converted WAV');
  let offset = 12;
  let formatValid = false;
  while (offset + 8 <= header.byteLength) {
    const type = fourcc(offset);
    const length = header.getUint32(offset + 4, true);
    if (type === 'fmt ') formatValid = length >= 16 && header.getUint16(offset + 8, true) === 1
      && header.getUint16(offset + 10, true) === 1 && header.getUint32(offset + 12, true) === SAMPLE_RATE
      && header.getUint16(offset + 22, true) === 16;
    if (type === 'data') {
      if (!formatValid) throw new LocalServerError('CONVERSION_FAILED', 422, 'Unexpected converted WAV format');
      const dataOffset = offset + 8;
      return { dataOffset, duration: Math.floor((size - dataOffset) / 2) / SAMPLE_RATE };
    }
    offset += 8 + length + (length % 2);
  }
  throw new LocalServerError('CONVERSION_FAILED', 422, 'Converted WAV has no audio data');
}

async function readWavChunk(path: string, dataOffset: number, start: number, end: number): Promise<{ readonly blob: Blob; readonly pcm: Uint8Array }> {
  const startSample = Math.round(start * SAMPLE_RATE);
  const endSample = Math.round(end * SAMPLE_RATE);
  const pcm = new Uint8Array(await Bun.file(path).slice(dataOffset + startSample * 2, dataOffset + endSample * 2).arrayBuffer());
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (at: number, text: string): void => { for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, pcm.byteLength, true);
  return { pcm, blob: new Blob([header, pcm], { type: 'audio/wav' }) };
}

function isDigitalSilence(pcm: Uint8Array): boolean {
  for (let index = 0; index + 1 < pcm.byteLength; index += 2) {
    if (pcm[index] !== 0 || pcm[index + 1] !== 0) return false;
  }
  return true;
}

function sameBoundaryUtterance(left: { readonly start: number; readonly end: number; readonly sourceText: string }, right: { readonly start: number; readonly end: number; readonly sourceText: string }): boolean {
  const normalize = (text: string): string => text.normalize('NFKC').replace(/[\s\p{P}]/gu, '');
  return normalize(left.sourceText) === normalize(right.sourceText)
    && Math.abs(left.start - right.start) <= 1.5
    && Math.abs(left.end - right.end) <= 1.5;
}

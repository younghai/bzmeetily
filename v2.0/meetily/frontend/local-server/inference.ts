import { z } from 'zod';

import { serviceStatusSchema, translationSchema, type LocalSegment } from '../src/local/contracts';
import { LocalServerError } from './errors';

export interface InferenceClient {
  status(): Promise<{
    readonly ready: boolean;
    readonly whisper: { readonly ready: boolean; readonly model: string; readonly error: string | null };
    readonly ollama: { readonly ready: boolean; readonly model: string; readonly error: string | null };
  }>;
  transcribe(audio: Blob, context: TranscriptionContext): Promise<readonly LocalSegment[]>;
  translate(text: string, signal?: AbortSignal): Promise<{ readonly text: string; readonly elapsedMs: number }>;
  summarize(transcript: string): Promise<string>;
}

type TranscriptionContext = {
  readonly sequence: number;
  readonly start: number;
  readonly duration: number;
  readonly language: string;
  readonly interpret: boolean;
  readonly signal?: AbortSignal;
  readonly minimumLanguageProbability?: number;
};

type InferenceOptions = {
  readonly whisperUrl: string;
  readonly whisperModel: string;
  readonly ollamaUrl: string;
  readonly ollamaModel: string;
  readonly timeoutMs: number;
  readonly queueLimit: number;
};

const whisperResponseSchema = z.object({
  text: z.string().default(''),
  language_probabilities: z.record(z.number()).optional(),
  segments: z.array(z.object({
    text: z.string(),
    start: z.number().optional(),
    end: z.number().optional(),
    offsets: z.object({ from: z.number(), to: z.number() }).optional(),
  })).optional(),
});
const ollamaResponseSchema = z.object({ message: z.object({ content: z.string() }) });
const ollamaTagsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });
const koreanSchema = z.object({ ko: z.string().trim().min(1) });
const markdownSchema = z.object({ markdown: z.string().trim().min(1) });

class SerialQueue {
  #tail: Promise<void> = Promise.resolve();
  #pending = 0;
  readonly #limit: number;

  constructor(limit: number) { this.#limit = limit; }

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    if (this.#pending >= this.#limit) throw new LocalServerError('INFERENCE_BUSY', 429, 'Local inference queue is full');
    this.#pending += 1;
    const previous = this.#tail;
    let release: () => void = () => undefined;
    this.#tail = new Promise((resolve) => { release = resolve; });
    let acquired = false;
    try {
      await waitForTurn(previous, signal);
      throwIfAborted(signal);
      acquired = true;
      return await operation();
    } finally {
      this.#pending -= 1;
      if (acquired) release();
      else void previous.then(release);
    }
  }
}

async function waitForTurn(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return previous;
  throwIfAborted(signal);
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { await Promise.race([previous, aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('This operation was aborted', 'AbortError');
}

async function parseInferenceResponse<T>(response: Response, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  try { return schema.parse(await response.json()); }
  catch (error) { return rethrowInvalidInferenceResponse(error); }
}

function parseInferenceContent<T>(content: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  try { return schema.parse(JSON.parse(content)); }
  catch (error) { return rethrowInvalidInferenceResponse(error); }
}

function rethrowInvalidInferenceResponse(error: unknown): never {
  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    throw new LocalServerError('INFERENCE_FAILED', 502, 'Local inference returned an invalid response');
  }
  throw error;
}

export class LocalInference implements InferenceClient {
  readonly #options: InferenceOptions;
  readonly #whisperQueue: SerialQueue;
  readonly #ollamaQueue: SerialQueue;

  constructor(options: InferenceOptions) {
    this.#options = options;
    this.#whisperQueue = new SerialQueue(options.queueLimit);
    this.#ollamaQueue = new SerialQueue(options.queueLimit);
  }

  async status() {
    const [whisper, ollama] = await Promise.all([this.#whisperStatus(), this.#ollamaStatus()]);
    return serviceStatusSchema.parse({ ready: whisper.ready && ollama.ready, whisper, ollama });
  }

  async transcribe(audio: Blob, context: TranscriptionContext): Promise<readonly LocalSegment[]> {
    const result = await this.#whisperQueue.run(async () => {
      const form = new FormData();
      form.set('file', audio, 'chunk.wav');
      form.set('response_format', 'verbose_json');
      form.set('language', context.language);
      form.set('temperature', '0');
      const response = await this.#request(`${this.#options.whisperUrl}/inference`, { method: 'POST', body: form }, context.signal);
      return parseInferenceResponse(response, whisperResponseSchema);
    }, context.signal);
    const languageProbabilities = result.language_probabilities;
    const languageProbability = languageProbabilities === undefined || Object.keys(languageProbabilities).length === 0
      ? undefined
      : languageProbabilities[context.language] ?? 0;
    if (context.minimumLanguageProbability !== undefined
      && languageProbability !== undefined
      && languageProbability < context.minimumLanguageProbability) return [];
    const rawSegments = result.segments ?? (result.text.trim().length === 0 ? [] : [{ text: result.text, start: 0, end: context.duration }]);
    const segments: LocalSegment[] = [];
    for (const [index, raw] of rawSegments.entries()) {
      const sourceText = raw.text.trim();
      if (sourceText.length === 0) continue;
      let translation: string | null = null;
      let translationError: string | null = null;
      if (context.interpret && context.language === 'ja') {
        try { translation = await this.#ollamaQueue.run(() => this.#translateDirect(sourceText, context.signal), context.signal); } catch (error) {
          if (context.signal?.aborted === true) throw abortReason(context.signal);
          translationError = error instanceof Error ? error.message : 'Translation failed';
        }
      }
      const whisperStart = raw.start ?? (raw.offsets === undefined ? 0 : raw.offsets.from / 1000);
      const whisperEnd = raw.end ?? (raw.offsets === undefined ? context.duration : raw.offsets.to / 1000);
      const relativeStart = Math.max(0, Math.min(whisperStart, context.duration));
      const relativeEnd = Math.max(relativeStart, Math.min(whisperEnd, context.duration));
      segments.push({
        id: `segment-${crypto.randomUUID()}`,
        sequence: context.sequence * 1000 + index,
        start: context.start + relativeStart,
        end: context.start + relativeEnd,
        sourceText,
        translation,
        translationError,
      });
    }
    return segments;
  }

  async translate(text: string, signal?: AbortSignal) {
    const startedAt = performance.now();
    const translated = await this.#ollamaQueue.run(() => this.#translateDirect(text, signal), signal);
    return translationSchema.parse({ text: translated, elapsedMs: performance.now() - startedAt });
  }

  async summarize(transcript: string): Promise<string> {
    return this.#ollamaQueue.run(async () => {
      const content = await this.#ollama(
        '당신은 한국어 회의록 작성자입니다. 제공된 발언에만 근거해 Markdown으로 핵심 논의, 결정, 다음 단계를 정리하세요. 불명확하거나 근거가 없는 내용은 추정하지 말고 확인 필요로 표시하세요.',
        transcript,
        { type: 'object', properties: { markdown: { type: 'string' } }, required: ['markdown'] },
      );
      return parseInferenceContent(content, markdownSchema).markdown;
    });
  }

  async #translateDirect(text: string, signal?: AbortSignal): Promise<string> {
    const content = await this.#ollama(
      '일본어 발언을 자연스럽고 충실한 한국어로 번역하세요. 통역 전문 용어는 정확히 옮기고 同時通訳는 동시통역으로 번역하세요. 고유명사는 임의로 음역하거나 바꾸지 말고, 불확실하면 원문을 보존하세요. 설명이나 추측을 추가하지 마세요.',
      text,
      { type: 'object', properties: { ko: { type: 'string' } }, required: ['ko'] },
      signal,
    );
    return parseInferenceContent(content, koreanSchema).ko;
  }

  async #ollama(system: string, content: string, format: object, signal?: AbortSignal): Promise<string> {
    const response = await this.#request(`${this.#options.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.#options.ollamaModel, messages: [{ role: 'system', content: system }, { role: 'user', content }], stream: false, think: false, keep_alive: '5m', format, options: { temperature: 0 } }),
    }, signal);
    return (await parseInferenceResponse(response, ollamaResponseSchema)).message.content;
  }

  // Status probes must fail fast: they reuse #request's inference timeout
  // (180s), so a hung service would stack minutes-long polls. 5s is plenty
  // for a loopback health check.
  async #probe(url: string): Promise<Response | null> {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(5_000) });
    } catch {
      return null;
    }
  }

  async #whisperStatus() {
    const response = await this.#probe(`${this.#options.whisperUrl}/health`);
    if (response === null) return { ready: false, model: this.#options.whisperModel, error: 'Unavailable' };
    return { ready: response.ok, model: this.#options.whisperModel, error: response.ok ? null : `HTTP ${response.status}` };
  }

  async #ollamaStatus() {
    const response = await this.#probe(`${this.#options.ollamaUrl}/api/tags`);
    if (response === null) return { ready: false, model: this.#options.ollamaModel, error: 'Unavailable' };
    if (!response.ok) return { ready: false, model: this.#options.ollamaModel, error: `HTTP ${response.status}` };
    try {
      const tags = ollamaTagsSchema.parse(await response.json());
      const ready = tags.models.some((model) => model.name === this.#options.ollamaModel);
      return { ready, model: this.#options.ollamaModel, error: ready ? null : 'Configured model is not installed' };
    } catch {
      return { ready: false, model: this.#options.ollamaModel, error: 'Unavailable' };
    }
  }

  async #request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const timeoutSignal = AbortSignal.timeout(this.#options.timeoutMs);
    const requestSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
    const response = await fetch(url, { ...init, signal: requestSignal });
    if (!response.ok) throw new LocalServerError('INFERENCE_FAILED', 502, `Local inference returned HTTP ${response.status}`);
    return response;
  }
}

import { afterEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createLocalApp } from '../../local-server/app';
import { LocalStore } from '../../local-server/database';
import type { InferenceClient } from '../../local-server/inference';
import type { LocalSegment } from '../../src/local/contracts';

const roots: string[] = [];

class FakeInference implements InferenceClient {
  calls = 0;
  translationSignal?: AbortSignal;
  lastContext: { readonly sequence: number; readonly start: number; readonly duration: number; readonly language?: string; readonly interpret?: boolean; readonly signal?: AbortSignal } | null = null;
  async status() { return { ready: true, whisper: { ready: true, model: 'test', error: null }, ollama: { ready: true, model: 'test', error: null } }; }
  async transcribe(_audio: Blob, context: { readonly sequence: number; readonly start: number; readonly duration: number }): Promise<readonly LocalSegment[]> {
    this.calls += 1;
    this.lastContext = context;
    return [{ id: crypto.randomUUID(), sequence: context.sequence, start: context.start, end: context.start + context.duration, sourceText: 'こんにちは', translation: '안녕하세요', translationError: null }];
  }
  async translate(_text: string, signal?: AbortSignal) { this.translationSignal = signal; return { text: '안녕하세요', elapsedMs: 1 }; }
  async summarize() { return '# 요약'; }
}

async function fixture(): Promise<{ readonly app: (request: Request) => Promise<Response>; readonly store: LocalStore; readonly inference: FakeInference }> {
  const root = await mkdtemp(join(tmpdir(), 'meetily-local-app-'));
  roots.push(root);
  const nativePath = join(root, 'native.sqlite');
  const native = new Database(nativePath, { create: true });
  native.exec(`
    CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, folder_path TEXT);
    CREATE TABLE transcripts (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, transcript TEXT NOT NULL, timestamp TEXT NOT NULL, summary TEXT, action_items TEXT, key_points TEXT, audio_start_time REAL, audio_end_time REAL, duration REAL, speaker TEXT);
    CREATE TABLE summary_processes (meeting_id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT, result TEXT, start_time TEXT, end_time TEXT, chunk_count INTEGER DEFAULT 0, processing_time REAL DEFAULT 0.0, metadata TEXT, result_backup TEXT, result_backup_timestamp TEXT);
    CREATE TABLE transcript_chunks (meeting_id TEXT PRIMARY KEY, meeting_name TEXT, transcript_text TEXT NOT NULL, model TEXT NOT NULL, model_name TEXT NOT NULL, chunk_size INTEGER, overlap INTEGER, created_at TEXT NOT NULL);
  `);
  native.close();
  const staticDirectory = join(root, 'out');
  await mkdir(staticDirectory);
  await writeFile(join(staticDirectory, 'index.html'), '<h1>Meetily local</h1>');
  const store = new LocalStore({ nativePath, sidecarPath: join(root, 'sidecar.sqlite'), audioDirectory: join(root, 'audio') });
  store.initialize();
  const inference = new FakeInference();
  return { app: createLocalApp({ port: 3118, getStore: () => store, inference, staticDirectory, maxChunkBytes: 8 }), store, inference };
}

function writeRequest(url: string, init: RequestInit): Request {
  const headers = new Headers(init.headers);
  headers.set('host', '127.0.0.1:3118');
  headers.set('origin', 'http://127.0.0.1:3118');
  headers.set('x-meetily-client', 'test');
  return new Request(url, { ...init, headers });
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('local HTTP API', () => {
  it('rejects a hostile Host before serving static files', async () => {
    // Given
    const { app, store } = await fixture();

    // When
    const response = await app(new Request('http://127.0.0.1:3118/', { headers: { host: 'evil.example' } }));

    // Then
    expect(response.status).toBe(403);
    store.close();
  });

  it('creates a meeting and returns an idempotent chunk result', async () => {
    // Given
    const { app, store, inference } = await fixture();
    const createdResponse = await app(writeRequest('http://127.0.0.1:3118/api/local/meetings', {
      method: 'POST', body: JSON.stringify({ title: '通訳', language: 'ja', interpret: true }),
    }));
    const created = await createdResponse.json();
    const chunkUrl = `http://127.0.0.1:3118/api/local/meetings/${created.id}/chunks?sequence=0&start=0&duration=1`;

    // When
    const first = await app(writeRequest(chunkUrl, { method: 'POST', body: new Uint8Array(4), headers: { 'content-type': 'audio/wav' } }));
    const retried = await app(writeRequest(chunkUrl, { method: 'POST', body: new Uint8Array(4), headers: { 'content-type': 'audio/wav' } }));

    // Then
    expect(await retried.json()).toEqual(await first.json());
    expect(inference.calls).toBe(1);
    store.close();
  });

  it('shares one inference result across concurrent retries of a chunk sequence', async () => {
    // Given
    const { app, store, inference } = await fixture();
    const meeting = store.createMeeting({ title: 'Concurrent', language: 'ja', interpret: true });
    const url = `http://127.0.0.1:3118/api/local/meetings/${meeting.id}/chunks?sequence=7&start=0&duration=1`;

    // When
    const [first, second] = await Promise.all([
      app(writeRequest(url, { method: 'POST', body: new Uint8Array(4), headers: { 'content-type': 'audio/wav' } })),
      app(writeRequest(url, { method: 'POST', body: new Uint8Array(4), headers: { 'content-type': 'audio/wav' } })),
    ]);

    // Then
    expect(await second.json()).toEqual(await first.json());
    expect(inference.calls).toBe(1);
    store.close();
  });

  it('rejects an oversized audio chunk before inference', async () => {
    // Given
    const { app, store, inference } = await fixture();
    const meeting = store.createMeeting({ title: 'Bounds', language: 'ja', interpret: true });

    // When
    const response = await app(writeRequest(
      `http://127.0.0.1:3118/api/local/meetings/${meeting.id}/chunks?sequence=0&start=0&duration=1`,
      { method: 'POST', body: new Uint8Array(9), headers: { 'content-type': 'audio/wav' } },
    ));

    // Then
    expect(response.status).toBe(413);
    expect(inference.calls).toBe(0);
    store.close();
  });

  it('transcribes a live Japanese chunk without writing a meeting or transcript', async () => {
    // Given
    const { app, store, inference } = await fixture();

    // When
    const response = await app(writeRequest(
      'http://127.0.0.1:3118/api/local/transcribe?sequence=3&start=10&duration=5',
      { method: 'POST', body: new Uint8Array(4), headers: { 'content-type': 'audio/wav' } },
    ));

    // Then
    expect(response.status).toBe(200);
    expect((await response.json()).segments[0]?.sourceText).toBe('こんにちは');
    expect(inference.lastContext).toMatchObject({ sequence: 3, start: 10, duration: 5, language: 'ja', interpret: false, minimumLanguageProbability: 0.5 });
    expect(store.listMeetings()).toEqual([]);
    store.close();
  });

  it('stores a complete WAV recording and serves the same bytes', async () => {
    // Given
    const { app, store } = await fixture();
    const meeting = store.createMeeting({ title: 'Audio', language: 'ja', interpret: true });
    const bytes = new Uint8Array([82, 73, 70, 70]);
    const url = `http://127.0.0.1:3118/api/local/meetings/${meeting.id}/audio`;

    // When
    const saved = await app(writeRequest(url, { method: 'POST', body: bytes, headers: { 'content-type': 'audio/wav' } }));
    const loaded = await app(new Request(url, { headers: { host: '127.0.0.1:3118' } }));

    // Then
    expect(saved.status).toBe(204);
    expect(new Uint8Array(await loaded.arrayBuffer())).toEqual(bytes);
    store.close();
  });

  it('accepts an exact audio retry without replacing the recording', async () => {
    // Given
    const { app, store } = await fixture();
    const meeting = store.createMeeting({ title: 'Audio retry', language: 'ja', interpret: true });
    const bytes = new Uint8Array([82, 73, 70, 70]);
    const url = `http://127.0.0.1:3118/api/local/meetings/${meeting.id}/audio`;
    await app(writeRequest(url, { method: 'POST', body: bytes, headers: { 'content-type': 'audio/wav' } }));

    // When
    const response = await app(writeRequest(url, { method: 'POST', body: bytes, headers: { 'content-type': 'audio/wav' } }));

    // Then
    expect(response.status).toBe(204);
    store.close();
  });

  it('rejects replacing an existing meeting recording', async () => {
    // Given
    const { app, store } = await fixture();
    const meeting = store.createMeeting({ title: 'Audio owner', language: 'ja', interpret: true });
    const original = new Uint8Array([82, 73, 70, 70]);
    const url = `http://127.0.0.1:3118/api/local/meetings/${meeting.id}/audio`;
    await app(writeRequest(url, { method: 'POST', body: original, headers: { 'content-type': 'audio/wav' } }));

    // When
    const response = await app(writeRequest(url, { method: 'POST', body: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'audio/wav' } }));

    // Then
    expect(response.status).toBe(409);
    const loaded = await app(new Request(url, { headers: { host: '127.0.0.1:3118' } }));
    expect(new Uint8Array(await loaded.arrayBuffer())).toEqual(original);
    store.close();
  });

  it('imports multipart audio through ffmpeg and persists the result', async () => {
    // Given
    const { app, store } = await fixture();
    const form = new FormData();
    form.set('file', new File([wavFixture()], 'sample.wav', { type: 'audio/wav' }));
    form.set('title', 'Imported meeting');
    form.set('language', 'ja');
    form.set('interpret', 'true');

    // When
    const response = await app(writeRequest('http://127.0.0.1:3118/api/local/import', { method: 'POST', body: form }));

    // Then
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.meeting.title).toBe('Imported meeting');
    expect(result.meeting.audioAvailable).toBe(true);
    store.close();
  });
});

function wavFixture(): ArrayBuffer {
  const sampleCount = 1600;
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string): void => {
    for (const [index, character] of Array.from(value).entries()) view.setUint8(offset + index, character.charCodeAt(0));
  };
  write(0, 'RIFF'); view.setUint32(4, 36 + sampleCount * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, sampleCount * 2, true);
  return buffer;
}

 it('propagates client cancellation to both live model requests', async () => {
  const { app, store, inference } = await fixture();
  const controller = new AbortController();
  await app(writeRequest('http://127.0.0.1:3118/api/local/transcribe?sequence=0&start=0&duration=1', {method:'POST',body:new Uint8Array(4),headers:{'content-type':'audio/wav'},signal:controller.signal}));
  await app(writeRequest('http://127.0.0.1:3118/api/local/translate', {method:'POST',body:JSON.stringify({text:'テスト',sourceLanguage:'ja',targetLanguage:'ko'}),signal:controller.signal}));
  controller.abort();
  expect(inference.lastContext?.signal?.aborted).toBe(true);
  expect(inference.translationSignal?.aborted).toBe(true);
  store.close();
 });

import { afterEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { LocalInference } from '../../local-server/inference';

const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe('LocalInference', () => {
  it('transcribes while an Ollama request occupies its inference lane', async () => {
    // Given
    const ollamaStarted = deferred<void>();
    const releaseOllama = deferred<void>();
    const ollama = Bun.serve({ port: 0, fetch: async () => {
      ollamaStarted.resolve();
      await releaseOllama.promise;
      return Response.json({ message: { content: JSON.stringify({ ko: '안녕하세요' }) } });
    } });
    let whisperRequests = 0;
    const whisper = Bun.serve({ port: 0, fetch: () => {
      whisperRequests += 1;
      return Response.json({ text: 'こんにちは' });
    } });
    servers.push(ollama, whisper);
    const inference = createInference(serverPort(ollama), serverPort(whisper), 1);
    const translation = inference.translate('先行翻訳');
    await ollamaStarted.promise;

    try {
      // When
      const segments = await inference.transcribe(new Blob([new Uint8Array([1])]),
        { sequence: 0, start: 0, duration: 1, language: 'ja', interpret: false });

      // Then
      expect(segments[0]?.sourceText).toBe('こんにちは');
      expect(whisperRequests).toBe(1);
    } finally {
      releaseOllama.resolve();
      await translation;
    }
  });

  it('does not invoke a queued Whisper request after caller cancellation', async () => {
    // Given
    const firstRequestStarted = deferred<void>();
    const releaseFirstRequest = deferred<void>();
    let whisperRequests = 0;
    const whisper = Bun.serve({ port: 0, fetch: async () => {
      whisperRequests += 1;
      if (whisperRequests === 1) {
        firstRequestStarted.resolve();
        await releaseFirstRequest.promise;
      }
      return Response.json({ text: 'こんにちは' });
    } });
    servers.push(whisper);
    const inference = createInference(9, serverPort(whisper));
    const first = inference.transcribe(new Blob([new Uint8Array([1])]),
      { sequence: 0, start: 0, duration: 1, language: 'ja', interpret: false });
    await firstRequestStarted.promise;
    const controller = new AbortController();
    const cancelled = inference.transcribe(new Blob([new Uint8Array([2])]),
      { sequence: 1, start: 1, duration: 1, language: 'ja', interpret: false, signal: controller.signal });
    const rejection = cancelled.catch((error: unknown) => error);

    // When
    controller.abort();
    releaseFirstRequest.resolve();
    await first;

    // Then
    const error = await rejection;
    expect(error).toBeInstanceOf(DOMException);
    if (!(error instanceof Error)) throw new Error('Expected cancellation error');
    expect(error.name).toBe('AbortError');
    expect(whisperRequests).toBe(1);
  });

  it('aborts an active Ollama request from the caller signal', async () => {
    // Given
    const requestStarted = deferred<void>();
    const releaseRequest = deferred<void>();
    const ollama = Bun.serve({ port: 0, fetch: async () => {
      requestStarted.resolve();
      await releaseRequest.promise;
      return Response.json({ message: { content: JSON.stringify({ ko: '번역됨' }) } });
    } });
    servers.push(ollama);
    const inference = createInference(serverPort(ollama), 9);
    const controller = new AbortController();
    const translation = inference.translate('취소할 발언', controller.signal);
    await requestStarted.promise;
    const rejection = translation.catch((error: unknown) => error);

    // When
    controller.abort();
    releaseRequest.resolve();

    // Then
    const error = await rejection;
    expect(error).toBeInstanceOf(DOMException);
    if (!(error instanceof Error)) throw new Error('Expected cancellation error');
    expect(error.name).toBe('AbortError');
  });

  it('classifies an invalid Whisper response as an upstream inference failure', async () => {
    // Given
    const whisper = Bun.serve({ port: 0, fetch: () => new Response('{', {
      headers: { 'content-type': 'application/json' },
    }) });
    servers.push(whisper);
    const inference = createInference(9, serverPort(whisper));

    // When
    const transcription = inference.transcribe(
      new Blob([new Uint8Array([1])]),
      { sequence: 0, start: 0, duration: 1, language: 'ja', interpret: false },
    );

    // Then
    await expect(transcription).rejects.toMatchObject({ code: 'INFERENCE_FAILED', status: 502 });
  });

  it('classifies invalid Ollama structured content as an upstream inference failure', async () => {
    // Given
    const ollama = Bun.serve({ port: 0, fetch: () => Response.json({ message: { content: '{' } }) });
    servers.push(ollama);
    const inference = createInference(serverPort(ollama), 9);

    // When
    const translation = inference.translate('こんにちは');

    // Then
    await expect(translation).rejects.toMatchObject({ code: 'INFERENCE_FAILED', status: 502 });
  });

  it('requests deterministic non-thinking structured Korean translation', async () => {
    // Given
    let captured: unknown = null;
    const ollama = Bun.serve({ port: 0, fetch: async (request) => {
      captured = await request.json();
      return Response.json({ message: { content: JSON.stringify({ ko: '안녕하세요' }) } });
    } });
    servers.push(ollama);
    const inference = createInference(serverPort(ollama), 9);

    // When
    const result = await inference.translate('こんにちは');

    // Then
    const requestSchema = z.object({
      think: z.literal(false),
      stream: z.literal(false),
      keep_alive: z.literal('5m'),
      options: z.object({ temperature: z.literal(0) }),
    });
    expect(result.text).toBe('안녕하세요');
    expect(requestSchema.parse(captured)).toBeDefined();
  });

  it('keeps Japanese source text when translation fails', async () => {
    // Given
    const ollama = Bun.serve({ port: 0, fetch: () => new Response('failed', { status: 500 }) });
    const whisper = Bun.serve({ port: 0, fetch: () => Response.json({ text: 'こんにちは' }) });
    servers.push(ollama, whisper);
    const inference = createInference(serverPort(ollama), serverPort(whisper));

    // When
    const segments = await inference.transcribe(new Blob([new Uint8Array([1])]), { sequence: 0, start: 2, duration: 1, language: 'ja', interpret: true });

    // Then
    expect(segments[0]?.sourceText).toBe('こんにちは');
    expect(segments[0]?.translation).toBeNull();
    expect(segments[0]?.translationError).toContain('HTTP 500');
  });

  it('passes auto language and deterministic temperature to Whisper', async () => {
    // Given
    const captured: { language: FormDataEntryValue | null; temperature: FormDataEntryValue | null } = {
      language: null,
      temperature: null,
    };
    const whisper = Bun.serve({ port: 0, fetch: async (request) => {
      const form = await request.formData();
      captured.language = form.get('language');
      captured.temperature = form.get('temperature');
      return Response.json({ text: 'hello' });
    } });
    servers.push(whisper);
    const inference = createInference(9, serverPort(whisper));

    // When
    await inference.transcribe(new Blob([new Uint8Array([1])]), { sequence: 0, start: 0, duration: 1, language: 'auto', interpret: false });

    // Then
    expect(captured.language).toBe('auto');
    expect(captured.temperature).toBe('0');
  });

  it('rejects an empty trimmed Korean translation', async () => {
    // Given
    const ollama = Bun.serve({ port: 0, fetch: () => Response.json({ message: { content: JSON.stringify({ ko: '   ' }) } }) });
    servers.push(ollama);
    const inference = createInference(serverPort(ollama), 9);

    // When
    const result = inference.translate('こんにちは');

    // Then
    await expect(result).rejects.toBeDefined();
  });

  it('rejects an empty trimmed summary', async () => {
    // Given
    const ollama = Bun.serve({ port: 0, fetch: () => Response.json({ message: { content: JSON.stringify({ markdown: '\n  ' }) } }) });
    servers.push(ollama);
    const inference = createInference(serverPort(ollama), 9);

    // When
    const result = inference.summarize('회의 발언');

    // Then
    await expect(result).rejects.toBeDefined();
  });
});

function createInference(ollamaPort: number, whisperPort: number, queueLimit = 2): LocalInference {
  return new LocalInference({
    whisperUrl: `http://127.0.0.1:${whisperPort}`,
    whisperModel: 'test-whisper',
    ollamaUrl: `http://127.0.0.1:${ollamaPort}`,
    ollamaModel: 'qwen3.5:4b',
    timeoutMs: 1000,
    queueLimit,
  });
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function serverPort(server: ReturnType<typeof Bun.serve>): number {
  if (server.port === undefined) throw new Error('Test server has no port');
  return server.port;
}

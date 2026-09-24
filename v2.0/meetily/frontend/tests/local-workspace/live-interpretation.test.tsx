import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { AudioChunk, CaptureResult, CaptureSession, StartCaptureOptions } from '../../src/local/audio';
import type { ServiceStatus } from '../../src/local/contracts';

const originalAudio = { ...await import('../../src/local/audio') };
const originalClient = { ...await import('../../src/local/client') };

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (error) => rejectPromise?.(error),
  };
}

let captureOptions: StartCaptureOptions | undefined;
let captureStart: Deferred<CaptureSession> | null = null;
const stopCapture = mock(async (): Promise<CaptureResult> => ({
  recording: new Blob([], { type: 'audio/wav' }),
  duration: 5,
}));
const abortCapture = mock(async (): Promise<void> => undefined);
const startCapture = mock(async (options: StartCaptureOptions): Promise<CaptureSession> => {
  captureOptions = options;
  if (captureStart !== null) return captureStart.promise;
  return { stop: stopCapture, abort: abortCapture };
});
const transcribeLiveChunk = mock(async (chunk: AudioChunk) => ({
  segments: [{
    id: `segment-${chunk.sequence}`,
    sequence: chunk.sequence,
    start: chunk.start,
    end: chunk.start + chunk.duration,
    sourceText: 'こんにちは',
    translation: null,
    translationError: null,
  }],
}));
let translation = deferred<{ readonly text: string; readonly elapsedMs: number }>();
const requestTranslation = mock(async () => translation.promise);

mock.module('../../src/local/audio', () => ({ startCapture }));
mock.module('../../src/local/client', () => ({ requestTranslation, transcribeLiveChunk }));

const { useLiveInterpretation } = await import('../../src/local/components/useLiveInterpretation');
type LiveState = ReturnType<typeof useLiveInterpretation>;

const readyStatus: ServiceStatus = {
  ready: true,
  whisper: { ready: true, model: 'test-whisper', error: null },
  ollama: { ready: true, model: 'test-ollama', error: null },
};

let renderer: ReactTestRenderer | undefined;
let liveState: LiveState | undefined;

function Probe() {
  liveState = useLiveInterpretation({ status: readyStatus });
  return null;
}

beforeEach(() => {
  captureOptions = undefined;
  captureStart = null;
  liveState = undefined;
  translation = deferred();
  startCapture.mockClear();
  stopCapture.mockClear();
  abortCapture.mockClear();
  transcribeLiveChunk.mockClear();
  requestTranslation.mockClear();
});

afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
});

afterAll(() => {
  mock.module('../../src/local/audio', () => originalAudio);
  mock.module('../../src/local/client', () => originalClient);
});

describe('browser live interpretation', () => {
  test('shows a native capture rejection string instead of a generic failure', async () => {
    startCapture.mockImplementationOnce(async () => {
      throw '컴퓨터 소리 장치가 응답하지 않습니다.';
    });
    await act(async () => { renderer = create(<Probe />); });

    await act(async () => { await liveState?.start(); });

    expect(liveState?.phase).toBe('error');
    expect(liveState?.error).toBe('컴퓨터 소리 장치가 응답하지 않습니다.');
  });

  test('stays inert until start and exposes Japanese before Korean translation finishes', async () => {
    // Given
    await act(async () => { renderer = create(<StrictMode><Probe /></StrictMode>); });
    expect(startCapture).not.toHaveBeenCalled();

    // When
    await act(async () => { await liveState?.start(); });
    expect(captureOptions?.retainRecording).toBe(false);
    expect(captureOptions?.source).toBe('both');
    const chunk = {
      sequence: 0,
      start: 0,
      duration: 5,
      blob: new Blob([new Uint8Array(4)], { type: 'audio/wav' }),
    };
    await act(async () => {
      captureOptions?.onChunk(chunk);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Then
    expect(liveState?.items).toHaveLength(1);
    expect(liveState?.items[0]).toMatchObject({ sourceText: 'こんにちは', translation: null });
    translation.resolve({ text: '안녕하세요', elapsedMs: 1 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(liveState?.items[0]).toMatchObject({ sourceText: 'こんにちは', translation: '안녕하세요' });
    expect(liveState?.phase).toBe('recording');
    expect(stopCapture).not.toHaveBeenCalled();

    await act(async () => { await liveState?.stop(); });
    expect(stopCapture).toHaveBeenCalledTimes(1);
    expect(liveState?.phase).toBe('idle');

    translation = deferred();
    await act(async () => { await liveState?.start(); });
    expect(liveState?.items).toEqual([]);
    await act(async () => { await liveState?.stop(); });
    expect(stopCapture).toHaveBeenCalledTimes(2);
  });

  test('honors capture end while startCapture is still resolving', async () => {
    // Given
    captureStart = deferred<CaptureSession>();
    await act(async () => { renderer = create(<Probe />); });
    let startPromise: Promise<void> | undefined;
    await act(async () => {
      startPromise = liveState?.start();
      await Promise.resolve();
    });

    // When
    await act(async () => {
      captureOptions?.onEnded?.('display-ended');
      await Promise.resolve();
    });
    captureStart.resolve({ stop: stopCapture, abort: abortCapture });
    await act(async () => { await startPromise; });

    // Then
    expect(abortCapture).toHaveBeenCalledTimes(1);
    expect(stopCapture).not.toHaveBeenCalled();
    expect(liveState?.phase).toBe('idle');
  });

  test('exposes translation retry through the live hook', async () => {
    // Given
    await act(async () => { renderer = create(<Probe />); });
    await act(async () => { await liveState?.start(); });
    await act(async () => {
      captureOptions?.onChunk({
        sequence: 0,
        start: 0,
        duration: 2,
        blob: new Blob([new Uint8Array(4)], { type: 'audio/wav' }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    translation.reject(new TypeError('Failed to fetch'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(liveState?.items[0]).toMatchObject({ status: 'error' });
    translation = deferred();

    // When
    let accepted = false;
    await act(async () => {
      accepted = liveState?.retryTranslation('live-0') ?? false;
      await Promise.resolve();
    });
    translation.resolve({ text: '재시도 성공', elapsedMs: 1 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Then
    expect(accepted).toBe(true);
    expect(requestTranslation).toHaveBeenCalledTimes(2);
    expect(liveState?.items[0]).toMatchObject({ status: 'translated', translation: '재시도 성공' });
    await act(async () => { await liveState?.stop(); });
  });

  test('stops once and preserves the final ASR failure after client retries are exhausted', async () => {
    // Given
    transcribeLiveChunk.mockImplementationOnce(async () => {
      throw new Error('로컬 전사 서버가 503 응답을 반환했습니다.');
    });
    await act(async () => { renderer = create(<Probe />); });
    await act(async () => { await liveState?.start(); });

    // When
    await act(async () => {
      captureOptions?.onChunk({
        sequence: 9,
        start: 0,
        duration: 2,
        blob: new Blob([new Uint8Array(4)], { type: 'audio/wav' }),
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Then
    expect(stopCapture).toHaveBeenCalledTimes(1);
    expect(liveState?.phase).toBe('error');
    expect(liveState?.recoverable).toBe(true);
    expect(liveState?.error).toContain('일본어 음성 전사에 실패했습니다.');
    expect(liveState?.error).toContain('503');

    translation.resolve({ text: '복구된 통역', elapsedMs: 1 });
    await act(async () => { await liveState?.retry(); });
    expect(liveState?.phase).toBe('idle');
    expect(liveState?.error).toBeNull();
  });
});

test('replaces an unfinished utterance with contextual recognition instead of appending duplicated fragments', async () => {
  await act(async () => { renderer = create(<Probe />); });
  await act(async () => { await liveState?.start(); });
  transcribeLiveChunk.mockImplementationOnce(async chunk => ({segments:[{id:'revision-a',sequence:0,start:0,end:chunk.duration,sourceText:'こんにちは',translation:null,translationError:null}]}));
  transcribeLiveChunk.mockImplementationOnce(async chunk => ({segments:[{id:'revision-b',sequence:0,start:0,end:chunk.duration,sourceText:'こんにちは皆さん',translation:null,translationError:null}]}));
  const chunk={sequence:0,start:0,duration:1.5,blob:new Blob(['speech']),final:false};
  await act(async () => { captureOptions?.onChunk(chunk); await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { captureOptions?.onChunk({...chunk,duration:3,final:true}); await Promise.resolve(); await Promise.resolve(); });
  expect(liveState?.items).toHaveLength(1);
  expect(liveState?.items[0]?.sourceText).toBe('こんにちは皆さん');
});

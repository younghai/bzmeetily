import { afterEach, describe, expect, test } from 'bun:test';

import { startCapture } from '../../src/local/audio/capture';
import { CaptureError } from '../../src/local/audio/errors';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
  if (originalAudioContext) {
    Object.defineProperty(globalThis, 'AudioContext', originalAudioContext);
  } else {
    Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});

function installMediaDevices(mediaDevices: object): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices, userActivation: { isActive: true } },
  });
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: class TestAudioContext {},
  });
}

describe('browser capture acquisition', () => {
  test('stops every display track and reports when the selected surface has no audio', async () => {
    // Given
    let stopped = 0;
    const videoTrack = { stop: () => { stopped += 1; } };
    installMediaDevices({
      getDisplayMedia: async () => ({
        getAudioTracks: () => [],
        getTracks: () => [videoTrack],
      }),
    });

    // When
    const result = startCapture({ source: 'display', onChunk: () => undefined });

    // Then
    await expect(result).rejects.toMatchObject({
      code: 'no-display-audio',
      message: expect.stringContaining('공유 오디오가 없습니다'),
    });
    expect(stopped).toBe(1);
  });

  test('stops a late permission stream after its caller aborts', async () => {
    // Given
    let resolveRequest: ((stream: object) => void) | undefined;
    let stopped = 0;
    installMediaDevices({
      getUserMedia: () => new Promise<object>((resolve) => { resolveRequest = resolve; }),
    });
    const controller = new AbortController();
    const pending = startCapture({
      source: 'microphone',
      onChunk: () => undefined,
      signal: controller.signal,
    });

    // When
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CaptureError);
    resolveRequest?.({
      getTracks: () => [{ stop: () => { stopped += 1; } }],
    });
    await Promise.resolve();

    // Then
    expect(stopped).toBe(1);
  });

  test('rejects an empty microphone stream instead of pretending to record', async () => {
    // Given
    let stopped = 0;
    installMediaDevices({
      getUserMedia: async () => ({
        getAudioTracks: () => [],
        getTracks: () => [{ stop: () => { stopped += 1; } }],
      }),
    });

    // When
    const result = startCapture({ source: 'microphone', onChunk: () => undefined });

    // Then
    await expect(result).rejects.toMatchObject({ code: 'missing-device' });
    expect(stopped).toBe(1);
  });
});

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { AudioChunk } from '../audio/chunker';
import type { CaptureEndReason, CaptureResult } from '../audio/capture';
import { LiveAudioChunker } from '../audio/liveChunker';

export type TauriCaptureSource = 'microphone' | 'display' | 'both';

type PcmPayload = {
  readonly data?: string;
  readonly sampleRate?: number;
  readonly level?: number;
};

export type TauriCaptureOptions = {
  readonly source: TauriCaptureSource;
  readonly micDeviceName?: string | null;
  readonly systemDeviceName?: string | null;
  readonly onChunk: (chunk: AudioChunk) => void;
  readonly onLevel?: (rms: number) => void;
  readonly onEnded?: (reason: CaptureEndReason) => void;
  readonly signal?: AbortSignal;
};

export interface TauriCaptureSession {
  stop(): Promise<CaptureResult>;
  abort(): Promise<void>;
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function samplesFromPcm16(bytes: Uint8Array): Float32Array {
  const sampleCount = bytes.byteLength >> 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32768;
  }
  return samples;
}

/**
 * Capture microphone/system audio through the Rust recording pipeline and feed
 * the raw mixed PCM stream into the same LiveAudioChunker used by the browser
 * path, so the app produces identical contextual revision chunks.
 */
export async function startTauriPcmCapture(options: TauriCaptureOptions): Promise<TauriCaptureSession> {
  let flushed = false;
  let chunker: LiveAudioChunker | null = null;
  let sampleCount = 0;
  const startedAt = performance.now();
  let unlisten: UnlistenFn | null = null;
  let unlistenError: UnlistenFn | null = null;
  let warning: string | undefined;

  const finish = (): void => {
    if (flushed) return;
    flushed = true;
    try {
      chunker?.flush();
    } catch {
      // chunker is closed with the session; a late flush is harmless
    }
  };

  unlisten = await listen<PcmPayload>('live-pcm', (event) => {
    if (flushed) return;
    const payload = event.payload;
    if (typeof payload?.data !== 'string' || payload.data.length === 0) return;
    const sampleRate = payload.sampleRate ?? 48000;
    const samples = samplesFromPcm16(decodeBase64(payload.data));
    if (samples.length === 0) return;
    chunker ??= new LiveAudioChunker({ sampleRate, onChunk: options.onChunk });
    sampleCount += samples.length;
    options.onLevel?.(payload.level ?? 0);
    chunker.push(samples);
  });
  try {
    unlistenError = await listen<string>('recording-error', (event) => {
      if (flushed) return;
      warning = event.payload === 'Audio buffer overflow'
        ? '음성 처리 대기열이 가득 차 일부 음성이 누락되었을 수 있습니다. 통역을 중지했습니다.'
        : `음성 입력 오류: ${event.payload}`;
      options.onEnded?.('audio-error');
    });
  } catch (error) {
    unlisten?.();
    throw error;
  }

  const stopStream = async (): Promise<void> => {
    finish();
    unlisten?.();
    unlisten = null;
    unlistenError?.();
    unlistenError = null;
    await invoke('stop_live_pcm_stream_command');
  };

  const onAbort = (): void => {
    void stopStream().catch(() => undefined);
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await invoke('start_live_pcm_stream_command', {
      args: {
        micDeviceName: options.micDeviceName ?? null,
        systemDeviceName: options.systemDeviceName ?? null,
        // Web capture calls computer audio 'display' (getDisplayMedia); the
        // Rust command calls it 'system' (Core Audio process tap).
        source: options.source === 'display' ? 'system' : options.source,
      },
    });
  } catch (error) {
    finish();
    unlisten?.();
    unlisten = null;
    unlistenError?.();
    unlistenError = null;
    options.signal?.removeEventListener('abort', onAbort);
    throw error;
  }

  if (options.signal?.aborted) {
    await stopStream();
    throw new DOMException('Capture cancelled', 'AbortError');
  }

  return {
    stop: async () => {
      options.signal?.removeEventListener('abort', onAbort);
      // Give the pipeline a beat to flush its final mixed windows before the
      // Rust side tears the streams down.
      await new Promise((resolve) => setTimeout(resolve, 120));
      await stopStream();
      const duration = (performance.now() - startedAt) / 1000;
      return { recording: new Blob(), duration, warning };
    },
    abort: async () => {
      options.signal?.removeEventListener('abort', onAbort);
      await stopStream();
    },
  };
}

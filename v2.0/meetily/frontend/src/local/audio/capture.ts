import { AudioChunker, type AudioChunk } from './chunker';
import { CaptureError, captureRequestError } from './errors';
import { flushWorklet } from './flush';
import { requestStream, stopStream } from './media';
import { TARGET_SAMPLE_RATE } from './pcm';
import { LiveAudioChunker } from './liveChunker';
import { encodePcm16, wavBlobFromPcm } from './wav';

export type CaptureSource = 'microphone' | 'display' | 'both';
export type CaptureEndReason = 'display-ended' | 'max-duration' | 'audio-error';

export type StartCaptureOptions = {
  readonly source: CaptureSource;
  readonly onChunk: (chunk: AudioChunk) => void;
  readonly onLevel?: (rms: number) => void;
  readonly onEnded?: (reason: CaptureEndReason) => void;
  readonly signal?: AbortSignal;
  readonly maxDurationSeconds?: number;
  readonly retainRecording?: boolean;
  readonly chunkSeconds?: number;
};

export type CaptureResult = {
  readonly recording: Blob;
  readonly duration: number;
  readonly warning?: string;
};

export interface CaptureSession {
  stop(): Promise<CaptureResult>;
  abort(): Promise<void>;
}

const CHUNK_SECONDS = 5;
const SILENCE_RMS = 0.008;
export const MAX_RECORDING_SECONDS = 2 * 60 * 60;
const INCOMPLETE_TAIL_WARNING = '오디오 처리기가 응답하지 않아 녹음 끝부분이 일부 누락되었을 수 있습니다. 저장된 녹음을 확인해 주세요.';

class BrowserCaptureSession implements CaptureSession {
  readonly #context: AudioContext;
  readonly #node: AudioWorkletNode;
  readonly #silentSink: GainNode;
  readonly #streams: readonly MediaStream[];
  readonly #sources: readonly MediaStreamAudioSourceNode[];
  readonly #chunker: Pick<AudioChunker, 'push' | 'flush'>;
  readonly #recordingParts: Blob[];
  readonly #recordingSampleCount: () => number;
  readonly #duration: () => number;
  #completion: Promise<CaptureResult> | undefined;

  constructor(options: {
    readonly context: AudioContext;
    readonly node: AudioWorkletNode;
    readonly silentSink: GainNode;
    readonly streams: readonly MediaStream[];
    readonly sources: readonly MediaStreamAudioSourceNode[];
    readonly chunker: Pick<AudioChunker, 'push' | 'flush'>;
    readonly recordingParts: Blob[];
    readonly recordingSampleCount: () => number;
    readonly duration: () => number;
  }) {
    this.#context = options.context;
    this.#node = options.node;
    this.#silentSink = options.silentSink;
    this.#streams = options.streams;
    this.#sources = options.sources;
    this.#chunker = options.chunker;
    this.#recordingParts = options.recordingParts;
    this.#recordingSampleCount = options.recordingSampleCount;
    this.#duration = options.duration;
  }

  stop(): Promise<CaptureResult> {
    if (this.#completion) return this.#completion;
    for (const stream of this.#streams) stopStream(stream);
    this.#completion = this.#finish(false);
    return this.#completion;
  }

  async abort(): Promise<void> {
    if (this.#completion) {
      await this.#completion;
      return;
    }
    for (const stream of this.#streams) stopStream(stream);
    this.#completion = this.#finish(true);
    await this.#completion;
  }

  async #finish(discard: boolean): Promise<CaptureResult> {
    try {
      const flushOutcome = await flushWorklet(this.#node.port);
      this.#chunker.flush();
      const duration = this.#duration();
      const recording = discard
        ? wavBlobFromPcm([], 0, TARGET_SAMPLE_RATE)
        : wavBlobFromPcm(this.#recordingParts, this.#recordingSampleCount(), TARGET_SAMPLE_RATE);
      return flushOutcome === 'timed-out'
        ? { recording, duration, warning: INCOMPLETE_TAIL_WARNING }
        : { recording, duration };
    } finally {
      try {
        for (const source of this.#sources) source.disconnect();
        this.#node.disconnect();
        this.#silentSink.disconnect();
      } finally {
        try {
          await this.#context.close();
        } finally {
          this.#recordingParts.length = 0;
        }
      }
    }
  }

}

export async function startCapture(options: StartCaptureOptions): Promise<CaptureSession> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof AudioContext === 'undefined') {
    throw new CaptureError('unsupported', '이 브라우저에서는 오디오 녹음을 지원하지 않습니다.');
  }
  if (options.source !== 'microphone' && typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    throw new CaptureError('unsupported', '이 브라우저에서는 컴퓨터 소리 공유를 지원하지 않습니다. Chrome 또는 Brave에서 열거나 입력을 마이크로 선택해 주세요.');
  }
  if (navigator.userActivation && !navigator.userActivation.isActive) {
    throw new CaptureError('gesture-required', '녹음 버튼을 직접 눌러 오디오 캡처를 시작해 주세요.');
  }

  const streams: MediaStream[] = [];
  let context: AudioContext | undefined;
  try {
    if (options.source === 'display' || options.source === 'both') {
      const display = await requestStream(
        () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }),
        options.signal,
        '화면 오디오',
      );
      streams.push(display);
      if (display.getAudioTracks().length === 0) {
        throw new CaptureError(
          'no-display-audio',
          '선택한 화면에 공유 오디오가 없습니다. 공유 창에서 오디오 공유를 켜고 다시 시도해 주세요.',
        );
      }
    }
    if (options.source === 'microphone' || options.source === 'both') {
      const microphone = await requestStream(
        () => navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: TARGET_SAMPLE_RATE },
        }),
        options.signal,
        '마이크',
      );
      streams.push(microphone);
      if (microphone.getAudioTracks().length === 0) {
        throw new CaptureError('missing-device', '마이크 오디오 트랙을 가져오지 못했습니다. 장치를 확인해 주세요.');
      }
    }

    const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    context = audioContext;
    await audioContext.audioWorklet.addModule('/local-audio-worklet.js');
    const node = new AudioWorkletNode(audioContext, 'meetily-pcm-capture');
    const silentSink = audioContext.createGain();
    silentSink.gain.value = 0;
    node.connect(silentSink).connect(audioContext.destination);
    const sources = streams.map((stream) => audioContext.createMediaStreamSource(stream));
    const sourceGain = sources.length > 1 ? 0.5 : 1;
    for (const source of sources) {
      const gain = audioContext.createGain();
      gain.gain.value = sourceGain;
      source.connect(gain).connect(node);
    }

    const recordingParts: Blob[] = [];
    let recordingSampleCount = 0;
    const maxDuration = Math.max(1, Math.min(
      options.maxDurationSeconds ?? MAX_RECORDING_SECONDS,
      MAX_RECORDING_SECONDS,
    ));
    const maxInputSamples = Math.round(maxDuration * audioContext.sampleRate);
    let inputSamples = 0;
    let session: BrowserCaptureSession | undefined;
    let ended = false;
    const finishAutomatically = (reason: CaptureEndReason): void => {
      if (ended || !session) return;
      ended = true;
      const completion = session.stop();
      void completion.catch(() => undefined);
      globalThis.setTimeout(() => options.onEnded?.(reason), 0);
    };
    const chunker = options.retainRecording === false
      ? new LiveAudioChunker({ sampleRate: audioContext.sampleRate, onChunk: options.onChunk })
      : new AudioChunker({
        sampleRate: audioContext.sampleRate,
        outputSampleRate: TARGET_SAMPLE_RATE,
        chunkSeconds: Math.max(1, Math.min(options.chunkSeconds ?? CHUNK_SECONDS, CHUNK_SECONDS)),
        silenceRms: SILENCE_RMS,
        onChunk: options.onChunk,
        onSamples: (samples) => {
          recordingParts.push(new Blob([encodePcm16(samples)]));
          recordingSampleCount += samples.length;
        },
      });

    node.port.onmessage = (event: MessageEvent<unknown>): void => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const incoming = new Float32Array(event.data);
      const remaining = maxInputSamples - inputSamples;
      if (remaining <= 0) return;
      const accepted = incoming.length <= remaining ? incoming : incoming.slice(0, remaining);
      inputSamples += accepted.length;
      chunker.push(accepted);
      if (inputSamples >= maxInputSamples && session) {
        finishAutomatically('max-duration');
      }
      options.onLevel?.(Math.sqrt(accepted.reduce((sum, sample) => sum + sample * sample, 0) / accepted.length));
    };

    session = new BrowserCaptureSession({
      context: audioContext,
      node,
      silentSink,
      streams,
      sources,
      chunker,
      recordingParts,
      recordingSampleCount: () => recordingSampleCount,
      duration: () => inputSamples / audioContext.sampleRate,
    });
    const displayStream = streams.find((stream) => stream.getVideoTracks().length > 0);
    for (const track of displayStream?.getVideoTracks() ?? []) {
      track.addEventListener('ended', () => {
        finishAutomatically('display-ended');
      }, { once: true });
    }
    await audioContext.resume();
    return session;
  } catch (error) {
    for (const stream of streams) stopStream(stream);
    if (context && context.state !== 'closed') await context.close();
    if (error instanceof CaptureError) throw error;
    throw captureRequestError(error, '오디오');
  }
}

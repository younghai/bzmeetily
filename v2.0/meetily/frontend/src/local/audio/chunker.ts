import { joinSamples, resampleLinear, rootMeanSquare } from './pcm';
import { wavBlob } from './wav';

export type AudioChunk = {
  readonly sequence: number;
  readonly start: number;
  readonly duration: number;
  readonly blob: Blob;
  readonly final?: boolean;
};

type AudioChunkerOptions = {
  readonly sampleRate: number;
  readonly chunkSeconds: number;
  readonly silenceRms: number;
  readonly outputSampleRate?: number;
  readonly onChunk: (chunk: AudioChunk) => void;
  readonly onSamples?: (samples: Float32Array) => void;
};

export class AudioChunker {
  readonly #sampleRate: number;
  readonly #chunkLength: number;
  readonly #silenceRms: number;
  readonly #outputSampleRate: number;
  readonly #onChunk: (chunk: AudioChunk) => void;
  readonly #onSamples?: (samples: Float32Array) => void;
  #parts: Float32Array[] = [];
  #bufferedLength = 0;
  #timelineSamples = 0;
  #sequence = 0;
  #flushed = false;

  constructor(options: AudioChunkerOptions) {
    this.#sampleRate = options.sampleRate;
    this.#chunkLength = Math.max(1, Math.round(options.sampleRate * options.chunkSeconds));
    this.#silenceRms = options.silenceRms;
    this.#outputSampleRate = options.outputSampleRate ?? options.sampleRate;
    this.#onChunk = options.onChunk;
    this.#onSamples = options.onSamples;
  }

  push(samples: Float32Array): void {
    if (this.#flushed || samples.length === 0) return;
    this.#parts.push(samples.slice());
    this.#bufferedLength += samples.length;

    while (this.#bufferedLength >= this.#chunkLength) {
      const joined = joinSamples(this.#parts, this.#bufferedLength);
      this.#emit(joined.slice(0, this.#chunkLength));
      const remainder = joined.slice(this.#chunkLength);
      this.#parts = remainder.length === 0 ? [] : [remainder];
      this.#bufferedLength = remainder.length;
    }
  }

  flush(): void {
    if (this.#flushed) return;
    this.#flushed = true;
    if (this.#bufferedLength > 0) this.#emit(joinSamples(this.#parts, this.#bufferedLength));
    this.#parts = [];
    this.#bufferedLength = 0;
  }

  #emit(samples: Float32Array): void {
    const start = this.#timelineSamples / this.#sampleRate;
    const duration = samples.length / this.#sampleRate;
    this.#timelineSamples += samples.length;

    const output = resampleLinear(samples, this.#sampleRate, this.#outputSampleRate);
    this.#onSamples?.(output);
    if (rootMeanSquare(samples) < this.#silenceRms) return;
    this.#onChunk({
      sequence: this.#sequence,
      start,
      duration,
      blob: wavBlob(output, this.#outputSampleRate),
    });
    this.#sequence += 1;
  }
}

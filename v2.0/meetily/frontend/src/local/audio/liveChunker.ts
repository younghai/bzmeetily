import type { AudioChunk } from './chunker';
import { joinSamples, resampleLinear, rootMeanSquare, TARGET_SAMPLE_RATE } from './pcm';
import { wavBlob } from './wav';

type LiveChunkerOptions = {
  readonly sampleRate: number;
  readonly onChunk: (chunk: AudioChunk) => void;
};

// Each revision contains the utterance so far, so recognition can correct a word
// when its ending arrives. Silence commits it; continuous speech is bounded at 8s.
export class LiveAudioChunker {
  readonly #options: LiveChunkerOptions;
  readonly #frameLength: number;
  #tail = new Float32Array(0);
  #preroll: Float32Array[] = [];
  #frames: Float32Array[] = [];
  #size = 0;
  #timeline = 0;
  #start = 0;
  #lastSent = 0;
  #sequence = 0;
  #onsetFrames = 0;
  #silence = 0;
  #flushed = false;

  constructor(options: LiveChunkerOptions) {
    this.#options = options;
    this.#frameLength = Math.round(options.sampleRate * 0.02);
  }

  push(samples: Float32Array): void {
    if (this.#flushed || samples.length === 0) return;
    const input = joinSamples([this.#tail, samples]);
    let offset = 0;
    for (; offset + this.#frameLength <= input.length; offset += this.#frameLength) {
      this.#process(input.slice(offset, offset + this.#frameLength));
    }
    this.#tail = input.slice(offset);
  }

  flush(): void {
    if (this.#flushed) return;
    this.#flushed = true;
    if (this.#tail.length > 0) this.#process(this.#tail);
    this.#tail = new Float32Array(0);
    if (this.#size > 0) this.#emit(true);
    this.#preroll = [];
  }

  #process(frame: Float32Array): void {
    this.#timeline += frame.length;
    const speech = rootMeanSquare(frame) >= 0.004;
    if (this.#size === 0) {
      this.#preroll.push(frame);
      if (this.#preroll.length > 10) this.#preroll.shift();
      this.#onsetFrames = speech ? this.#onsetFrames + 1 : 0;
      if (this.#onsetFrames < 3) return;
      this.#frames = this.#preroll;
      this.#preroll = [];
      this.#size = this.#frames.reduce((sum, part) => sum + part.length, 0);
      this.#start = this.#timeline - this.#size;
    } else {
      this.#frames.push(frame);
      this.#size += frame.length;
    }
    this.#silence = speech ? 0 : this.#silence + frame.length;
    const rate = this.#options.sampleRate;
    if (this.#silence >= rate * 0.24 || this.#size >= rate * 8) {
      this.#emit(true);
    } else if (this.#size - this.#lastSent >= rate * 1.5) {
      this.#emit(false);
    }
  }

  #emit(final: boolean): void {
    const samples = resampleLinear(joinSamples(this.#frames, this.#size), this.#options.sampleRate);
    this.#options.onChunk({
      sequence: this.#sequence,
      start: this.#start / this.#options.sampleRate,
      duration: this.#size / this.#options.sampleRate,
      blob: wavBlob(samples, TARGET_SAMPLE_RATE),
      final,
    });
    this.#lastSent = this.#size;
    if (!final) return;
    this.#sequence += 1;
    this.#frames = [];
    this.#size = 0;
    this.#lastSent = 0;
    this.#silence = 0;
    this.#onsetFrames = 0;
  }
}

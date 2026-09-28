export type Speaker = 'mic' | 'system';

export type SpeakerWindow = {
  readonly speaker: Speaker;
  /** Window weight (samples) so longer windows count proportionally. */
  readonly samples: number;
};

/**
 * Accumulates per-window speaker attributions for the utterance currently
 * being built by the live chunker and reports the dominant speaker. Windows
 * arrive from the Rust mixing pipeline (mic = local user, system = remote
 * party); the majority across an utterance is a robust 2-party label.
 */
export class SpeakerTracker {
  #micWeight = 0;
  #systemWeight = 0;

  /** Record one mixing window's attribution. */
  push(window: SpeakerWindow): void {
    if (window.speaker === 'system') this.#systemWeight += window.samples;
    else this.#micWeight += window.samples;
  }

  /** Dominant speaker of the utterance so far (mic on ties: local user is
   * the one operating the app). */
  current(): Speaker {
    return this.#systemWeight > this.#micWeight ? 'system' : 'mic';
  }

  /** Reset at utterance boundaries (final chunks). */
  reset(): void {
    this.#micWeight = 0;
    this.#systemWeight = 0;
  }
}

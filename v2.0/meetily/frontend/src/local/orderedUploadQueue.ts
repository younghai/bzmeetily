export type UploadQueueSnapshot = {
  readonly pending: number;
  readonly failed: boolean;
};

export class OrderedUploadQueue<T> {
  readonly #maximumPending: number;
  readonly #upload: (item: T) => Promise<void>;
  readonly #key?: (item: T) => string | number;
  readonly #items: T[] = [];
  readonly #listeners = new Set<(snapshot: UploadQueueSnapshot) => void>();
  #active = false;
  #failed = false;
  #idleWaiters: Array<() => void> = [];

  constructor(maximumPending: number, upload: (item: T) => Promise<void>, key?: (item: T) => string | number) {
    this.#key = key;
    this.#maximumPending = maximumPending;
    this.#upload = upload;
  }

  enqueue(item: T): boolean {
    const key = this.#key;
    const existing = key ? this.#items.findIndex((queued, index) => (index > 0 || !this.#active) && key(queued) === key(item)) : -1;
    if (existing >= 0) this.#items[existing] = item;
    else this.#items.push(item);
    this.#emit();
    void this.#run();
    return this.#items.length <= this.#maximumPending;
  }

  retry(): void {
    if (!this.#failed) return;
    this.#failed = false;
    this.#emit();
    void this.#run();
  }

  snapshot(): UploadQueueSnapshot {
    return { pending: this.#items.length, failed: this.#failed };
  }

  subscribe(listener: (snapshot: UploadQueueSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  async waitForIdle(): Promise<void> {
    if (!this.#active) return;
    await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  async drain(): Promise<void> {
    while (this.#items.length > 0) {
      await this.waitForIdle();
      if (this.#failed) throw new UploadQueueError(this.#items.length);
    }
  }

  async #run(): Promise<void> {
    if (this.#active || this.#failed) return;
    const item = this.#items[0];
    if (item === undefined) return;
    this.#active = true;
    try {
      await this.#upload(item);
      this.#items.shift();
    } catch (error) {
      this.#failed = true;
      this.#active = false;
      this.#emit();
      this.#resolveIdle();
      if (!(error instanceof Error)) throw error;
      return;
    }
    this.#active = false;
    this.#emit();
    this.#resolveIdle();
    void this.#run();
  }

  #emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }

  #resolveIdle(): void {
    const waiters = this.#idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}

export class UploadQueueError extends Error {
  constructor(readonly pending: number) {
    super(`오디오 조각 ${pending}개 업로드를 완료하지 못했습니다.`);
    this.name = 'UploadQueueError';
  }
}

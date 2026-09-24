import type { TranslationContextTurn } from '../contracts';

export type TranslationResult = {
  readonly text: string;
};

export type TranslationRequest = {
  readonly text: string;
  readonly context: readonly TranslationContextTurn[];
};

export type CaptionSource = {
  readonly id: string;
  readonly sourceText: string;
  readonly timestamp: string;
};

export type InterpretationItem = CaptionSource & {
  readonly translation: string | null;
  readonly error: string | null;
  readonly status: 'pending' | 'translated' | 'error';
};

export type InterpretationSnapshot = {
  readonly items: readonly InterpretationItem[];
  readonly pending: number;
};

type Translator = (request: TranslationRequest, signal: AbortSignal) => Promise<TranslationResult>;
type SnapshotListener = (snapshot: InterpretationSnapshot) => void;

const MAX_PENDING_CAPTIONS = 12;
const MAX_CONTEXT_TURNS = 2;
const QUEUE_FULL_MESSAGE = '통역 대기열이 가득 찼습니다. 이 원문은 다시 시도해 주세요.';
const LOCAL_SERVER_MESSAGE = '로컬 통역 서버(127.0.0.1:3118)에 연결할 수 없습니다. 서버 실행 상태를 확인하세요.';

function translationErrorMessage(error: Error): string {
  if (error instanceof TypeError) return LOCAL_SERVER_MESSAGE;
  if (/fetch|network|connect|failed/i.test(error.message)) {
    return LOCAL_SERVER_MESSAGE;
  }
  if (error.message.trim()) return `통역 실패: ${error.message}`;
  return '통역에 실패했습니다. 다시 시도해 주세요.';
}

export class InterpretationQueue {
  private readonly translator: Translator;
  private readonly listener?: SnapshotListener;
  private items: InterpretationItem[] = [];
  private pendingIds: string[] = [];
  private active: { readonly id: string; readonly controller: AbortController; readonly generation: number } | null = null;
  private generation = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(translator: Translator, listener?: SnapshotListener) {
    this.translator = translator;
    this.listener = listener;
  }

  snapshot(): InterpretationSnapshot {
    return {
      items: [...this.items],
      pending: this.items.filter((item) => item.status === 'pending').length,
    };
  }

  enqueue(source: CaptionSource): boolean {
    if (this.items.some((item) => item.id === source.id)) return false;

    const pending = this.snapshot().pending;
    const accepted = pending < MAX_PENDING_CAPTIONS;
    this.items = [...this.items, {
      ...source,
      translation: null,
      error: accepted ? null : QUEUE_FULL_MESSAGE,
      status: accepted ? 'pending' : 'error',
    }];
    if (accepted) this.pendingIds.push(source.id);
    this.emit();
    void this.pump();
    return accepted;
  }

  upsert(source: CaptionSource): boolean {
    const current = this.items.find((item) => item.id === source.id);
    if (!current) return this.enqueue(source);
    if (current.sourceText === source.sourceText) return true;

    const isPending = current.status === 'pending';
    if (!isPending && this.snapshot().pending >= MAX_PENDING_CAPTIONS) {
      this.items = this.items.map((item) => item.id === source.id
        ? { ...item, ...source, translation: null, error: QUEUE_FULL_MESSAGE, status: 'error' }
        : item);
      this.emit();
      return false;
    }

    this.items = this.items.map((item) => item.id === source.id
      ? { ...item, ...source, translation: null, error: null, status: 'pending' }
      : item);
    if (this.active?.id === source.id) {
      this.generation += 1;
      this.active.controller.abort();
      this.active = null;
      this.pendingIds.unshift(source.id);
    } else if (!this.pendingIds.includes(source.id)) {
      this.pendingIds.push(source.id);
    }
    this.emit();
    void this.pump();
    return true;
  }

  retry(id: string): boolean {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.status !== 'error' || this.snapshot().pending >= MAX_PENDING_CAPTIONS) return false;

    this.items = this.items.map((candidate) => candidate.id === id
      ? { ...candidate, error: null, status: 'pending' }
      : candidate);
    this.pendingIds.unshift(id);
    this.emit();
    void this.pump();
    return true;
  }

  reset(): void {
    this.clear(true);
  }

  cancel(): void {
    this.clear(false);
  }

  private clear(emit: boolean): void {
    this.generation += 1;
    this.active?.controller.abort();
    this.active = null;
    this.pendingIds = [];
    this.items = [];
    if (emit) this.emit();
    this.resolveIdleWaiters();
  }

  waitForIdle(): Promise<void> {
    if (!this.active && this.pendingIds.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async pump(): Promise<void> {
    if (this.active) return;
    const id = this.pendingIds.shift();
    if (!id) {
      this.resolveIdleWaiters();
      return;
    }

    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.status !== 'pending') {
      void this.pump();
      return;
    }

    const generation = this.generation;
    const controller = new AbortController();
    this.active = { id, controller, generation };
    try {
      const itemIndex = this.items.findIndex((candidate) => candidate.id === id);
      const context = this.items
        .slice(0, itemIndex)
        .filter((candidate): candidate is InterpretationItem & { readonly translation: string } =>
          candidate.status === 'translated' && candidate.translation !== null)
        .slice(-MAX_CONTEXT_TURNS)
        .map((candidate) => ({ sourceText: candidate.sourceText, translation: candidate.translation }));
      const result = await this.translator({ text: item.sourceText, context }, controller.signal);
      if (!this.isCurrent(id, generation)) return;
      this.items = this.items.map((candidate) => candidate.id === id
        ? { ...candidate, translation: result.text, error: null, status: 'translated' }
        : candidate);
    } catch (error) {
      if (!this.isCurrent(id, generation)) return;
      const message = error instanceof Error
        ? translationErrorMessage(error)
        : '통역에 실패했습니다. 다시 시도해 주세요.';
      this.items = this.items.map((candidate) => candidate.id === id
        ? { ...candidate, error: message, status: 'error' }
        : candidate);
    } finally {
      if (this.isCurrent(id, generation)) {
        this.active = null;
        this.emit();
        void this.pump();
      }
    }
  }

  private isCurrent(id: string, generation: number): boolean {
    return this.active?.id === id && this.active.generation === generation && this.generation === generation;
  }

  private emit(): void {
    this.listener?.(this.snapshot());
  }

  private resolveIdleWaiters(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
}

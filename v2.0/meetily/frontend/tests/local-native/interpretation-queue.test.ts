import { describe, expect, test } from 'bun:test';

import {
  InterpretationQueue,
  type TranslationResult,
} from '../../src/local/native/interpretationQueue';

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

const source = (id: string, text: string) => ({
  id,
  sourceText: text,
  timestamp: '00:01',
});

describe('native interpretation queue', () => {
  test('translates finalized captions one at a time and preserves source order', async () => {
    // Given
    const first = deferred<TranslationResult>();
    const started: string[] = [];
    const queue = new InterpretationQueue(async ({ text }) => {
      started.push(text);
      if (text === '一番') return first.promise;
      return { text: '둘째' };
    });

    // When
    queue.enqueue(source('1', '一番'));
    queue.enqueue(source('2', '二番'));
    await Promise.resolve();

    // Then
    expect(started).toEqual(['一番']);
    first.resolve({ text: '첫째' });
    await queue.waitForIdle();
    expect(started).toEqual(['一番', '二番']);
    expect(queue.snapshot().items.map((item) => [item.sourceText, item.translation])).toEqual([
      ['一番', '첫째'],
      ['二番', '둘째'],
    ]);
  });

  test('uses prior translated turns as bounded context for the next caption', async () => {
    // Given
    const requests: Array<{
      readonly text: string;
      readonly context: readonly { readonly sourceText: string; readonly translation: string }[];
    }> = [];
    const queue = new InterpretationQueue(async (request) => {
      requests.push(request);
      return { text: `번역 ${requests.length}` };
    });
    queue.enqueue(source('1', '本日はありがとうございます。'));
    queue.enqueue(source('2', 'それでは始めさせていただきます。'));
    queue.enqueue(source('3', 'まず前回の結果をご説明します。'));
    queue.enqueue(source('4', 'この点について、どうお考えでしょうか。'));

    // When
    await queue.waitForIdle();

    // Then
    expect(requests[3]).toEqual({
      text: 'この点について、どうお考えでしょうか。',
      context: [
        { sourceText: 'それでは始めさせていただきます。', translation: '번역 2' },
        { sourceText: 'まず前回の結果をご説明します。', translation: '번역 3' },
      ],
    });
  });

  test('reset aborts the active request and ignores its late result', async () => {
    // Given
    const late = deferred<TranslationResult>();
    let requestSignal: AbortSignal | undefined;
    const queue = new InterpretationQueue(async (_request, signal) => {
      requestSignal = signal;
      return late.promise;
    });
    queue.enqueue(source('old', '古い会議'));
    await Promise.resolve();

    // When
    queue.reset();
    late.resolve({ text: '이전 회의' });
    await Promise.resolve();

    // Then
    expect(requestSignal?.aborted).toBe(true);
    expect(queue.snapshot()).toEqual({ items: [], pending: 0 });
  });

  test('cleanup cancellation keeps the queue reusable when StrictMode replays effects', async () => {
    // Given
    const first = deferred<TranslationResult>();
    let firstSignal: AbortSignal | undefined;
    const queue = new InterpretationQueue(async ({ text }, signal) => {
      if (text === '最初') {
        firstSignal = signal;
        return first.promise;
      }
      return { text: '다시 마운트됨' };
    });
    queue.enqueue(source('first', '最初'));
    await Promise.resolve();

    // When
    queue.cancel();
    queue.enqueue(source('replayed', '再マウント'));
    await queue.waitForIdle();
    first.resolve({ text: '늦은 이전 결과' });
    await Promise.resolve();

    // Then
    expect(firstSignal?.aborted).toBe(true);
    expect(queue.snapshot().items).toEqual([{
      ...source('replayed', '再マウント'),
      translation: '다시 마운트됨',
      error: null,
      status: 'translated',
    }]);
  });

  test('retains a failed original and retries it explicitly', async () => {
    // Given
    let attempts = 0;
    const queue = new InterpretationQueue(async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      return { text: '다시 번역됨' };
    });
    queue.enqueue(source('retry', '再試行'));
    await queue.waitForIdle();
    expect(queue.snapshot().items[0]?.error).toContain('127.0.0.1:3118');

    // When
    queue.retry('retry');
    await queue.waitForIdle();

    // Then
    expect(attempts).toBe(2);
    expect(queue.snapshot().items[0]).toMatchObject({
      sourceText: '再試行',
      translation: '다시 번역됨',
      status: 'translated',
    });
  });

  test('restarts an active caption revision and ignores the stale translation', async () => {
    // Given
    const oldTranslation = deferred<TranslationResult>();
    const newTranslation = deferred<TranslationResult>();
    const requested: string[] = [];
    let oldSignal: AbortSignal | undefined;
    const queue = new InterpretationQueue(async ({ text }, signal) => {
      requested.push(text);
      if (text === '古い途中') {
        oldSignal = signal;
        return oldTranslation.promise;
      }
      return newTranslation.promise;
    });
    queue.upsert(source('utterance-1', '古い途中'));
    await Promise.resolve();

    // When
    queue.upsert(source('utterance-1', '新しい全文'));
    await Promise.resolve();
    oldTranslation.resolve({ text: '오래된 번역' });
    newTranslation.resolve({ text: '새 전체 번역' });
    await queue.waitForIdle();

    // Then
    expect(oldSignal?.aborted).toBe(true);
    expect(requested).toEqual(['古い途中', '新しい全文']);
    expect(queue.snapshot().items).toEqual([{
      ...source('utterance-1', '新しい全文'),
      translation: '새 전체 번역',
      error: null,
      status: 'translated',
    }]);
  });

  test('coalesces queued revisions without interrupting another active caption', async () => {
    // Given
    const active = deferred<TranslationResult>();
    const requested: string[] = [];
    let activeSignal: AbortSignal | undefined;
    const queue = new InterpretationQueue(async ({ text }, signal) => {
      requested.push(text);
      if (text === '一番') {
        activeSignal = signal;
        return active.promise;
      }
      return { text: '최신 둘째' };
    });
    queue.enqueue(source('1', '一番'));
    queue.upsert(source('2', '二番の途中'));
    await Promise.resolve();

    // When
    queue.upsert(source('2', '二番の最新版'));
    active.resolve({ text: '첫째' });
    await queue.waitForIdle();

    // Then
    expect(activeSignal?.aborted).toBe(false);
    expect(requested).toEqual(['一番', '二番の最新版']);
    expect(queue.snapshot().items.map((item) => item.sourceText)).toEqual(['一番', '二番の最新版']);
  });

  test('clears a stale translation while a changed source revision is pending', async () => {
    // Given
    const revision = deferred<TranslationResult>();
    const requested: string[] = [];
    const queue = new InterpretationQueue(async ({ text }) => {
      requested.push(text);
      if (text === '確定した全文') return revision.promise;
      return { text: '기존 번역' };
    });
    queue.upsert(source('stable', '短い文'));
    await queue.waitForIdle();

    // When
    queue.upsert(source('stable', '確定した全文'));
    queue.upsert(source('stable', '確定した全文'));
    await Promise.resolve();

    // Then
    expect(queue.snapshot().items[0]).toMatchObject({
      sourceText: '確定した全文',
      translation: null,
      status: 'pending',
    });
    expect(requested).toEqual(['短い文', '確定した全文']);
    revision.resolve({ text: '확정 번역' });
    await queue.waitForIdle();
  });

  test('bounds pending work at twelve captions and retains the overflow original', async () => {
    // Given
    const blocked = deferred<TranslationResult>();
    const queue = new InterpretationQueue(async () => blocked.promise);

    // When
    const accepted = Array.from({ length: 13 }, (_, index) =>
      queue.enqueue(source(String(index), `原文 ${index}`)));

    // Then
    expect(accepted).toEqual([
      true, true, true, true, true, true, true, true, true, true, true, true, false,
    ]);
    expect(queue.snapshot().pending).toBe(12);
    expect(queue.snapshot().items[12]).toMatchObject({
      sourceText: '原文 12',
      status: 'error',
    });
    queue.reset();
    blocked.resolve({ text: '취소됨' });
  });
});

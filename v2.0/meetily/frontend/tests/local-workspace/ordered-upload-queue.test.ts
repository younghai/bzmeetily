import { describe, expect, test } from 'bun:test';

import { OrderedUploadQueue } from '../../src/local/orderedUploadQueue';

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

function deferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
}

describe('ordered upload queue', () => {
  test('uploads one chunk at a time in sequence order', async () => {
    // Given
    const first = deferred();
    const started: number[] = [];
    const queue = new OrderedUploadQueue<number>(3, async (value) => {
      started.push(value);
      if (value === 1) await first.promise;
    });

    // When
    expect(queue.enqueue(1)).toBe(true);
    expect(queue.enqueue(2)).toBe(true);
    await Promise.resolve();

    // Then
    expect(started).toEqual([1]);
    first.resolve();
    await queue.drain();
    expect(started).toEqual([1, 2]);
  });

  test('reports overflow while retaining the chunk for a safe stop and drain', async () => {
    // Given
    const blocked = deferred();
    const queue = new OrderedUploadQueue<number>(2, async () => blocked.promise);

    // When
    const accepted = [queue.enqueue(1), queue.enqueue(2), queue.enqueue(3)];

    // Then
    expect(accepted).toEqual([true, true, false]);
    expect(queue.snapshot().pending).toBe(3);
    blocked.resolve();
    await queue.drain();
  });

  test('retains a failed chunk and retries it before later chunks', async () => {
    // Given
    const attempts: number[] = [];
    let fail = true;
    const queue = new OrderedUploadQueue<number>(3, async (value) => {
      attempts.push(value);
      if (value === 1 && fail) {
        fail = false;
        throw new TypeError('network unavailable');
      }
    });
    queue.enqueue(1);
    queue.enqueue(2);
    await queue.waitForIdle();

    // When
    queue.retry();
    await queue.drain();

    // Then
    expect(attempts).toEqual([1, 1, 2]);
    expect(queue.snapshot()).toEqual({ pending: 0, failed: false });
  });
});

test('coalesces queued live revisions without replacing an active upload or reordering utterances', async () => {
  const blocked = deferred();
  const started: string[] = [];
  const queue = new OrderedUploadQueue<{ readonly sequence: number; readonly text: string }>(3, async item => {
    started.push(item.text);
    if (item.text === 'a') await blocked.promise;
  }, item => item.sequence);
  queue.enqueue({sequence:0,text:'a'});
  queue.enqueue({sequence:0,text:'ab'});
  queue.enqueue({sequence:0,text:'abc'});
  queue.enqueue({sequence:1,text:'d'});
  expect(queue.snapshot().pending).toBe(3);
  blocked.resolve();
  await queue.drain();
  expect(started).toEqual(['a','abc','d']);
});

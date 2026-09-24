import { describe, expect, test } from 'bun:test';

import { flushWorklet } from '../../src/local/audio/flush';

describe('worklet flush', () => {
  test('reports a timeout instead of silently treating a missing ACK as complete', async () => {
    // Given
    const channel = new MessageChannel();
    const runImmediately = (callback: () => void): (() => void) => {
      callback();
      return () => undefined;
    };

    // When
    const outcome = await flushWorklet(channel.port1, runImmediately);

    // Then
    expect(outcome).toBe('timed-out');
    channel.port1.close();
    channel.port2.close();
  });
});

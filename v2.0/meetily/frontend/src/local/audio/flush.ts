export type FlushOutcome = 'acknowledged' | 'timed-out';

type ScheduleTimeout = (callback: () => void, delayMs: number) => () => void;

const scheduleTimeout: ScheduleTimeout = (callback, delayMs) => {
  const timeout = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timeout);
};

function isFlushAck(value: unknown, requestId: number): boolean {
  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, 'type') === 'flush-ack'
    && Reflect.get(value, 'requestId') === requestId;
}

export async function flushWorklet(
  port: MessagePort,
  timeoutScheduler: ScheduleTimeout = scheduleTimeout,
): Promise<FlushOutcome> {
  const requestId = Date.now() + Math.random();
  return await new Promise<FlushOutcome>((resolve) => {
    let settled = false;
    let cancelTimeout = (): void => undefined;
    const finish = (outcome: FlushOutcome): void => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      port.removeEventListener('message', onMessage);
      resolve(outcome);
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (isFlushAck(event.data, requestId)) finish('acknowledged');
    };
    port.addEventListener('message', onMessage);
    cancelTimeout = timeoutScheduler(() => finish('timed-out'), 1_000);
    if (settled) cancelTimeout();
    port.postMessage({ type: 'flush', requestId });
  });
}

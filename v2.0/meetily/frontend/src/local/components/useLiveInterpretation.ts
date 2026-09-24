'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { startCapture, type AudioChunk, type CaptureSession, type CaptureSource, type StartCaptureOptions } from '../audio';
import { requestTranslation, transcribeLiveChunk } from '../client';
import { InterpretationQueue, type InterpretationSnapshot } from '../native/interpretationQueue';
import { OrderedUploadQueue } from '../orderedUploadQueue';
import type { ServiceStatus } from '../contracts';

export type LiveInterpretationPhase = 'idle' | 'requesting' | 'recording' | 'draining' | 'error';

type Options = {
  readonly status: ServiceStatus | null;
  /** Alternate audio source (e.g. Tauri native capture). Defaults to browser capture. */
  readonly startCaptureImpl?: (options: StartCaptureOptions) => Promise<CaptureSession>;
};

const MAX_PENDING_CHUNKS = 12;
const OVERFLOW_MESSAGE = '전사 대기열이 가득 찼습니다. 통역을 중지하고 남은 음성을 처리합니다.';
const ASR_FAILURE_MESSAGE = '일본어 음성 전사에 실패했습니다.';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === 'string' && error.trim().length > 0) return error;
  return '실시간 통역을 완료하지 못했습니다.';
}

function timestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// allow: SIZE_OK — live capture lifecycle and its coordinated queues form one state machine.
export function useLiveInterpretation({ status, startCaptureImpl }: Options) {
  const [phase, setPhase] = useState<LiveInterpretationPhase>('idle');
  const [source, setSourceState] = useState<CaptureSource>('both');
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [pendingAsr, setPendingAsr] = useState(0);
  const [translationSnapshot, setTranslationSnapshot] = useState<InterpretationSnapshot>({ items: [], pending: 0 });
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<CaptureSession | null>(null);
  const asrQueueRef = useRef<OrderedUploadQueue<AudioChunk> | null>(null);
  const translationQueueRef = useRef<InterpretationQueue | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const runControllerRef = useRef<AbortController | null>(null);
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const asrFailureRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  if (translationQueueRef.current === null) {
    translationQueueRef.current = new InterpretationQueue(
      ({ text, context }, signal) => requestTranslation(text, context, signal),
      (snapshot) => {
        if (mountedRef.current) setTranslationSnapshot(snapshot);
      },
    );
  }

  useEffect(() => {
    if (phase !== 'recording' || startedAtRef.current === null) return;
    const update = (): void => setElapsed((performance.now() - (startedAtRef.current ?? performance.now())) / 1000);
    update();
    const timer = globalThis.setInterval(update, 250);
    return () => globalThis.clearInterval(timer);
  }, [phase]);

  const finishPending = useCallback(async (): Promise<void> => {
    const asrQueue = asrQueueRef.current;
    let asrError: unknown;
    try {
      if (asrQueue !== null) await asrQueue.drain();
    } catch (queueError) {
      asrError = queueError;
    }
    await translationQueueRef.current?.waitForIdle();
    if (asrError !== undefined) throw asrError;
  }, []);

  const stop = useCallback((): Promise<void> => {
    if (stopPromiseRef.current !== null) return stopPromiseRef.current;
    const session = sessionRef.current;
    if (session === null && requestControllerRef.current === null) return Promise.resolve();
    const completion = (async (): Promise<void> => {
      sessionRef.current = null;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      if (mountedRef.current) setPhase('draining');
      try {
        if (session !== null) {
          const result = await session.stop();
          if (result.warning && mountedRef.current) setError(result.warning);
        }
        await finishPending();
        if (mountedRef.current) {
          setLevel(0);
          setPhase('idle');
        }
      } catch (stopError) {
        if (mountedRef.current) {
          setLevel(0);
          setError(asrFailureRef.current ?? errorMessage(stopError));
          setPhase('error');
        }
      } finally {
        if (asrQueueRef.current?.snapshot().failed !== true) {
          runControllerRef.current = null;
          asrQueueRef.current = null;
        }
        stopPromiseRef.current = null;
      }
    })();
    stopPromiseRef.current = completion;
    return completion;
  }, [finishPending]);

  const start = useCallback(async (): Promise<void> => {
    if (phase !== 'idle' && phase !== 'error') return;
    if (!status?.ready || !status.whisper.ready || !status.ollama.ready) {
      setError('일본어 전사와 한국어 통역 모델이 준비되지 않았습니다.');
      setPhase('error');
      return;
    }
    runControllerRef.current?.abort();
    runControllerRef.current = null;
    asrQueueRef.current = null;
    asrFailureRef.current = null;
    translationQueueRef.current?.reset();
    setTranslationSnapshot({ items: [], pending: 0 });
    setPendingAsr(0);
    setError(null);
    setElapsed(0);
    setLevel(0);
    setPhase('requesting');
    const requestController = new AbortController();
    const runController = new AbortController();
    requestControllerRef.current = requestController;
    runControllerRef.current = runController;
    const queue = new OrderedUploadQueue<AudioChunk>(MAX_PENDING_CHUNKS, async (chunk) => {
      let result: Awaited<ReturnType<typeof transcribeLiveChunk>>;
      try {
        result = await transcribeLiveChunk(chunk, runController.signal);
        asrFailureRef.current = null;
      } catch (uploadError) {
        asrFailureRef.current = `${ASR_FAILURE_MESSAGE} ${errorMessage(uploadError)}`;
        throw uploadError;
      }
      const sourceText = result.segments.map(segment => segment.sourceText).join('').trim();
      if (sourceText) translationQueueRef.current?.upsert({
        id: `live-${chunk.sequence}`,
        sourceText,
        timestamp: timestamp(chunk.start),
      });
    }, chunk => chunk.sequence);
    asrQueueRef.current = queue;
    queue.subscribe((snapshot) => {
      if (!mountedRef.current || asrQueueRef.current !== queue) return;
      setPendingAsr(snapshot.pending);
      if (snapshot.failed) {
        setError(asrFailureRef.current ?? `${ASR_FAILURE_MESSAGE} 다시 시도할 수 있습니다.`);
        void stop();
      }
    });
    try {
      const capture = startCaptureImpl ?? startCapture;
      const session = await capture({
        source,
        signal: requestController.signal,
        retainRecording: false,
        onLevel: (nextLevel) => {
          if (mountedRef.current) setLevel(nextLevel);
        },
        onChunk: (chunk) => {
          if (!queue.enqueue(chunk)) {
            if (mountedRef.current) setError(OVERFLOW_MESSAGE);
            void stop();
          }
        },
        onEnded: (reason) => {
          if (reason === 'audio-error' && mountedRef.current) {
            setError('음성 처리 대기열이 가득 차 통역을 중지했습니다. 입력 장치와 처리 속도를 확인한 뒤 다시 시작하세요.');
          }
          void stop();
        },
      });
      if (requestController.signal.aborted) {
        await session.abort();
        return;
      }
      sessionRef.current = session;
      startedAtRef.current = performance.now();
      if (mountedRef.current) setPhase('recording');
    } catch (startError) {
      if (!requestController.signal.aborted && mountedRef.current) {
        setError(errorMessage(startError));
        setPhase('error');
      }
      runController.abort();
      asrQueueRef.current = null;
    } finally {
      if (requestControllerRef.current === requestController) requestControllerRef.current = null;
    }
  }, [phase, source, status, stop, startCaptureImpl]);

  const retry = useCallback(async (): Promise<void> => {
    const queue = asrQueueRef.current;
    if (queue === null || !queue.snapshot().failed) return;
    setError(null);
    setPhase('draining');
    queue.retry();
    try {
      await finishPending();
      runControllerRef.current = null;
      asrQueueRef.current = null;
      asrFailureRef.current = null;
      if (mountedRef.current) {
        setPendingAsr(0);
        setPhase('idle');
      }
    } catch (retryError) {
      if (mountedRef.current) {
        setError(asrFailureRef.current ?? errorMessage(retryError));
        setPhase('error');
      }
    }
  }, [finishPending]);

  const clear = useCallback((): void => {
    if (phase === 'recording' || phase === 'requesting' || phase === 'draining') return;
    runControllerRef.current?.abort();
    runControllerRef.current = null;
    asrQueueRef.current = null;
    asrFailureRef.current = null;
    translationQueueRef.current?.reset();
    setTranslationSnapshot({ items: [], pending: 0 });
    setError(null);
    setElapsed(0);
    setPendingAsr(0);
    setPhase('idle');
  }, [phase]);

  const setSource = useCallback((nextSource: CaptureSource): void => {
    if (phase === 'idle' || phase === 'error') setSourceState(nextSource);
  }, [phase]);

  const retryTranslation = useCallback((id: string): boolean => translationQueueRef.current?.retry(id) ?? false, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestControllerRef.current?.abort();
      runControllerRef.current?.abort();
      translationQueueRef.current?.cancel();
      void sessionRef.current?.abort();
    };
  }, []);

  return {
    phase,
    source,
    setSource,
    level,
    elapsed,
    pending: pendingAsr + translationSnapshot.pending,
    error,
    items: translationSnapshot.items,
    locked: phase === 'requesting' || phase === 'recording' || phase === 'draining',
    recoverable: asrQueueRef.current?.snapshot().failed ?? false,
    start,
    stop,
    retry,
    retryTranslation,
    clear,
  } as const;
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { saveMeetingAudio, uploadChunk } from '../client';
import type { LocalSegment, MeetingDetail, ServiceStatus } from '../contracts';
import { startCapture } from '../audio';
import type { AudioChunk, CaptureSession, CaptureSource } from '../audio';
import { OrderedUploadQueue } from '../orderedUploadQueue';
import { recordingLock, recordingSaveNotice, recordingStartBlock } from '../recordingPolicy';
import type { RecordingPhase } from '../recordingPolicy';

type Options = {
  readonly meeting: MeetingDetail | null;
  readonly serviceStatus: ServiceStatus | null;
  readonly disabled: boolean;
  readonly onSegments: (meetingId: string, segments: readonly LocalSegment[]) => void;
  readonly onReload: (meetingId: string) => Promise<void>;
};

const MAX_PENDING_CHUNKS = 12;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '녹음을 처리하지 못했습니다.';
}

export function useRecordingController(options: Options) {
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [source, setSource] = useState<CaptureSource>('microphone');
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<CaptureSession | null>(null);
  const queueRef = useRef<OrderedUploadQueue<AudioChunk> | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const pendingRecordingRef = useRef<Blob | null>(null);
  const captureWarningRef = useRef<string | null>(null);
  const meetingIdRef = useRef<string | null>(null);
  const previousMeetingIdRef = useRef<string | null>(options.meeting?.id ?? null);
  const stoppingRef = useRef(false);
  const mountedRef = useRef(true);
  const startBlock = recordingStartBlock(options.meeting, options.serviceStatus, options.disabled);

  const finishSave = useCallback(async (): Promise<void> => {
    const queue = queueRef.current;
    const meetingId = meetingIdRef.current;
    const recording = pendingRecordingRef.current;
    if (!queue || !meetingId || !recording) return;
    await queue.drain();
    await saveMeetingAudio(meetingId, recording);
    await options.onReload(meetingId);
    pendingRecordingRef.current = null;
    queueRef.current = null;
    if (mountedRef.current) {
      setPending(0);
      setPhase('idle');
      setError(recordingSaveNotice(captureWarningRef.current, null));
    }
  }, [options.onReload]);

  const stop = useCallback(async (): Promise<void> => {
    if (stoppingRef.current) return;
    const session = sessionRef.current;
    if (!session) {
      requestAbortRef.current?.abort();
      setPhase('idle');
      return;
    }
    stoppingRef.current = true;
    setPhase('draining');
    setLevel(0);
    try {
      const result = await session.stop();
      sessionRef.current = null;
      pendingRecordingRef.current = result.recording;
      captureWarningRef.current = result.warning ?? null;
      if (result.warning) setError(result.warning);
      await finishSave();
    } catch (caught) {
      if (mountedRef.current) {
        setError(recordingSaveNotice(captureWarningRef.current, errorMessage(caught)));
        setPhase('error');
      }
    } finally {
      stoppingRef.current = false;
    }
  }, [finishSave]);

  const start = useCallback(async (): Promise<void> => {
    const meeting = options.meeting;
    if (!meeting || phase !== 'idle') return;
    const block = recordingStartBlock(meeting, options.serviceStatus, options.disabled);
    if (block) {
      setError(block);
      return;
    }

    setPhase('requesting');
    setError(null);
    captureWarningRef.current = null;
    setElapsed(0);
    const request = new AbortController();
    requestAbortRef.current = request;
    meetingIdRef.current = meeting.id;
    const queue = new OrderedUploadQueue<AudioChunk>(MAX_PENDING_CHUNKS, async (chunk) => {
      try {
        const result = await uploadChunk(meeting.id, chunk);
        options.onSegments(meeting.id, result.segments);
      } catch (caught) {
        if (mountedRef.current) setError(errorMessage(caught));
        throw caught;
      }
    });
    queueRef.current = queue;
    queue.subscribe((snapshot) => {
      if (mountedRef.current) setPending(snapshot.pending);
      if (snapshot.failed) void stop();
    });

    try {
      const session = await startCapture({
        source,
        signal: request.signal,
        onLevel: setLevel,
        onChunk: (chunk) => {
          if (queue.enqueue(chunk)) return;
          setError('처리 속도가 녹음보다 느려 안전하게 녹음을 중지했습니다. 업로드 후 재시도해 주세요.');
          void stop();
        },
        onEnded: () => void stop(),
      });
      if (request.signal.aborted || !mountedRef.current) {
        await session.abort();
        return;
      }
      sessionRef.current = session;
      startedAtRef.current = performance.now();
      setPhase('recording');
    } catch (caught) {
      if (request.signal.aborted) return;
      setError(errorMessage(caught));
      setPhase('error');
    }
  }, [options.disabled, options.meeting, options.onSegments, options.serviceStatus, phase, source, stop]);

  const retry = useCallback(async (): Promise<void> => {
    const queue = queueRef.current;
    if (!queue || !pendingRecordingRef.current) {
      captureWarningRef.current = null;
      setPhase('idle');
      setError(null);
      return;
    }
    setPhase('draining');
    setError(captureWarningRef.current);
    queue.retry();
    try {
      await finishSave();
    } catch (caught) {
      setError(recordingSaveNotice(captureWarningRef.current, errorMessage(caught)));
      setPhase('error');
    }
  }, [finishSave]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = window.setInterval(() => {
      setElapsed((performance.now() - startedAtRef.current) / 1000);
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    const meetingId = options.meeting?.id ?? null;
    if (previousMeetingIdRef.current !== meetingId && pendingRecordingRef.current === null) {
      captureWarningRef.current = null;
      setError(null);
    }
    previousMeetingIdRef.current = meetingId;
  }, [options.meeting?.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestAbortRef.current?.abort();
      void sessionRef.current?.abort();
    };
  }, []);

  return {
    phase,
    source,
    level,
    pending,
    elapsed,
    error,
    startBlock,
    setSource,
    start,
    stop,
    retry,
    clearError: () => {
      if (pendingRecordingRef.current !== null) return;
      captureWarningRef.current = null;
      setError(null);
      if (phase === 'error' && !queueRef.current) setPhase('idle');
    },
    recoverable: pendingRecordingRef.current !== null,
    locked: recordingLock(phase, pendingRecordingRef.current !== null),
  };
}

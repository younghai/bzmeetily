import { useCallback, useEffect, useRef, useState } from 'react';

import { RecordingStatus, useRecordingState } from '@/contexts/RecordingStateContext';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { recordingService, type LiveInterpretationSource } from '@/services/recordingService';

type Phase = 'idle' | 'starting' | 'live' | 'stopping' | 'draining' | 'error';

type Options = {
  readonly pendingTranslations: number;
  readonly micDeviceName: string | null;
  readonly systemDeviceName: string | null;
};

export function useLiveInterpretation(options: Options) {
  const recordingState = useRecordingState();
  const backendLive = recordingState.isRecording && recordingState.isLiveInterpretation;
  const [phase, setPhase] = useState<Phase>(() => backendLive ? 'live' : 'idle');
  const [source, setSource] = useState<LiveInterpretationSource>('both');
  const [error, setError] = useState<string | null>(null);
  const actionRef = useRef(false);
  const observedBackendLiveRef = useRef(backendLive);
  const { clearTranscripts } = useTranscripts();
  const { setStatus } = recordingState;

  useEffect(() => {
    if (backendLive) {
      observedBackendLiveRef.current = true;
      if (phase === 'idle' || phase === 'error') {
        setError(null);
        setPhase('live');
      }
      return;
    }

    if (!observedBackendLiveRef.current || recordingState.isRecording || recordingState.isLiveInterpretation) return;
    observedBackendLiveRef.current = false;
    if (phase !== 'live' && phase !== 'stopping') return;
    if (options.pendingTranslations > 0) {
      setPhase('draining');
      return;
    }
    setPhase('idle');
  }, [backendLive, options.pendingTranslations, phase, recordingState.isLiveInterpretation, recordingState.isRecording]);

  const start = useCallback(async () => {
    if (actionRef.current || !['idle', 'error'].includes(phase)) return;
    actionRef.current = true;
    setError(null);
    setPhase('starting');
    setStatus(RecordingStatus.STARTING, '실시간 통역을 준비하고 있습니다.');
    clearTranscripts();
    try {
      await recordingService.startLiveInterpretation(
        options.micDeviceName,
        options.systemDeviceName,
        source,
      );
      setPhase('live');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setPhase('error');
      setStatus(RecordingStatus.ERROR, message);
    } finally {
      actionRef.current = false;
    }
  }, [clearTranscripts, options.micDeviceName, options.systemDeviceName, phase, setStatus, source]);

  const stop = useCallback(async () => {
    if (actionRef.current || phase !== 'live') return;
    actionRef.current = true;
    setError(null);
    setPhase('stopping');
    setStatus(RecordingStatus.STOPPING, '실시간 음성 입력을 중지하고 있습니다.');
    try {
      await recordingService.stopLiveInterpretation();
      observedBackendLiveRef.current = false;
      if (options.pendingTranslations > 0) {
        setPhase('draining');
      } else {
        setPhase('idle');
        setStatus(RecordingStatus.IDLE);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setPhase('live');
      setStatus(RecordingStatus.RECORDING, message);
    } finally {
      actionRef.current = false;
    }
  }, [options.pendingTranslations, phase, setStatus]);

  useEffect(() => {
    if (phase !== 'draining' || options.pendingTranslations > 0) return;
    setPhase('idle');
    setStatus(RecordingStatus.IDLE);
  }, [options.pendingTranslations, phase, setStatus]);

  return {
    phase,
    source,
    error,
    locked: ['starting', 'live', 'stopping', 'draining'].includes(phase),
    setSource,
    start,
    stop,
  };
}

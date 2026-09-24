'use client';

import { Copy, Download, LoaderCircle, Mic, Square } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { InterpretationView } from '@/local/components/InterpretationView';
import { useLiveInterpretation } from '@/local/components/useLiveInterpretation';
import { getServiceStatus } from '@/local/client';
import type { ServiceStatus } from '@/local/contracts';
import type { StartCaptureOptions } from '@/local/audio';

import { startTauriPcmCapture, type TauriCaptureSource } from './tauriPcmCapture';

function captionText(items: readonly { sourceText: string; translation: string | null; error: string | null; timestamp: string }[]): string {
  return items.map((item) => {
    const korean = item.translation ?? `[통역 오류: ${item.error ?? '처리 중'}]`;
    return `[${item.timestamp}] JA: ${item.sourceText}\n[${item.timestamp}] KO: ${korean}`;
  }).join('\n\n');
}

type Props = {
  readonly active: boolean;
  readonly onClose: () => void;
};

const STATUS_POLL_INTERVAL_MS = 5_000;

// Shared with the web pipeline: contextual utterance revisions (LiveAudioChunker),
// bounded ordered ASR queue, cancel/retry translation queue. Only the audio
// source differs — Rust native capture streams mixed PCM into the same chunker.
export function NativeInterpretation({ active, onClose }: Props) {
  const { selectedDevices } = useConfig();
  const { isRecording } = useRecordingState();
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const refresh = (): void => {
      getServiceStatus(controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) {
            setStatus(next);
            setStatusError(null);
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setStatusError(error instanceof Error ? error.message : '로컬 서비스 상태를 확인할 수 없습니다.');
          }
        });
    };
    refresh();
    const timer = globalThis.setInterval(refresh, STATUS_POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      globalThis.clearInterval(timer);
    };
  }, [active]);

  const startTauriCapture = useCallback((options: StartCaptureOptions) => {
    const source: TauriCaptureSource = options.source;
    return startTauriPcmCapture({
      source,
      micDeviceName: selectedDevices.micDevice,
      systemDeviceName: selectedDevices.systemDevice,
      onChunk: options.onChunk,
      onLevel: options.onLevel,
      onEnded: options.onEnded,
      signal: options.signal,
    });
  }, [selectedDevices.micDevice, selectedDevices.systemDevice]);

  const live = useLiveInterpretation({
    status,
    startCaptureImpl: startTauriCapture,
  });

  const start = async () => {
    await live.start();
  };

  const copyCaptions = async () => {
    try {
      await navigator.clipboard.writeText(captionText(live.items));
      toast.success('한일 자막을 클립보드에 복사했습니다.');
    } catch (error) {
      if (error instanceof Error) {
        toast.error(`자막 복사 실패: ${error.message}`);
        return;
      }
      throw error;
    }
  };

  const exportCaptions = () => {
    const blob = new Blob([captionText(live.items)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `meetily2-ja-ko-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const modelsNotReady = status !== null && (!status.ready || !status.whisper.ready || !status.ollama.ready);
  const setupError = statusError ?? (modelsNotReady
    ? '일본어 전사·한국어 통역 서비스가 준비되지 않았습니다. 모델 설치 상태를 확인하세요.'
    : null);

  const statusLabel = live.phase === 'requesting'
    ? '통역 준비 중'
    : live.phase === 'draining'
      ? '남은 음성 처리 중'
      : live.phase === 'recording'
        ? live.pending > 0
          ? `한국어 통역 ${live.pending}개 처리 중`
          : '일본어 듣는 중'
        : live.items.length > 0
          ? '통역 종료'
          : '시작 대기';

  const viewControls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="mr-auto flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" aria-live="polite">
        <p className="text-sm font-medium text-slate-700 [word-break:keep-all]">{statusLabel}</p>
        {live.level > 0.001 && live.phase === 'recording' && (
          <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        )}
        <span aria-hidden="true" className="text-slate-300">·</span>
        <p className="text-xs text-slate-500 [word-break:keep-all]">음성·회의 기록 저장 안 함</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="native-live-source" className="sr-only">실시간 통역 음성 입력</label>
        <select
          id="native-live-source"
          value={live.source}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === 'both' || value === 'display' || value === 'microphone') live.setSource(value);
          }}
          disabled={live.locked}
          className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          <option value="both">컴퓨터 소리 + 마이크</option>
          <option value="display">컴퓨터 소리</option>
          <option value="microphone">마이크</option>
        </select>
        {live.phase === 'recording' ? (
          <Button variant="destructive" size="sm" className="h-11" onClick={() => void live.stop()}>
            <Square className="h-4 w-4" /> 통역 중지
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-11"
            onClick={() => void start()}
            disabled={live.locked}
          >
            {live.phase === 'requesting' || live.phase === 'draining'
              ? <LoaderCircle className="h-4 w-4 animate-spin" />
              : <Mic className="h-4 w-4" />}
            통역 시작
          </Button>
        )}
        {live.recoverable && (
          <Button variant="outline" size="sm" className="h-11" onClick={() => void live.retry()}>
            남은 구간 재시도
          </Button>
        )}
        {live.items.length > 0 && (
          <>
            <Button variant="outline" size="sm" onClick={copyCaptions} title="한일 자막 복사">
              <Copy className="h-4 w-4" /> 자막 복사
            </Button>
            <Button variant="outline" size="sm" onClick={exportCaptions} title="한일 자막 내보내기">
              <Download className="h-4 w-4" /> 내보내기
            </Button>
          </>
        )}
      </div>
      {(setupError || live.error) && (
        <p role="alert" className="basis-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 [word-break:keep-all]">
          {setupError ?? live.error}
        </p>
      )}
    </div>
  );

  return (
    <InterpretationView
      open={active}
      items={live.items}
      pending={live.pending > 0}
      onClose={onClose}
      onRetryTranslation={live.retryTranslation}
      closeDisabled={isRecording || live.locked}
      pipeline
      controls={viewControls}
    />
  );
}

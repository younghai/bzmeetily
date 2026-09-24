import { CircleStop, Mic, RotateCcw } from 'lucide-react';

import type { CaptureSource } from '../audio';
import type { MeetingDetail, ServiceStatus } from '../contracts';

type Props = {
  readonly meeting: MeetingDetail | null;
  readonly status: ServiceStatus | null;
  readonly phase: 'idle' | 'requesting' | 'recording' | 'draining' | 'error';
  readonly source: CaptureSource;
  readonly level: number;
  readonly elapsed: number;
  readonly pending: number;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly startBlock: string | null;
  readonly recoverable: boolean;
  readonly onSource: (source: CaptureSource) => void;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onRetry: () => void;
};

function formatElapsed(seconds: number): string {
  const total = Math.floor(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function phaseLabel(phase: Props['phase']): string {
  switch (phase) {
    case 'idle': return '대기';
    case 'requesting': return '권한 요청 중';
    case 'recording': return '녹음 중';
    case 'draining': return '남은 음성 처리 중';
    case 'error': return '확인 필요';
  }
}

export function RecordingControls(props: Props) {
  const needsTranslation = props.meeting?.interpret === true;
  const active = props.phase === 'recording';

  return (
    <section aria-labelledby="recording-controls" className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="recording-controls" className="text-sm font-semibold text-slate-900">실시간 기록</h2>
          <p aria-live="polite" className="mt-1 text-xs text-slate-500">
            {phaseLabel(props.phase)} · {formatElapsed(props.elapsed)} · 대기 조각 {props.pending}개
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-slate-600">
            입력 소스
            <select
              value={props.source}
              disabled={props.disabled || props.phase !== 'idle'}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'microphone' || value === 'display' || value === 'both') props.onSource(value);
              }}
              className="mt-1 block h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            >
              <option value="microphone">마이크</option>
              <option value="display">화면/탭 오디오</option>
              <option value="both">마이크 + 화면</option>
            </select>
          </label>
          {active || props.phase === 'requesting' ? (
            <button
              type="button"
              onClick={props.onStop}
              className="flex h-11 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white outline-none hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              <CircleStop aria-hidden="true" className="h-4 w-4" /> 중지
            </button>
          ) : (
            <button
              type="button"
              disabled={props.disabled || props.startBlock !== null || props.phase === 'draining'}
              onClick={props.onStart}
              aria-describedby={props.startBlock ? 'recording-readiness' : undefined}
              className="flex h-11 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white outline-none hover:bg-slate-800 focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Mic aria-hidden="true" className="h-4 w-4" /> 녹음
            </button>
          )}
        </div>
      </div>
      <div
        role="meter"
        aria-label="입력 음량"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(props.level * 100)}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"
      >
        <div className="h-full origin-left rounded-full bg-blue-600 transition-transform" style={{ transform: `scaleX(${Math.min(1, props.level * 5)})` }} />
      </div>
      <p id="recording-readiness" className={`mt-3 text-xs ${!props.status?.whisper.ready || (needsTranslation && !props.status?.ollama.ready) ? 'text-red-700' : 'text-green-700'}`}>
        음성 인식 {props.status?.whisper.ready ? '준비됨' : '사용 불가'}
        {needsTranslation && ` · 한국어 통역 ${props.status?.ollama.ready ? '준비됨' : '사용 불가'}`}
      </p>
      {props.startBlock && <p className="mt-1 text-xs text-slate-600">{props.startBlock}</p>}
      {props.error && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{props.error}</span>
          <button type="button" onClick={props.onRetry} className="flex h-9 items-center gap-1 rounded-md border border-red-300 px-3 font-medium outline-none focus:ring-2 focus:ring-red-500">
            <RotateCcw aria-hidden="true" className="h-4 w-4" /> {props.recoverable ? '재시도' : '닫기'}
          </button>
        </div>
      )}
    </section>
  );
}

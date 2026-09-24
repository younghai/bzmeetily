'use client';

import { CircleStop, Mic } from 'lucide-react';

import type { ServiceStatus } from '../contracts';
import { InterpretationView } from './InterpretationView';
import { useLiveInterpretation } from './useLiveInterpretation';

type Props = {
  readonly status: ServiceStatus | null;
  readonly onClose: () => void;
  readonly onRefreshStatus: () => void;
};

export function LiveInterpretation({ status, onClose, onRefreshStatus }: Props) {
  const live = useLiveInterpretation({ status });
  const capturing = live.phase === 'recording' || live.phase === 'requesting';
  const elapsed = `${String(Math.floor(live.elapsed / 60)).padStart(2, '0')}:${String(Math.floor(live.elapsed % 60)).padStart(2, '0')}`;
  const label = live.phase === 'recording' ? '일본어를 듣고 있습니다'
    : live.phase === 'requesting' ? '오디오 연결 중'
      : live.phase === 'draining' ? '남은 전사·통역 처리 중'
        : live.phase === 'error' ? '확인 필요'
          : live.items.length > 0 ? '통역 종료' : '시작 대기';

  return (
    <InterpretationView
      open
      pipeline
      items={live.items}
      pending={live.pending > 0}
      closeDisabled={live.locked}
      onClose={onClose}
      onRetryTranslation={live.retryTranslation}
      controls={(
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p role="status" className="text-sm font-medium text-slate-800">{label} <span className="ml-1 tabular-nums text-slate-500">{elapsed}</span></p>
            {live.pending > 0 && <span className="text-xs text-blue-700">통역 {live.pending}개 처리 중</span>}
            <span aria-hidden="true" className="text-slate-300">·</span>
            <p className="text-xs text-slate-500">녹음 파일 저장 안 함</p>
            <div role="meter" aria-label="일본어 입력 음량" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, live.level * 5) * 100)} className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full origin-left rounded-full bg-blue-600 transition-transform" style={{ transform: `scaleX(${Math.min(1, live.level * 5)})` }} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <span>일본어 입력</span>
                <select aria-label="일본어 음성 입력" value={live.source} disabled={live.locked} onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'microphone' || value === 'display' || value === 'both') live.setSource(value);
                }} className="h-11 max-w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100">
                  <option value="microphone">마이크</option>
                  <option value="display">컴퓨터 소리 (화면/탭)</option>
                  <option value="both">컴퓨터 소리 + 마이크</option>
                </select>
          </label>
          {capturing ? (
            <button type="button" onClick={() => void live.stop()} className="flex h-11 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white outline-none hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2">
              <CircleStop aria-hidden="true" className="h-4 w-4" /> 통역 중지
            </button>
          ) : (
            <button type="button" disabled={live.locked || !status?.ready} onClick={() => void live.start()} className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white outline-none hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300">
              <Mic aria-hidden="true" className="h-4 w-4" /> {live.items.length > 0 ? '새 통역 시작' : '통역 시작'}
            </button>
          )}
          <p className="basis-full text-xs text-slate-500">말하는 동안 자막이 보완됩니다. 잠시 말을 멈추면 문장이 확정됩니다.</p>
          {live.source !== 'microphone' && !live.locked && <p className="basis-full text-xs text-slate-600">컴퓨터 소리는 시작 후 공유 대상을 선택해 주세요.</p>}
          {!status?.ready && <div role="status" className="flex basis-full flex-wrap items-center gap-2 text-xs text-red-700"><span>음성 인식·번역 모델 연결을 확인해 주세요.</span><button type="button" onClick={onRefreshStatus} className="min-h-11 rounded-lg border border-slate-300 px-3 text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500">상태 새로고침</button></div>}
          {live.error && <div role="alert" className="flex basis-full flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 p-2 text-sm text-red-700"><p>{live.error}</p>{live.recoverable && <button type="button" onClick={() => void live.retry()} className="min-h-11 rounded-lg border border-red-300 px-3 font-medium focus-visible:ring-2 focus-visible:ring-red-500">남은 구간 재시도</button>}</div>}
        </div>
      )}
    />
  );
}

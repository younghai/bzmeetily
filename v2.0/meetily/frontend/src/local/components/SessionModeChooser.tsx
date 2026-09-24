'use client';

import { ArrowRight, Languages, Mic } from 'lucide-react';

export type SessionMode = 'interpretation' | 'recording';

type Props = {
  readonly onSelect: (mode: SessionMode) => void;
  readonly disabled?: boolean;
};

export function SessionModeChooser({ onSelect, disabled = false }: Props) {
  return (
    <section aria-labelledby="session-mode-heading" className="mx-auto flex min-h-[70vh] w-full max-w-3xl flex-col justify-center px-4 py-8 text-slate-900 [word-break:keep-all] sm:px-8">
      <p className="text-sm font-semibold tracking-wide text-blue-700">Meetily</p>
      <h1 id="session-mode-heading" className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">어떤 작업을 시작할까요?</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">먼저 모드를 선택하세요. 다음 화면에서 시작 버튼을 눌러 음성을 입력합니다.</p>
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <button type="button" disabled={disabled} onClick={() => onSelect('interpretation')} className="group flex min-h-52 flex-col items-start rounded-xl border-2 border-blue-600 bg-blue-50 p-6 text-left outline-none transition-colors hover:bg-blue-100 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-4 disabled:opacity-50">
          <Languages aria-hidden="true" className="h-7 w-7 text-blue-700" />
          <span className="mt-4 text-xl font-semibold text-blue-950">실시간 통역</span>
          <span className="mt-2 text-sm leading-6 text-blue-900">일본어 음성 → 실시간 전사 → 한국어 통역.<br />지난 대화도 타임라인에서 다시 봅니다.</span>
          <span className="mt-5 flex items-center gap-2 text-sm font-semibold text-blue-700">통역 화면으로 <ArrowRight aria-hidden="true" className="h-4 w-4" /></span>
        </button>
        <button type="button" disabled={disabled} onClick={() => onSelect('recording')} className="flex min-h-52 flex-col items-start rounded-xl border border-slate-300 bg-white p-6 text-left outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-4 disabled:opacity-50">
          <Mic aria-hidden="true" className="h-7 w-7 text-slate-600" />
          <span className="mt-4 text-xl font-semibold">회의 녹음</span>
          <span className="mt-2 text-sm leading-6 text-slate-600">녹음·파일 가져오기 → 전사 확인 →<br />한국어 회의록 생성 순서로 진행합니다.</span>
          <span className="mt-5 flex items-center gap-2 text-sm font-semibold text-slate-700">회의 화면으로 <ArrowRight aria-hidden="true" className="h-4 w-4" /></span>
        </button>
      </div>
    </section>
  );
}

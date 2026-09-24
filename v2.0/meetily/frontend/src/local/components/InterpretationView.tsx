'use client';

import { LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { JapaneseText } from './JapaneseText';
import { KoreanText } from './KoreanText';

export type InterpretationViewItem = {
  readonly id: string;
  readonly sourceText: string;
  readonly translation: string | null;
  readonly error?: string | null;
  readonly timestamp?: string | number;
};

export type InterpretationViewProps = {
  readonly open: boolean;
  readonly items: readonly InterpretationViewItem[];
  readonly pending?: boolean;
  readonly onClose: () => void;
  readonly onRetryTranslation?: (id: string) => void;
  readonly controls?: ReactNode;
  readonly closeDisabled?: boolean;
  readonly pipeline?: boolean;
};

export function groupInterpretationItems(items: readonly InterpretationViewItem[]): readonly (readonly InterpretationViewItem[])[] {
  const groups: InterpretationViewItem[][] = [];
  for (let index = 0; index < items.length; index += 6) groups.push(items.slice(index, index + 6));
  return groups;
}

function formatTimestamp(timestamp: string | number | undefined): string | null {
  if (timestamp === undefined) return null;
  if (typeof timestamp === 'string') return timestamp;
  const seconds = Math.max(0, Math.floor(timestamp));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function InterpretationView({ open, items, pending = false, onClose, onRetryTranslation, controls, closeDisabled = false, pipeline = false }: InterpretationViewProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const japanesePaneRef = useRef<HTMLElement>(null);
  const koreanPaneRef = useRef<HTMLElement>(null);
  const timelineRef = useRef<HTMLOListElement>(null);
  const followJapaneseRef = useRef(true);
  const followKoreanRef = useRef(true);
  const followTimelineRef = useRef(true);
  const groups = groupInterpretationItems(items);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeDisabledRef = useRef(closeDisabled);
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    if (!open) return;
    followJapaneseRef.current = true;
    followKoreanRef.current = true;
    followTimelineRef.current = true;
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!closeDisabledRef.current) onCloseRef.current();
      }
      if (event.key === 'Tab') {
        const targets = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
        ) ?? []).filter((target) => target.getClientRects().length > 0);
        if (targets.length === 0) return;
        const currentIndex = targets.indexOf(document.activeElement instanceof HTMLElement ? document.activeElement : targets[0]);
        const nextIndex = event.shiftKey
          ? (currentIndex <= 0 ? targets.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % targets.length;
        event.preventDefault();
        targets[nextIndex]?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (followJapaneseRef.current && japanesePaneRef.current) {
      japanesePaneRef.current.scrollTop = japanesePaneRef.current.scrollHeight;
    }
    if (followKoreanRef.current && koreanPaneRef.current) {
      koreanPaneRef.current.scrollTop = koreanPaneRef.current.scrollHeight;
    }
    if (followTimelineRef.current && timelineRef.current) {
      timelineRef.current.scrollLeft = timelineRef.current.scrollWidth;
    }
  }, [open, items, pending]);

  const showConversation = (index: number): void => {
    followJapaneseRef.current = false;
    followKoreanRef.current = false;
    followTimelineRef.current = false;
    for (const pane of [japanesePaneRef.current, koreanPaneRef.current]) {
      const article = pane?.querySelector<HTMLElement>(`[data-conversation-index="${index}"]`);
      if (!pane || !article) continue;
      const offset = article.getBoundingClientRect().top - pane.getBoundingClientRect().top;
      pane.scrollTo({ top: pane.scrollTop + offset - 48, behavior: 'smooth' });
    }
  };

  const showLatestConversation = (): void => {
    followJapaneseRef.current = true;
    followKoreanRef.current = true;
    followTimelineRef.current = true;
    for (const pane of [japanesePaneRef.current, koreanPaneRef.current]) {
      if (pane) pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' });
    }
    if (timelineRef.current) timelineRef.current.scrollLeft = timelineRef.current.scrollWidth;
  };

  if (!open) return null;

  const dialog = (
    <div className="fixed inset-0 z-50 w-full min-w-0 overflow-hidden bg-white" role="presentation">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="interpretation-view-title"
        className="flex h-full w-full min-w-0 flex-col overflow-hidden [word-break:keep-all] bg-white"
      >
        <header className="flex min-w-0 shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-4 py-2 sm:px-6">
          <div className="min-w-0">
            <h2 id="interpretation-view-title" className="text-balance text-lg font-semibold text-slate-900 sm:text-xl">일본어 → 한국어 동시통역</h2>
            <p className="mt-0.5 text-xs text-slate-500">대화 타임라인에서 이전 내용을 선택하거나 각 창을 스크롤하세요.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            title={closeDisabled ? '통역을 중지한 후 닫을 수 있습니다.' : undefined}
            className="flex h-11 shrink-0 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 outline-none hover:bg-slate-50 focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
          >
            <X aria-hidden="true" className="h-4 w-4" /> 닫기
          </button>
        </header>

        {pipeline && (
          <ol aria-label="실시간 통역 순서" className="grid shrink-0 grid-cols-3 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs sm:px-6">
            <li className="flex items-center justify-between gap-1 pr-2"><span><span className="mr-1.5 font-semibold text-blue-700">01</span>일본어 음성</span><span aria-hidden="true" className="text-slate-400">→</span></li>
            <li className="flex items-center justify-between gap-1 pr-2"><span><span className="mr-1.5 font-semibold text-blue-700">02</span>일본어 전사</span><span aria-hidden="true" className="text-slate-400">→</span></li>
            <li><span className="mr-1.5 font-semibold text-blue-700">03</span>한국어 통역</li>
          </ol>
        )}
        {controls && <div className="shrink-0 border-b border-slate-200 px-4 py-2 sm:px-6">{controls}</div>}

        {groups.length > 0 && (
          <nav aria-label="대화 타임라인" className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 sm:px-6">
            <span className="shrink-0 text-xs font-semibold text-slate-600">이전 대화</span>
            <ol
              ref={timelineRef}
              onScroll={(event) => {
                const timeline = event.currentTarget;
                followTimelineRef.current = timeline.scrollWidth - timeline.clientWidth - timeline.scrollLeft < 48;
              }}
              className="flex min-w-0 flex-1 gap-2 overflow-x-auto"
            >
              {groups.map((group, index) => (
                <li key={group[0].id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => showConversation(index)}
                    aria-label={`${formatTimestamp(group[0].timestamp) ?? `${index + 1}번째`} 대화 보기`}
                    className="flex min-h-11 w-44 flex-col items-start rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left outline-none hover:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <span className="text-xs tabular-nums text-blue-700">{formatTimestamp(group[0].timestamp) ?? `${index + 1}번째`}</span>
                    <span lang="ja" className="w-full truncate text-xs text-slate-700">{group.map((item) => item.sourceText).join('')}</span>
                    <span lang="ko" className="w-full truncate text-xs text-slate-500">{group.map((item) => item.translation ?? '').filter(Boolean).join(' ') || '통역 중'}</span>
                  </button>
                </li>
              ))}
            </ol>
            <button type="button" onClick={showLatestConversation} className="min-h-11 shrink-0 rounded-lg border border-blue-300 bg-white px-3 text-xs font-semibold text-blue-700 outline-none hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500">최근 대화</button>
          </nav>
        )}

        <div className="min-h-0 w-full min-w-0 flex-1 overflow-x-auto">
          <div className="grid h-full min-w-[44rem] grid-cols-2 divide-x divide-slate-200">
            <section
              ref={japanesePaneRef}
              tabIndex={0}
              onScroll={(event) => {
                const pane = event.currentTarget;
                followJapaneseRef.current = pane.scrollHeight - pane.clientHeight - pane.scrollTop < 80;
              }}
              aria-label="일본어 원문 스크롤 영역"
              aria-labelledby="interpretation-ja-heading"
              className="min-w-0 overflow-y-auto bg-white outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
            >
              <h3 id="interpretation-ja-heading" className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-2.5 text-sm font-semibold text-slate-700 backdrop-blur sm:px-8">JA · 일본어 전사</h3>
              <div className="space-y-6 px-5 py-5 sm:px-8">
                {items.length === 0 && !pending && <p className="py-12 text-center text-sm text-slate-500">통역할 원문을 기다리고 있습니다.</p>}
                {groups.map((group, index) => (
                  <article key={group[0].id} data-conversation-index={index}>
                    {formatTimestamp(group[0].timestamp) && <p className="mb-2 text-xs tabular-nums text-slate-400">{formatTimestamp(group[0].timestamp)}</p>}
                    <JapaneseText text={group.map((item) => item.sourceText).join('')} className="block text-lg leading-9 text-slate-900 sm:text-xl sm:leading-10" />
                  </article>
                ))}
                {pending && <p role="status" className="flex items-center gap-2 py-2 text-sm text-slate-500"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> 다음 원문 처리 중…</p>}
              </div>
            </section>

            <section
              ref={koreanPaneRef}
              tabIndex={0}
              onScroll={(event) => {
                const pane = event.currentTarget;
                followKoreanRef.current = pane.scrollHeight - pane.clientHeight - pane.scrollTop < 80;
              }}
              aria-label="한국어 통역 스크롤 영역"
              aria-labelledby="interpretation-ko-heading"
              className="min-w-0 overflow-y-auto bg-blue-50/60 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 [word-break:keep-all]"
            >
              <h3 id="interpretation-ko-heading" className="sticky top-0 z-10 border-b border-blue-100 bg-blue-50/95 px-5 py-2.5 text-sm font-semibold text-blue-800 backdrop-blur sm:px-8">KO · 한국어 통역</h3>
              <div className="space-y-6 px-5 py-5 sm:px-8">
                {items.length === 0 && !pending && <p className="py-12 text-center text-sm text-slate-500">한국어 통역을 기다리고 있습니다.</p>}
                {groups.map((group, index) => (
                  <article key={group[0].id} data-conversation-index={index}>
                    {formatTimestamp(group[0].timestamp) && <p className="mb-2 text-xs tabular-nums text-blue-500">{formatTimestamp(group[0].timestamp)}</p>}
                    {group.some((item) => item.translation) && (
                      <KoreanText text={group.map((item) => item.translation ?? '').filter(Boolean).join(' ')} className="block text-lg leading-9 text-slate-900 [word-break:keep-all] sm:text-xl sm:leading-10" />
                    )}
                    {group.filter((item) => item.error).map((item) => (
                      <div key={item.id} lang="ko" role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm leading-6 text-red-700 [word-break:keep-all]">
                        <p className="break-words">통역 확인 필요 · {item.error}</p>
                        {onRetryTranslation && <button type="button" onClick={() => onRetryTranslation(item.id)} className="min-h-11 rounded-lg border border-red-300 px-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-red-500">다시 통역</button>}
                      </div>
                    ))}
                    {group.some((item) => !item.translation && !item.error) && <p lang="ko" className="mt-2 text-sm text-slate-500">통역 대기 중</p>}
                  </article>
                ))}
                {pending && <p role="status" className="flex items-center gap-2 py-2 text-sm text-blue-700"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> 한국어 통역 중…</p>}
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

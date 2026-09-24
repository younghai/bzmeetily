import { Download, RefreshCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { MeetingDetail } from '../contracts';

type Props = {
  readonly meeting: MeetingDetail;
  readonly disabled: boolean;
  readonly onRename: (title: string) => Promise<void>;
  readonly onReload: () => void;
};

function exportMarkdown(meeting: MeetingDetail): void {
  const lines = [`# ${meeting.title}`, '', `- 원문 언어: ${meeting.language}`, `- 통역: ${meeting.interpret ? '일본어 → 한국어' : '사용 안 함'}`, ''];
  for (const segment of meeting.segments) {
    lines.push(`## ${Math.floor(segment.start / 60)}:${String(Math.floor(segment.start % 60)).padStart(2, '0')}`);
    lines.push('', `**원문:** ${segment.sourceText}`, '');
    if (segment.translation) lines.push(`**한국어:** ${segment.translation}`, '');
    if (segment.translationError) lines.push(`> 번역 확인 필요: ${segment.translationError}`, '');
  }
  if (meeting.summary) lines.push('## 한국어 요약', '', meeting.summary, '');
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${meeting.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MeetingHeader({ meeting, disabled, onRename, onReload }: Props) {
  const [title, setTitle] = useState(meeting.title);
  useEffect(() => setTitle(meeting.title), [meeting.id, meeting.title]);

  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <label className="min-w-0 basis-full sm:flex-1 sm:basis-auto text-xs font-medium text-slate-600">
        회의 제목
        <span className="mt-1 flex gap-2">
          <input
            value={title}
            disabled={disabled}
            onChange={(event) => setTitle(event.target.value)}
            className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
          <button type="button" aria-label="제목 저장" disabled={disabled || !title.trim() || title.trim() === meeting.title} onClick={() => void onRename(title.trim())} className="h-11 rounded-lg border border-slate-300 px-3 text-slate-700 outline-none hover:bg-white focus:ring-2 focus:ring-blue-500 disabled:opacity-40">
            <Save aria-hidden="true" className="h-4 w-4" />
          </button>
        </span>
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={disabled} onClick={onReload} className="flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none hover:bg-slate-50 focus:ring-2 focus:ring-blue-500 disabled:opacity-50">
          <RefreshCw aria-hidden="true" className="h-4 w-4" /> 새로고침
        </button>
        <button type="button" disabled={disabled || meeting.segments.length === 0} onClick={() => exportMarkdown(meeting)} className="flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none hover:bg-slate-50 focus:ring-2 focus:ring-blue-500 disabled:opacity-50">
          <Download aria-hidden="true" className="h-4 w-4" /> Markdown
        </button>
      </div>
    </header>
  );
}

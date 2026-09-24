import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { LocalMeeting } from '../contracts';

type Props = {
  readonly meetings: readonly LocalMeeting[];
  readonly selectedId: string | null;
  readonly disabled: boolean;
  readonly onSelect: (id: string) => void;
};

export function MeetingSidebar({ meetings, selectedId, disabled, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return meetings;
    return meetings.filter((meeting) => meeting.title.toLocaleLowerCase().includes(normalized));
  }, [meetings, query]);

  return (
    <aside className="w-full shrink-0 border-b border-slate-200 bg-white md:w-64 md:border-b-0 md:border-r">
      <div className="border-b border-slate-200 p-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Meetily 로컬</h1>
        <p className="mt-1 text-xs text-slate-500">기기에 안전하게 저장되는 회의 기록</p>
        <label className="relative mt-4 block">
          <span className="sr-only">회의 검색</span>
          <Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="회의 검색"
          />
        </label>
      </div>
      <nav aria-label="저장된 회의" className="max-h-48 overflow-y-auto p-2 md:max-h-[calc(100vh-137px)]">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500">
            {meetings.length === 0 ? '아직 저장된 회의가 없습니다.' : '검색 결과가 없습니다.'}
          </p>
        ) : filtered.map((meeting) => (
          <button
            key={meeting.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(meeting.id)}
            className={`mb-1 min-h-11 w-full rounded-lg px-3 py-2 text-left outline-none transition-colors focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${
              meeting.id === selectedId ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span className="block truncate text-sm font-medium">{meeting.title}</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {new Date(meeting.updatedAt).toLocaleDateString('ko-KR')} · {meeting.segmentCount}개 구간
            </span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

import { FileUp, Plus } from 'lucide-react';
import { useRef, useState } from 'react';

import { languageSchema } from '../contracts';
import type { SourceLanguage } from '../contracts';

type Props = {
  readonly disabled: boolean;
  readonly onCreate: (title: string, language: SourceLanguage, interpret: boolean) => Promise<void>;
  readonly onImport: (file: File, title: string, language: SourceLanguage, interpret: boolean) => Promise<void>;
};

const languageLabels = {
  ja: '일본어',
  ko: '한국어',
  en: '영어',
  auto: '자동 감지',
} as const;

export function MeetingSetup({ disabled, onCreate, onImport }: Props) {
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<SourceLanguage>('ja');
  const [interpret, setInterpret] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const changeLanguage = (next: SourceLanguage): void => {
    setLanguage(next);
    setInterpret(next === 'ja');
  };

  const usableTitle = title.trim();

  return (
    <section aria-labelledby="meeting-setup" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="meeting-setup" className="text-sm font-semibold text-slate-900">새 회의</h2>
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(180px,1fr)_140px_auto_auto] xl:items-end">
        <label className="text-xs font-medium text-slate-600">
          회의 제목
          <input
            value={title}
            disabled={disabled}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="예: 일본 파트너 주간 회의"
            className="mt-1 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          원문 언어
          <select
            value={language}
            disabled={disabled}
            onChange={(event) => changeLanguage(languageSchema.parse(event.target.value))}
            className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          >
            {Object.entries(languageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="flex h-11 items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 px-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={interpret}
            disabled={disabled || language !== 'ja'}
            onChange={(event) => setInterpret(event.target.checked)}
          />
          일본어 → 한국어 통역
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled || !usableTitle}
            onClick={() => void onCreate(usableTitle, language, interpret)}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white outline-none hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Plus aria-hidden="true" className="h-4 w-4" /> 만들기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.webm"
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const importedTitle = usableTitle || file.name.replace(/\.[^.]+$/, '');
              void onImport(file, importedTitle, language, interpret);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            className="flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 outline-none hover:bg-slate-50 focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            <FileUp aria-hidden="true" className="h-4 w-4" /> 파일
          </button>
        </div>
      </div>
      {language !== 'ja' && <p className="mt-2 text-xs text-slate-500">한국어·영어 회의는 원문 그대로 기록하며 통역을 사용하지 않습니다.</p>}
    </section>
  );
}

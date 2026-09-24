import { FileText, Play, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { getMeetingAudio } from '../client';
import type { MeetingDetail } from '../contracts';

type Props = {
  readonly meeting: MeetingDetail;
  readonly disabled: boolean;
  readonly onGenerate: () => void;
};

export function SummaryPanel({ meeting, disabled, onGenerate }: Props) {
  const [audioError, setAudioError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => {
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const toggleAudio = async (): Promise<void> => {
    if (audioRef.current && playing) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }
    try {
      setAudioError(null);
      if (!audioRef.current) {
        const blob = await getMeetingAudio(meeting.id);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        audioRef.current = new Audio(url);
        audioRef.current.addEventListener('ended', () => setPlaying(false));
      }
      await audioRef.current.play();
      setPlaying(true);
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : '녹음을 재생하지 못했습니다.');
    }
  };

  return (
    <section aria-labelledby="summary-title" className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="summary-title" className="text-sm font-semibold text-slate-900">한국어 요약</h2>
          <p className="mt-0.5 text-xs text-slate-500">저장된 전사 내용을 기준으로 생성합니다.</p>
        </div>
        <div className="flex gap-2">
          {meeting.audioAvailable && (
            <button type="button" disabled={disabled} onClick={() => void toggleAudio()} className="flex h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm text-slate-700 outline-none hover:bg-slate-50 focus:ring-2 focus:ring-blue-500 disabled:opacity-50">
              {playing ? <Square aria-hidden="true" className="h-4 w-4" /> : <Play aria-hidden="true" className="h-4 w-4" />}
              {playing ? '재생 중지' : '녹음 재생'}
            </button>
          )}
          <button type="button" disabled={disabled || meeting.segments.length === 0} onClick={onGenerate} className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white outline-none hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-slate-300">
            <FileText aria-hidden="true" className="h-4 w-4" /> {meeting.summary ? '요약 다시 생성' : '요약 생성'}
          </button>
        </div>
      </div>
      {audioError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{audioError}</p>}
      <div lang="ko" className="prose prose-sm mt-4 max-w-none text-slate-800">
        {meeting.summary ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{meeting.summary}</ReactMarkdown> : <p className="text-slate-500">생성된 요약이 없습니다.</p>}
      </div>
    </section>
  );
}

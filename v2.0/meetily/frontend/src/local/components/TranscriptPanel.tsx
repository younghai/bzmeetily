import { Languages, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { CaptureSource } from '../audio';
import type { LocalSegment, SourceLanguage } from '../contracts';
import { InterpretationView } from './InterpretationView';
import { JapaneseText } from './JapaneseText';
import { KoreanText } from './KoreanText';

type Props = {
  readonly segments: readonly LocalSegment[];
  readonly language: SourceLanguage;
  readonly interpret: boolean;
  readonly source: CaptureSource;
  readonly recordingLocked: boolean;
};

function timestamp(seconds: number): string {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function koreanVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  return window.speechSynthesis.getVoices().find((voice) => voice.localService && voice.lang.toLowerCase().startsWith('ko')) ?? null;
}

const sourceLabels = { ja: 'JA 원문', ko: 'KO 원문', en: 'EN 원문', auto: '원문' } as const;

export function TranscriptPanel({ segments, language, interpret, source, recordingLocked }: Props) {
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [interpretationOpen, setInterpretationOpen] = useState(false);
  const canOfferSpeech = interpret || language === 'ko';
  const speechAllowed = canOfferSpeech && source === 'microphone' && !recordingLocked;

  useEffect(() => {
    if (speechAllowed) return;
    setSpeechEnabled(false);
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  }, [speechAllowed]);

  useEffect(() => () => {
    window.speechSynthesis?.cancel();
  }, []);

  const speak = (text: string): void => {
    if (!speechEnabled || !speechAllowed) return;
    const voice = koreanVoice();
    if (!voice) {
      setSpeechError('이 기기에서 로컬 한국어 음성을 찾지 못했습니다.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };

  return (
    <section aria-labelledby="transcript-title" className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 id="transcript-title" className="text-sm font-semibold text-slate-900">전사와 통역</h2>
          <p className="mt-0.5 text-xs text-slate-500">{interpret ? '일본어 원문과 한국어 통역을 함께 보존합니다.' : '원문을 시간 순서대로 보존합니다.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {interpret && (
            <button type="button" onClick={() => setInterpretationOpen(true)} className="flex h-11 items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 text-sm font-medium text-blue-800 outline-none hover:bg-blue-100 focus:ring-2 focus:ring-blue-500">
              <Languages aria-hidden="true" className="h-4 w-4" /> 통역 창 열기
            </button>
          )}
          {canOfferSpeech && <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={speechEnabled}
              disabled={!speechAllowed}
              onChange={(event) => {
                setSpeechError(null);
                setSpeechEnabled(event.target.checked);
                if (!event.target.checked) window.speechSynthesis?.cancel();
              }}
            />
            한국어 음성 읽기
          </label>}
        </div>
      </div>
      {canOfferSpeech && source !== 'microphone' && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          화면/탭 오디오가 다시 녹음되는 피드백을 막기 위해 음성 읽기를 사용할 수 없습니다.
        </p>
      )}
      {speechError && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{speechError}</p>}
      <div className="max-h-[42vh] overflow-y-auto p-3">
        {segments.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium text-slate-700">아직 기록된 음성이 없습니다.</p>
            <p className="mt-1 text-xs text-slate-500">녹음을 시작하거나 기존 오디오 파일을 가져오세요.</p>
          </div>
        ) : segments.map((segment) => {
          const paired = interpret || segment.translation !== null || segment.translationError !== null;
          const speechText = segment.translation ?? (language === 'ko' ? segment.sourceText : null);
          return (
          <article key={segment.id} className={`mb-3 grid gap-2 rounded-xl border border-slate-200 p-3 ${paired ? 'lg:grid-cols-2' : ''}`}>
            <div lang={language === 'auto' ? undefined : language} className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                <span>{sourceLabels[language]} · {timestamp(segment.start)}</span>
              </div>
              {language === 'ja' ? (
                <JapaneseText text={segment.sourceText} className="block whitespace-pre-wrap text-balance text-sm leading-6 text-slate-900" />
              ) : (
                <p className="whitespace-pre-wrap break-normal text-balance text-sm leading-6 text-slate-900 [overflow-wrap:anywhere]">{segment.sourceText}</p>
              )}
            </div>
            {paired && <div lang="ko" className="min-w-0 rounded-lg bg-blue-50 p-3">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-blue-700">
                <span>KO 통역</span>
                {speechText && (
                  <button
                    type="button"
                    aria-label="이 한국어 통역 듣기"
                    disabled={!speechEnabled || !speechAllowed}
                    onClick={() => speak(speechText)}
                    className="rounded-md p-1 outline-none hover:bg-blue-100 focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
                  >
                    {speechEnabled ? <Volume2 aria-hidden="true" className="h-4 w-4" /> : <VolumeX aria-hidden="true" className="h-4 w-4" />}
                  </button>
                )}
              </div>
              {segment.translation ? (
                <KoreanText text={segment.translation} className="block whitespace-pre-wrap text-balance text-sm leading-6 text-slate-900 [word-break:keep-all]" />
              ) : (
                <p className="text-sm text-slate-500">통역 없음</p>
              )}
              {segment.translationError && <p role="alert" className="mt-2 text-xs text-red-700">원문은 보존됨 · {segment.translationError}</p>}
            </div>}
          </article>
        );})}
      </div>
      <InterpretationView
        open={interpretationOpen}
        items={segments.map((segment) => ({
          id: segment.id,
          sourceText: segment.sourceText,
          translation: segment.translation,
          error: segment.translationError,
          timestamp: segment.start,
        }))}
        pending={recordingLocked}
        onClose={() => setInterpretationOpen(false)}
      />
    </section>
  );
}

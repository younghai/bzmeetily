'use client';

import { LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  listGlossary,
  setGlossaryTermEnabled,
} from '../client';
import type { GlossaryTerm } from '../contracts';

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
};

/**
 * Glossary manager: proper-noun terms bias Whisper's transcription prompt and
 * the translation prompt; `replacement` rules additionally rewrite the
 * transcript text deterministically before translation.
 */
export function GlossaryManager({ open, onClose }: Props) {
  const [terms, setTerms] = useState<readonly GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceValue, setSourceValue] = useState('');
  const [destinationValue, setDestinationValue] = useState('');
  const [kind, setKind] = useState<'term' | 'replacement'>('term');
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setTerms(await listGlossary());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '용어집을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    if (!sourceValue.trim() || !destinationValue.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createGlossaryTerm(sourceValue.trim(), destinationValue.trim(), kind);
      setSourceValue('');
      setDestinationValue('');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '용어 추가에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = async (term: GlossaryTerm): Promise<void> => {
    setError(null);
    try {
      const updated = await setGlossaryTermEnabled(term.id, !term.enabled);
      setTerms((current) => current.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '상태 변경에 실패했습니다.');
    }
  };

  const remove = async (term: GlossaryTerm): Promise<void> => {
    setError(null);
    try {
      await deleteGlossaryTerm(term.id);
      setTerms((current) => current.filter((candidate) => candidate.id !== term.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '삭제에 실패했습니다.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label="용어집 관리">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">용어집</h2>
            <p className="mt-1 text-sm text-slate-600 [word-break:keep-all]">
              자주 나오는 고유명사·용어를 등록하면 전사와 통역에 즉시 반영됩니다.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="닫기">✕</Button>
        </div>

        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={sourceValue}
              onChange={(event) => setSourceValue(event.currentTarget.value)}
              placeholder="인식되는 표기 (예: ミティリー)"
              className="h-11 flex-1 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={120}
            />
            <input
              value={destinationValue}
              onChange={(event) => setDestinationValue(event.currentTarget.value)}
              placeholder="올바른 표기 (예: Meetily)"
              className="h-11 flex-1 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={120}
            />
            <select
              value={kind}
              onChange={(event) => setKind(event.currentTarget.value === 'replacement' ? 'replacement' : 'term')}
              className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="용어 종류"
            >
              <option value="term">용어 (프롬프트 반영)</option>
              <option value="replacement">치환 (텍스트 교체)</option>
            </select>
            <Button className="h-11" disabled={submitting || !sourceValue.trim() || !destinationValue.trim()} onClick={() => void submit()}>
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 추가
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500 [word-break:keep-all]">
            용어: 전사·번역 프롬프트에 반영되어 올바른 표기를 유도합니다. 치환: 전사 텍스트에서 확정적으로 교체합니다.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 [word-break:keep-all]">{error}</p>}
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-500">
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> 불러오는 중…
            </div>
          ) : terms.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500 [word-break:keep-all]">등록된 용어가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {terms.map((term) => (
                <li key={term.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={term.enabled}
                    onChange={() => void toggle(term)}
                    aria-label={`${term.sourceValue} 사용 ${term.enabled ? '끄기' : '켜기'}`}
                    className="h-4 w-4"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-900">
                      {term.sourceValue} <span aria-hidden="true" className="text-slate-400">→</span> {term.destinationValue}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{term.kind === 'replacement' ? '치환' : '용어'}</p>
                  </div>
                  <Button variant="ghost" size="sm" aria-label={`${term.sourceValue} 삭제`} onClick={() => void remove(term)}>
                    <Trash2 className="h-4 w-4 text-slate-500" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-200 px-5 py-3">
          <Button variant="outline" onClick={onClose}>닫기</Button>
        </div>
      </div>
    </div>
  );
}

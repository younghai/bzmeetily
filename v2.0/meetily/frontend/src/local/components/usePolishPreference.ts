'use client';

import { useCallback, useState } from 'react';

const STORAGE_KEY = 'meetily2.polish';

export function readPolishPreference(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(STORAGE_KEY) !== 'false';
}

/** Translation-cleanup toggle, persisted across sessions. */
export function usePolishPreference(): readonly [boolean, (next: boolean) => void] {
  const [polish, setPolish] = useState(readPolishPreference);
  const update = useCallback((next: boolean): void => {
    setPolish(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Private-mode storage failures must not break the toggle.
    }
  }, []);
  return [polish, update] as const;
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createMeeting,
  generateSummary,
  getMeeting,
  getServiceStatus,
  importMeeting,
  listMeetings,
  renameMeeting,
} from './client';
import type { LocalMeeting, LocalSegment, MeetingDetail, ServiceStatus, SourceLanguage } from './contracts';

export type WorkspaceState = {
  readonly status: ServiceStatus | null;
  readonly meetings: readonly LocalMeeting[];
  readonly selected: MeetingDetail | null;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly operation: 'creating' | 'importing' | 'renaming' | 'summarizing' | null;
  readonly error: string | null;
};

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
}

export function useWorkspace() {
  const [state, setState] = useState<WorkspaceState>({
    status: null,
    meetings: [],
    selected: null,
    loading: true,
    busy: false,
    operation: null,
    error: null,
  });
  const requestGeneration = useRef(0);
  const readAbortRef = useRef<AbortController | null>(null);
  const statusAbortRef = useRef<AbortController | null>(null);

  const refreshMeetings = useCallback(async (): Promise<void> => {
    const meetings = await listMeetings();
    setState((current) => ({ ...current, meetings }));
  }, []);

  const loadMeeting = useCallback(async (id: string): Promise<void> => {
    const generation = ++requestGeneration.current;
    readAbortRef.current?.abort();
    const controller = new AbortController();
    readAbortRef.current = controller;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const selected = await getMeeting(id, controller.signal);
      if (generation !== requestGeneration.current) return;
      setState((current) => ({ ...current, selected, loading: false }));
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState((current) => ({ ...current, loading: false, error: messageFor(error) }));
    }
  }, []);

  const initialize = useCallback(async (): Promise<void> => {
    const generation = ++requestGeneration.current;
    readAbortRef.current?.abort();
    const controller = new AbortController();
    readAbortRef.current = controller;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [status, meetings] = await Promise.all([
        getServiceStatus(controller.signal),
        listMeetings(controller.signal),
      ]);
      if (generation !== requestGeneration.current) return;
      const selected = meetings[0] ? await getMeeting(meetings[0].id, controller.signal) : null;
      if (generation !== requestGeneration.current) return;
      setState({ status, meetings, selected, loading: false, busy: false, operation: null, error: null });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState((current) => ({ ...current, loading: false, error: messageFor(error) }));
    }
  }, []);

  const refreshStatus = useCallback(async (): Promise<void> => {
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    try {
      const status = await getServiceStatus(controller.signal);
      setState((current) => ({ ...current, status, error: null }));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState((current) => ({ ...current, error: messageFor(error) }));
    }
  }, []);

  useEffect(() => {
    void initialize();
    return () => {
      requestGeneration.current += 1;
      readAbortRef.current?.abort();
      statusAbortRef.current?.abort();
    };
  }, [initialize]);

  const create = useCallback(async (
    title: string,
    language: SourceLanguage,
    interpret: boolean,
  ): Promise<void> => {
    setState((current) => ({ ...current, busy: true, operation: 'creating', error: null }));
    try {
      const meeting = await createMeeting(title, language, interpret);
      await refreshMeetings();
      await loadMeeting(meeting.id);
    } catch (error) {
      setState((current) => ({ ...current, error: messageFor(error) }));
    } finally {
      setState((current) => ({ ...current, busy: false, operation: null }));
    }
  }, [loadMeeting, refreshMeetings]);

  const importFile = useCallback(async (
    file: File,
    title: string,
    language: SourceLanguage,
    interpret: boolean,
  ): Promise<void> => {
    setState((current) => ({ ...current, busy: true, operation: 'importing', error: null }));
    try {
      const result = await importMeeting(file, title, language, interpret);
      await refreshMeetings();
      setState((current) => ({ ...current, selected: result.meeting }));
    } catch (error) {
      setState((current) => ({ ...current, error: messageFor(error) }));
    } finally {
      setState((current) => ({ ...current, busy: false, operation: null }));
    }
  }, [refreshMeetings]);

  const rename = useCallback(async (title: string): Promise<void> => {
    if (!state.selected) return;
    setState((current) => ({ ...current, busy: true, operation: 'renaming', error: null }));
    try {
      await renameMeeting(state.selected.id, title);
      await Promise.all([refreshMeetings(), loadMeeting(state.selected.id)]);
    } catch (error) {
      setState((current) => ({ ...current, error: messageFor(error) }));
    } finally {
      setState((current) => ({ ...current, busy: false, operation: null }));
    }
  }, [loadMeeting, refreshMeetings, state.selected]);

  const summarize = useCallback(async (): Promise<void> => {
    if (!state.selected) return;
    setState((current) => ({ ...current, busy: true, operation: 'summarizing', error: null }));
    try {
      const summary = await generateSummary(state.selected.id);
      setState((current) => {
        const selected = current.selected;
        if (!selected || selected.id !== state.selected?.id) return current;
        return { ...current, selected: { ...selected, summary: summary.markdown } };
      });
    } catch (error) {
      setState((current) => ({ ...current, error: messageFor(error) }));
    } finally {
      setState((current) => ({ ...current, busy: false, operation: null }));
    }
  }, [state.selected]);

  const appendSegments = useCallback((meetingId: string, segments: readonly LocalSegment[]): void => {
    setState((current) => {
      if (current.selected?.id !== meetingId) return current;
      const byId = new Map(current.selected.segments.map((segment) => [segment.id, segment]));
      for (const segment of segments) byId.set(segment.id, segment);
      const ordered = [...byId.values()].sort((left, right) => left.sequence - right.sequence);
      return { ...current, selected: { ...current.selected, segments: ordered, segmentCount: ordered.length } };
    });
  }, []);

  return {
    ...state,
    initialize,
    refreshStatus,
    refreshMeetings,
    loadMeeting,
    create,
    importFile,
    rename,
    summarize,
    appendSegments,
    clearError: () => setState((current) => ({ ...current, error: null })),
  };
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createMeeting,
  generateSummary,
  getMeeting,
  getServiceStatus,
  getImportJob,
  listImportJobs,
  listMeetings,
  renameMeeting,
  retryImportJob,
  startImportJob,
} from './client';
import type { ImportJob, LocalMeeting, LocalSegment, MeetingDetail, ServiceStatus, SourceLanguage } from './contracts';

export type WorkspaceState = {
  readonly status: ServiceStatus | null;
  readonly meetings: readonly LocalMeeting[];
  readonly selected: MeetingDetail | null;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly operation: 'creating' | 'importing' | 'renaming' | 'summarizing' | null;
  readonly error: string | null;
  readonly importJob: ImportJob | null;
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
    importJob: null,
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
      const [status, meetings, importJobs] = await Promise.all([
        getServiceStatus(controller.signal),
        listMeetings(controller.signal),
        listImportJobs(),
      ]);
      if (generation !== requestGeneration.current) return;
      const importJob = importJobs.find((job) => job.state === 'queued' || job.state === 'processing' || job.state === 'failed') ?? null;
      const selectedId = importJob?.meetingId ?? meetings[0]?.id;
      const selected = selectedId ? await getMeeting(selectedId, controller.signal) : null;
      if (generation !== requestGeneration.current) return;
      setState({ status, meetings, selected, loading: false, busy: importJob?.state === 'queued' || importJob?.state === 'processing',
        operation: importJob?.state === 'queued' || importJob?.state === 'processing' ? 'importing' : null,
        error: importJob?.state === 'failed' ? importJob.error : null, importJob });
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

  useEffect(() => {
    const jobId = state.importJob?.id;
    if (!jobId || state.importJob?.state === 'completed' || state.importJob?.state === 'failed') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSeen = state.importJob;
    const poll = async (): Promise<void> => {
      try {
        const job = await getImportJob(jobId);
        if (stopped) return;
        const contentChanged = job.completedChunks !== lastSeen?.completedChunks
          || job.metrics.translatedSegments !== lastSeen?.metrics.translatedSegments
          || job.stage !== lastSeen?.stage || job.state !== lastSeen?.state;
        lastSeen = job;
        const [meeting, meetings] = contentChanged
          ? await Promise.all([getMeeting(job.meetingId), listMeetings()])
          : [null, null];
        if (stopped) return;
        const active = job.state === 'queued' || job.state === 'processing';
        setState((current) => ({ ...current, importJob: job, meetings: meetings ?? current.meetings,
          selected: meeting !== null && current.selected?.id === job.meetingId ? meeting : current.selected,
          busy: active, operation: active ? 'importing' : null,
          error: job.state === 'failed' ? job.error : current.error }));
        if (!active) return;
      } catch (error) {
        if (!stopped) setState((current) => ({ ...current, error: messageFor(error) }));
      }
      if (!stopped) timer = setTimeout(() => { void poll(); }, 800);
    };
    void poll();
    return () => { stopped = true; if (timer !== null) clearTimeout(timer); };
  }, [state.importJob?.id, state.importJob?.state]);

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
      const job = await startImportJob(file, title, language, interpret);
      const [meeting, meetings] = await Promise.all([getMeeting(job.meetingId), listMeetings()]);
      setState((current) => ({ ...current, selected: meeting, meetings, importJob: job }));
    } catch (error) {
      setState((current) => ({ ...current, error: messageFor(error), busy: false, operation: null }));
    }
  }, []);

  const retryImport = useCallback(async (): Promise<void> => {
    const id = state.importJob?.id;
    if (!id) return;
    try {
      const job = await retryImportJob(id);
      setState((current) => ({ ...current, importJob: job, busy: true, operation: 'importing', error: null }));
    } catch (error) {
      setState((current) => ({ ...current, error: messageFor(error) }));
    }
  }, [state.importJob?.id]);

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
    retryImport,
    rename,
    summarize,
    appendSegments,
    clearError: () => setState((current) => ({ ...current, error: null })),
  };
}

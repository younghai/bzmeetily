import { z } from 'zod';

import {
  chunkResultSchema,
  createMeetingSchema,
  importResultSchema,
  meetingDetailSchema,
  meetingSchema,
  serviceStatusSchema,
  summarySchema,
  translationRequestSchema,
  translationSchema,
} from './contracts';
import type { MeetingDetail, ServiceStatus, SourceLanguage } from './contracts';
import type { AudioChunk } from './audio';

const meetingsSchema = z.array(meetingSchema);
const errorResponseSchema = z.object({ error: z.string().min(1) });

function apiBase(): string {
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    return 'http://127.0.0.1:3118/api/local';
  }
  return '/api/local';
}

export class LocalApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'LocalApiError';
  }
}

async function responseError(response: Response): Promise<LocalApiError> {
  const contentType = response.headers.get('content-type') ?? '';
  let message = `로컬 서비스 오류 (${response.status})`;
  if (contentType.includes('application/json')) {
    const parsed = errorResponseSchema.safeParse(await response.json());
    if (parsed.success) message = parsed.data.error;
  } else {
    const body = z.string().parse(await response.text()).trim();
    if (body) message = body;
  }
  return new LocalApiError(response.status, response.status >= 500 || response.status === 429, message);
}

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      'X-Meetily-Client': 'local',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw await responseError(response);
  }
  return schema.parse(await response.json());
}

async function requestLiveJson<T>(path: string, schema: z.ZodType<T>, init: RequestInit): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const timeout = AbortSignal.timeout(12000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      return await requestJson(path, schema, { ...init, signal });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      const retryable = error instanceof LocalApiError ? error.retryable
        : error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');
      if (!retryable || attempt >= 1) throw error;
    }
  }
}

export function getServiceStatus(signal?: AbortSignal): Promise<ServiceStatus> {
  return requestJson('/status', serviceStatusSchema, { signal });
}

export function listMeetings(signal?: AbortSignal) {
  return requestJson('/meetings', meetingsSchema, { signal });
}

export function createMeeting(
  title: string,
  language: SourceLanguage,
  interpret: boolean,
) {
  const body = createMeetingSchema.parse({ title, language, interpret });
  return requestJson('/meetings', meetingSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getMeeting(id: string, signal?: AbortSignal): Promise<MeetingDetail> {
  return requestJson(`/meetings/${encodeURIComponent(id)}`, meetingDetailSchema, { signal });
}

export function renameMeeting(id: string, title: string) {
  const parsed = createMeetingSchema.shape.title.parse(title);
  return requestJson(`/meetings/${encodeURIComponent(id)}`, meetingSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: parsed }),
  });
}

export function uploadChunk(
  id: string,
  chunk: { readonly sequence: number; readonly start: number; readonly duration: number; readonly blob: Blob },
) {
  const query = new URLSearchParams({
    sequence: String(chunk.sequence),
    start: String(chunk.start),
    duration: String(chunk.duration),
  });
  return requestJson(`/meetings/${encodeURIComponent(id)}/chunks?${query}`, chunkResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: chunk.blob,
  });
}

export function transcribeLiveChunk(chunk: AudioChunk, signal?: AbortSignal) {
  const query = new URLSearchParams({
    sequence: String(chunk.sequence),
    start: String(chunk.start),
    duration: String(chunk.duration),
  });
  return requestLiveJson(`/transcribe?${query}`, chunkResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: chunk.blob,
    signal,
  });
}

export function importMeeting(
  file: File,
  title: string,
  language: SourceLanguage,
  interpret: boolean,
) {
  const parsed = createMeetingSchema.parse({ title, language, interpret });
  const body = new FormData();
  body.set('file', file);
  body.set('title', parsed.title);
  body.set('language', parsed.language);
  body.set('interpret', String(parsed.interpret));
  return requestJson('/import', importResultSchema, { method: 'POST', body });
}

export function generateSummary(id: string) {
  return requestJson(`/meetings/${encodeURIComponent(id)}/summary`, summarySchema, { method: 'POST' });
}

export async function saveMeetingAudio(id: string, recording: Blob): Promise<void> {
  const response = await fetch(`${apiBase()}/meetings/${encodeURIComponent(id)}/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav', 'X-Meetily-Client': 'local' },
    body: recording,
  });
  if (!response.ok) {
    throw await responseError(response);
  }
  if (response.status !== 204) {
    throw new LocalApiError(response.status, false, '녹음 저장 응답 형식이 올바르지 않습니다.');
  }
}

export async function getMeetingAudio(id: string): Promise<Blob> {
  const response = await fetch(`${apiBase()}/meetings/${encodeURIComponent(id)}/audio`, {
    headers: { 'X-Meetily-Client': 'local' },
  });
  if (!response.ok) {
    throw await responseError(response);
  }
  const blob = await response.blob();
  return z.instanceof(Blob).parse(blob);
}

export function requestTranslation(text: string, signal?: AbortSignal) {
  const body = translationRequestSchema.parse({ text, sourceLanguage: 'ja', targetLanguage: 'ko' });
  return requestLiveJson('/translate', translationSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

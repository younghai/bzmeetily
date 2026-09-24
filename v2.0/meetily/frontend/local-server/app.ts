import type { InferenceClient } from './inference';
import type { LocalStore } from './database';
import { extname, resolve, sep } from 'node:path';
import { ZodError, z } from 'zod';

import {
  chunkQuerySchema,
  chunkResultSchema,
  createMeetingSchema,
  importResultSchema,
  meetingIdSchema,
  summarySchema,
  translationRequestSchema,
  type LocalSegment,
} from '../src/local/contracts';
import { LocalServerError } from './errors';
import { convertImportToWav } from './import-audio';
import { authorizeRequest, readBoundedBody } from './security';

export type LocalAppOptions = {
  readonly port: number;
  readonly instanceId?: string | null;
  readonly getStore: () => LocalStore;
  readonly inference: InferenceClient;
  readonly staticDirectory: string;
  readonly maxChunkBytes?: number;
  readonly maxImportBytes?: number;
  readonly ffmpegPath?: string;
  readonly importTimeoutMs?: number;
};

export function createLocalApp(_options: LocalAppOptions): (request: Request) => Promise<Response> {
  const options = {
    maxChunkBytes: 12 * 1024 * 1024,
    maxImportBytes: 512 * 1024 * 1024,
    ffmpegPath: 'ffmpeg',
    importTimeoutMs: 10 * 60 * 1000,
    instanceId: null,
    ..._options,
  };
  const chunkTasks = new Map<string, Promise<{ readonly segments: readonly LocalSegment[] }>>();
  return async (request) => {
    const authorization = authorizeRequest(request, options.port);
    if ('reason' in authorization) return json({ error: `Forbidden ${authorization.reason}` }, 403);
    const corsHeaders = authorization.allowedOrigin === null ? undefined : { 'access-control-allow-origin': authorization.allowedOrigin, vary: 'Origin' };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...corsHeaders, 'access-control-allow-methods': 'GET,HEAD,POST,PATCH,OPTIONS', 'access-control-allow-headers': 'Content-Type,X-Meetily-Client' } });
    }
    try {
      const response = request.url.includes('/api/local')
        ? await routeApi(request, options, chunkTasks)
        : await serveStatic(request, options.staticDirectory);
      if (corsHeaders !== undefined) for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
      return response;
    } catch (error) { // no-excuse-ok: catch
      const response = error instanceof LocalServerError
        ? json({ error: error.message, code: error.code }, error.status)
        : error instanceof ZodError || error instanceof SyntaxError
          ? json({ error: 'Invalid request' }, 400)
          : json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500);
      if (corsHeaders !== undefined) for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
      return response;
    }
  };
}

type ResolvedOptions = Required<Omit<LocalAppOptions, 'maxChunkBytes' | 'maxImportBytes' | 'ffmpegPath' | 'importTimeoutMs' | 'instanceId'>> & {
  readonly maxChunkBytes: number;
  readonly maxImportBytes: number;
  readonly ffmpegPath: string;
  readonly importTimeoutMs: number;
  readonly instanceId: string | null;
  readonly getStore: () => LocalStore;
};

async function routeApi(
  request: Request,
  options: ResolvedOptions,
  chunkTasks: Map<string, Promise<{ readonly segments: readonly LocalSegment[] }>>,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/local/status' && request.method === 'GET') {
    const status = await options.inference.status();
    return json({ ...status, instanceId: options.instanceId ?? null });
  }
  const store = options.getStore();
  if (url.pathname === '/api/local/meetings' && request.method === 'GET') return json(store.listMeetings());
  if (url.pathname === '/api/local/meetings' && request.method === 'POST') {
    const body = await readJson(request, 32 * 1024);
    return json(store.createMeeting(createMeetingSchema.parse(body)), 201);
  }
  if (url.pathname === '/api/local/translate' && request.method === 'POST') {
    const input = translationRequestSchema.parse(await readJson(request, 32 * 1024));
    return json(await options.inference.translate(input.text, input.context, request.signal));
  }
  if (url.pathname === '/api/local/transcribe' && request.method === 'POST') {
    if (request.headers.get('content-type')?.split(';')[0] !== 'audio/wav') throw new LocalServerError('UNSUPPORTED_MEDIA', 415, 'Expected audio/wav');
    const query = chunkQuerySchema.parse(Object.fromEntries(url.searchParams));
    const bytes = await readBoundedBody(request, options.maxChunkBytes);
    const segments = await options.inference.transcribe(
      new Blob([bytes], { type: 'audio/wav' }),
      { ...query, language: 'ja', interpret: false, minimumLanguageProbability: 0.5, signal: request.signal },
    );
    return json(chunkResultSchema.parse({ segments }));
  }
  if (url.pathname === '/api/local/import' && request.method === 'POST') {
    const contentType = request.headers.get('content-type');
    if (contentType === null || !contentType.startsWith('multipart/form-data;')) throw new LocalServerError('UNSUPPORTED_MEDIA', 415, 'Expected multipart form data');
    const bytes = await readBoundedBody(request, options.maxImportBytes);
    const form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw new LocalServerError('INVALID_FILE', 400, 'An audio file is required');
    const input = createMeetingSchema.parse({
      title: form.get('title'),
      language: form.get('language'),
      interpret: form.get('interpret') === 'true',
    });
    const wav = await convertImportToWav(file, options.ffmpegPath, options.importTimeoutMs, request.signal);
    const segments = await options.inference.transcribe(wav, { sequence: 0, start: 0, duration: 86400, language: input.language, interpret: input.interpret });
    const meeting = store.createMeeting(input);
    store.persistChunk(meeting.id, 0, segments);
    await store.saveAudio(meeting.id, new Uint8Array(await wav.arrayBuffer()), 'audio/wav');
    const detail = store.getMeeting(meeting.id);
    if (detail === null) throw new LocalServerError('IMPORT_FAILED', 500, 'Imported meeting was not persisted');
    return json(importResultSchema.parse({ meeting: detail }), 201);
  }
  const match = url.pathname.match(/^\/api\/local\/meetings\/(meeting-[a-zA-Z0-9-]{8,80})(?:\/(chunks|summary|audio))?$/);
  if (match === null) throw new LocalServerError('NOT_FOUND', 404, 'Route not found');
  const meetingId = meetingIdSchema.parse(match[1]);
  const resource = match[2];
  if (resource === undefined && request.method === 'GET') {
    const meeting = store.getMeeting(meetingId);
    if (meeting === null) throw new LocalServerError('NOT_FOUND', 404, 'Meeting not found');
    return json(meeting);
  }
  if (resource === undefined && request.method === 'PATCH') {
    const input = z.object({ title: z.string().trim().min(1).max(180) }).parse(await readJson(request, 32 * 1024));
    return json(store.renameMeeting(meetingId, input.title));
  }
  if (resource === 'chunks' && request.method === 'POST') {
    if (request.headers.get('content-type')?.split(';')[0] !== 'audio/wav') throw new LocalServerError('UNSUPPORTED_MEDIA', 415, 'Expected audio/wav');
    const query = chunkQuerySchema.parse(Object.fromEntries(url.searchParams));
    const bytes = await readBoundedBody(request, options.maxChunkBytes);
    const receipt = store.getChunkReceipt(meetingId, query.sequence);
    if (receipt !== null) return json(receipt);
    const meeting = store.getMeeting(meetingId);
    if (meeting === null) throw new LocalServerError('NOT_FOUND', 404, 'Meeting not found');
    const key = `${meetingId}:${query.sequence}`;
    let task = chunkTasks.get(key);
    if (task === undefined) {
      task = options.inference.transcribe(
        new Blob([bytes], { type: 'audio/wav' }),
        { ...query, language: meeting.language, interpret: meeting.interpret },
      ).then((segments) => store.persistChunk(meetingId, query.sequence, segments));
      chunkTasks.set(key, task);
    }
    try { return json(await task); } finally {
      if (chunkTasks.get(key) === task) chunkTasks.delete(key);
    }
  }
  if (resource === 'summary' && request.method === 'POST') {
    const meeting = store.getMeeting(meetingId);
    if (meeting === null) throw new LocalServerError('NOT_FOUND', 404, 'Meeting not found');
    const transcript = meeting.segments.map((segment) => `${segment.sourceText}${segment.translation === null ? '' : `\n한국어: ${segment.translation}`}`).join('\n\n');
    if (transcript.trim().length === 0) throw new LocalServerError('EMPTY_TRANSCRIPT', 409, 'Transcript is empty');
    const result = summarySchema.parse({ markdown: await options.inference.summarize(transcript) });
    store.persistSummary(meetingId, result.markdown);
    return json(result);
  }
  if (resource === 'audio' && request.method === 'POST') {
    if (request.headers.get('content-type')?.split(';')[0] !== 'audio/wav') throw new LocalServerError('UNSUPPORTED_MEDIA', 415, 'Expected audio/wav');
    await store.saveAudio(meetingId, await readBoundedBody(request, options.maxImportBytes), 'audio/wav');
    return new Response(null, { status: 204 });
  }
  if (resource === 'audio' && request.method === 'GET') {
    const audio = store.getAudio(meetingId);
    if (audio === null || !(await audio.file.exists())) throw new LocalServerError('NOT_FOUND', 404, 'Audio not found');
    return new Response(audio.file, { headers: { 'content-type': audio.mimeType, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  }
  throw new LocalServerError('METHOD_NOT_ALLOWED', 405, 'Method not allowed');
}

async function readJson(request: Request, limit: number): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readBoundedBody(request, limit)));
}

async function serveStatic(request: Request, staticDirectory: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new LocalServerError('METHOD_NOT_ALLOWED', 405, 'Method not allowed');
  const url = new URL(request.url);
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch (error) {
    if (error instanceof URIError) throw new LocalServerError('INVALID_PATH', 400, 'Invalid path');
    throw error;
  }
  if (pathname.includes('\0') || pathname.split('/').some((part) => part.startsWith('.'))) throw new LocalServerError('NOT_FOUND', 404, 'File not found');
  const root = resolve(staticDirectory);
  const candidate = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!candidate.startsWith(`${root}${sep}`)) throw new LocalServerError('NOT_FOUND', 404, 'File not found');
  let file = Bun.file(candidate);
  if (!(await file.exists()) && extname(pathname) === '') file = Bun.file(resolve(root, 'index.html'));
  if (!(await file.exists())) throw new LocalServerError('NOT_FOUND', 404, 'File not found');
  return new Response(request.method === 'HEAD' ? null : file, { headers: { 'content-type': file.type || 'application/octet-stream', 'x-content-type-options': 'nosniff' } });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}

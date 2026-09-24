import { LocalServerError } from './errors';

export type AuthorizationResult = { readonly allowedOrigin: string | null } | { readonly reason: string };

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function authorizeRequest(request: Request, port: number): AuthorizationResult {
  const host = request.headers.get('host');
  const acceptedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (host === null || !acceptedHosts.has(host.toLowerCase())) return { reason: 'host' };

  const origin = request.headers.get('origin');
  const acceptedOrigins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'tauri://localhost',
    'http://tauri.localhost',
  ]);
  if (origin !== null && !acceptedOrigins.has(origin)) return { reason: 'origin' };
  if (!READ_METHODS.has(request.method) && request.headers.get('x-meetily-client') === null) {
    return { reason: 'client-header' };
  }
  return { allowedOrigin: origin };
}

export async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > limit) {
    throw new LocalServerError('PAYLOAD_TOO_LARGE', 413, `Request body exceeds ${limit} bytes`);
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  let received = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    received += result.value.byteLength;
    if (received > limit) {
      await reader.cancel();
      throw new LocalServerError('PAYLOAD_TOO_LARGE', 413, `Request body exceeds ${limit} bytes`);
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { LocalServerError } from './errors';

export async function convertImportToWav(file: File, ffmpegPath: string, timeoutMs: number, signal: AbortSignal): Promise<Blob> {
  const directory = await mkdtemp(join(tmpdir(), 'meetily-import-'));
  const input = join(directory, 'input');
  const output = join(directory, 'audio.wav');
  try {
    await Bun.write(input, file);
    const process = Bun.spawn([
      ffmpegPath, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output,
    ], { stdout: 'pipe', stderr: 'pipe' });
    const stop = () => process.kill();
    signal.addEventListener('abort', stop, { once: true });
    const timeout = setTimeout(stop, timeoutMs);
    const exitCode = await process.exited;
    clearTimeout(timeout);
    signal.removeEventListener('abort', stop);
    if (signal.aborted) throw new LocalServerError('IMPORT_ABORTED', 499, 'Import was cancelled');
    if (exitCode !== 0) {
      const errorText = await new Response(process.stderr).text();
      throw new LocalServerError('CONVERSION_FAILED', 422, errorText.trim() || 'Audio conversion failed');
    }
    const wav = Bun.file(output);
    if (!(await wav.exists())) throw new LocalServerError('CONVERSION_FAILED', 422, 'Audio conversion produced no output');
    return new Blob([await wav.arrayBuffer()], { type: 'audio/wav' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

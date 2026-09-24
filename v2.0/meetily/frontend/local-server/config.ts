import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

const defaultDatabasePath = join(homedir(), 'Library', 'Application Support', 'com.meetily.ai', 'meeting_minutes.sqlite');

const environmentSchema = z.object({
  MEETILY_LOCAL_PORT: z.coerce.number().int().min(1024).max(65535).default(3118),
  MEETILY_DB_PATH: z.string().min(1).default(defaultDatabasePath),
  MEETILY_SIDECAR_DB_PATH: z.string().min(1).optional(),
  MEETILY_AUDIO_DIR: z.string().min(1).optional(),
  MEETILY_STATIC_DIR: z.string().min(1).default(resolve(import.meta.dir, '..', 'out')),
  MEETILY_WHISPER_URL: z.string().url().default('http://127.0.0.1:8178'),
  MEETILY_WHISPER_MODEL: z.string().min(1).default('installed'),
  MEETILY_OLLAMA_URL: z.string().url().default('http://127.0.0.1:11434'),
  MEETILY_OLLAMA_MODEL: z.string().min(1).default('qwen3.5:4b'),
  MEETILY_FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  MEETILY_INFERENCE_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  MEETILY_IMPORT_TIMEOUT_MS: z.coerce.number().int().positive().default(600000),
  MEETILY_INFERENCE_QUEUE_LIMIT: z.coerce.number().int().min(1).max(32).default(8),
  MEETILY_MAX_CHUNK_BYTES: z.coerce.number().int().positive().max(12 * 1024 * 1024).default(12 * 1024 * 1024),
  MEETILY_MAX_IMPORT_BYTES: z.coerce.number().int().positive().max(512 * 1024 * 1024).default(512 * 1024 * 1024),
  // Identifies the data directory the owning app runs against, so a second
  // Meetily install can detect (and refuse to reuse) a server for other data.
  MEETILY_INSTANCE_ID: z.string().min(1).optional(),
  // Parse explicitly: z.coerce.boolean would treat MEETILY_BOOTSTRAP_DB="false" as enabled.
  MEETILY_BOOTSTRAP_DB: z.string().default('false').transform((value) => value === 'true' || value === '1'),
});

export function loadConfig(environment: NodeJS.ProcessEnv) {
  const value = environmentSchema.parse(environment);
  const applicationDirectory = dirname(value.MEETILY_DB_PATH);
  return {
    port: value.MEETILY_LOCAL_PORT,
    nativePath: value.MEETILY_DB_PATH,
    sidecarPath: value.MEETILY_SIDECAR_DB_PATH ?? join(applicationDirectory, 'meeting_minutes.local.sqlite'),
    audioDirectory: value.MEETILY_AUDIO_DIR ?? join(applicationDirectory, 'local-audio'),
    staticDirectory: value.MEETILY_STATIC_DIR,
    whisperUrl: value.MEETILY_WHISPER_URL.replace(/\/$/, ''),
    whisperModel: value.MEETILY_WHISPER_MODEL,
    ollamaUrl: value.MEETILY_OLLAMA_URL.replace(/\/$/, ''),
    ollamaModel: value.MEETILY_OLLAMA_MODEL,
    ffmpegPath: value.MEETILY_FFMPEG_PATH,
    inferenceTimeoutMs: value.MEETILY_INFERENCE_TIMEOUT_MS,
    importTimeoutMs: value.MEETILY_IMPORT_TIMEOUT_MS,
    inferenceQueueLimit: value.MEETILY_INFERENCE_QUEUE_LIMIT,
    instanceId: value.MEETILY_INSTANCE_ID ?? null,
    bootstrapIfMissing: value.MEETILY_BOOTSTRAP_DB,
    maxChunkBytes: value.MEETILY_MAX_CHUNK_BYTES,
    maxImportBytes: value.MEETILY_MAX_IMPORT_BYTES,
  };
}

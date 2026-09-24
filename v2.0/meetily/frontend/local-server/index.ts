import { createLocalApp } from './app';
import { loadConfig } from './config';
import { LocalStore } from './database';
import { LocalServerError } from './errors';
import { LocalInference } from './inference';

const config = loadConfig(process.env);

// In app mode the shared database schema is owned by the Tauri migration and
// may not exist yet on first launch, so store creation retries until the app
// has set it up. Standalone mode (MEETILY_BOOTSTRAP_DB=1) owns the schema and
// fails fast instead.
let store: LocalStore | null = null;
let storeTimer: ReturnType<typeof setInterval> | null = null;
const initStore = (): void => {
  if (store !== null) return;
  try {
    const candidate = new LocalStore({
      nativePath: config.nativePath,
      sidecarPath: config.sidecarPath,
      audioDirectory: config.audioDirectory,
      bootstrapIfMissing: config.bootstrapIfMissing,
    });
    candidate.initialize();
    store = candidate;
    if (storeTimer !== null) {
      globalThis.clearInterval(storeTimer);
      storeTimer = null;
    }
    console.log('Meetily local database ready');
  } catch (error) {
    if (config.bootstrapIfMissing === true) throw error;
    console.log(`Meetily local database not ready yet: ${error instanceof Error ? error.message : String(error)}`);
  }
};
initStore();
if (store === null) storeTimer = globalThis.setInterval(initStore, 1_000);
const getStore = (): LocalStore => {
  if (store === null) throw new LocalServerError('DB_NOT_READY', 503, 'meeting database is initializing; try again shortly');
  return store;
};

const inference = new LocalInference({
  whisperUrl: config.whisperUrl,
  whisperModel: config.whisperModel,
  ollamaUrl: config.ollamaUrl,
  ollamaModel: config.ollamaModel,
  timeoutMs: config.inferenceTimeoutMs,
  queueLimit: config.inferenceQueueLimit,
});
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: config.port,
  idleTimeout: 0,
  maxRequestBodySize: config.maxImportBytes + 1024 * 1024,
  fetch: createLocalApp({
    port: config.port,
    instanceId: config.instanceId,
    getStore,
    inference,
    staticDirectory: config.staticDirectory,
    maxChunkBytes: config.maxChunkBytes,
    maxImportBytes: config.maxImportBytes,
    ffmpegPath: config.ffmpegPath,
    importTimeoutMs: config.importTimeoutMs,
  }),
});

const stop = (): void => {
  server.stop(true);
  store?.close();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
console.log(`Meetily local server listening at http://${server.hostname}:${server.port}`);

import { afterEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { LocalStore } from '../../local-server/database';
import type { LocalSegment } from '../../src/local/contracts';

const temporaryRoots: string[] = [];
const realDatabasePath = process.env.MEETILY_TEST_DB_PATH;
const realDatabaseIt = realDatabasePath === undefined ? it.skip : it;

async function fixture(): Promise<{ readonly root: string; readonly store: LocalStore; readonly native: Database }> {
  const root = await mkdtemp(join(tmpdir(), 'meetily-local-server-'));
  temporaryRoots.push(root);
  const nativePath = join(root, 'meeting_minutes.sqlite');
  const native = new Database(nativePath, { create: true });
  native.run('CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, folder_path TEXT)');
  native.run('CREATE TABLE transcripts (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, transcript TEXT NOT NULL, timestamp TEXT NOT NULL, summary TEXT, action_items TEXT, key_points TEXT, audio_start_time REAL, audio_end_time REAL, duration REAL, speaker TEXT)');
  native.run('CREATE TABLE summary_processes (meeting_id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT, result TEXT, start_time TEXT, end_time TEXT, chunk_count INTEGER DEFAULT 0, processing_time REAL DEFAULT 0.0, metadata TEXT, result_backup TEXT, result_backup_timestamp TEXT)');
  native.run('CREATE TABLE transcript_chunks (meeting_id TEXT PRIMARY KEY, meeting_name TEXT, transcript_text TEXT NOT NULL, model TEXT NOT NULL, model_name TEXT NOT NULL, chunk_size INTEGER, overlap INTEGER, created_at TEXT NOT NULL)');
  native.run('CREATE TABLE native_sentinel (value TEXT NOT NULL)');
  native.run("INSERT INTO native_sentinel VALUES ('keep-me')");
  const store = new LocalStore({ nativePath, sidecarPath: join(root, 'local.sqlite'), audioDirectory: join(root, 'audio') });
  store.initialize();
  return { root, store, native };
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('LocalStore preservation', () => {
  it('keeps native data and parameterizes hostile titles', async () => {
    // Given
    const { store, native } = await fixture();
    const hostileTitle = "'); DROP TABLE native_sentinel; --";

    // When
    const meeting = store.createMeeting({ title: hostileTitle, language: 'ja', interpret: true });

    // Then
    expect(meeting.title).toBe(hostileTitle);
    expect(native.query<{ readonly value: string }, []>('SELECT value FROM native_sentinel').get()?.value).toBe('keep-me');
    store.close();
    native.close();
  });

  realDatabaseIt('preserves every existing meeting and transcript in a copied native database', async () => {
    // Given
    if (realDatabasePath === undefined) throw new Error('MEETILY_TEST_DB_PATH is required');
    const root = await mkdtemp(join(tmpdir(), 'meetily-real-db-'));
    temporaryRoots.push(root);
    const copiedPath = join(root, 'meeting_minutes.sqlite');
    await copyFile(realDatabasePath, copiedPath);
    const before = new Database(copiedPath);
    const meetingCount = before.query<{ readonly count: number }, []>('SELECT COUNT(*) AS count FROM meetings').get()?.count;
    const transcriptCount = before.query<{ readonly count: number }, []>('SELECT COUNT(*) AS count FROM transcripts').get()?.count;
    before.close();

    // When
    const store = new LocalStore({ nativePath: copiedPath, sidecarPath: join(root, 'local.sqlite'), audioDirectory: join(root, 'audio') });
    store.initialize();
    store.createMeeting({ title: "Preservation ' check", language: 'ja', interpret: true });
    store.close();

    // Then
    const after = new Database(copiedPath);
    expect(after.query<{ readonly count: number }, []>('SELECT COUNT(*) AS count FROM meetings').get()?.count).toBe((meetingCount ?? 0) + 1);
    expect(after.query<{ readonly count: number }, []>('SELECT COUNT(*) AS count FROM transcripts').get()?.count).toBe(transcriptCount);
    after.close();
  });

  it('returns the first persisted result when a chunk sequence is retried', async () => {
    // Given
    const { store, native } = await fixture();
    const meeting = store.createMeeting({ title: '通訳テスト', language: 'ja', interpret: true });
    const original: LocalSegment = { id: 'segment-first', sequence: 4, start: 1, end: 2, sourceText: '最初', translation: '처음', translationError: null };
    const changed: LocalSegment = { ...original, id: 'segment-changed', sourceText: '変更' };

    // When
    const first = store.persistChunk(meeting.id, 4, [original]);
    const retried = store.persistChunk(meeting.id, 4, [changed]);

    // Then
    expect(retried).toEqual(first);
    expect(store.getMeeting(meeting.id)?.segments).toHaveLength(1);
    store.close();
    native.close();
  });

  it('persists a summary in the native-visible joined tables', async () => {
    // Given
    const { store, native } = await fixture();
    const meeting = store.createMeeting({ title: '要約', language: 'ja', interpret: true });
    store.persistChunk(meeting.id, 0, [{ id: 'segment-summary', sequence: 0, start: 0, end: 1, sourceText: '議題', translation: '안건', translationError: null }]);

    // When
    store.persistSummary(meeting.id, '# 회의 요약');

    // Then
    const summary = native.query<{ readonly status: string; readonly result: string }, [string]>(
      'SELECT p.status, p.result FROM summary_processes p JOIN transcript_chunks t ON p.meeting_id = t.meeting_id WHERE p.meeting_id = ?',
    ).get(meeting.id);
    expect(summary?.status).toBe('completed');
    expect(JSON.parse(summary?.result ?? '{}')).toEqual({ markdown: '# 회의 요약' });
    store.close();
    native.close();
  });
});

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  chunkResultSchema,
  languageSchema,
  meetingDetailSchema,
  meetingSchema,
  type LocalMeeting,
  type LocalSegment,
  type MeetingDetail,
  type SourceLanguage,
} from '../src/local/contracts';
import { LocalServerError } from './errors';

type StoreOptions = {
  readonly nativePath: string;
  readonly sidecarPath: string;
  readonly audioDirectory: string;
  /**
   * Create the native schema when the database file does not exist yet. Only
   * for standalone (web-only) usage of this server: the Tauri app owns the
   * shared database schema and must always run its migrations first, so the
   * app runtime never sets this flag.
   */
  readonly bootstrapIfMissing?: boolean;
};

type CreateMeetingInput = {
  readonly title: string;
  readonly language: SourceLanguage;
  readonly interpret: boolean;
};

export class LocalStore {
  readonly #options: StoreOptions;
  readonly #database: Database;
  readonly #audioDirectory: string;

  constructor(options: StoreOptions) {
    this.#options = options;
    this.#database = new Database(options.nativePath, { create: options.bootstrapIfMissing === true, strict: true });
    this.#audioDirectory = options.audioDirectory;
    this.#database.run('ATTACH DATABASE ? AS local_meta', [options.sidecarPath]);
  }

  initialize(): void {
    // Schema ownership: the Tauri app's migration creates the native tables.
    // In explicit standalone mode (MEETILY_BOOTSTRAP_DB=1, web-only usage) this
    // server may create them; otherwise a missing table just means the shared
    // database is not ready yet (first launch migrates inside the app) and the
    // caller retries initialize() until it succeeds.
    if (this.#options.bootstrapIfMissing === true) {
      this.#createNativeSchema();
    } else {
      const missing = (['meetings', 'transcripts', 'summary_processes', 'transcript_chunks'] as const)
        .filter((table) => this.#tableMissing(table));
      if (missing.length > 0) throw new LocalServerError('DB_NOT_READY', 503, `Native tables not ready: ${missing.join(', ')}`);
    }
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS local_meta.meeting_settings (
        meeting_id TEXT PRIMARY KEY, language TEXT NOT NULL, interpret INTEGER NOT NULL,
        CHECK (language IN ('ja', 'ko', 'en', 'auto')), CHECK (interpret IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS local_meta.segment_metadata (
        transcript_id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, sequence INTEGER NOT NULL,
        translation TEXT, translation_error TEXT, UNIQUE (meeting_id, sequence, transcript_id)
      );
      CREATE TABLE IF NOT EXISTS local_meta.chunk_receipts (
        meeting_id TEXT NOT NULL, sequence INTEGER NOT NULL, result_json TEXT NOT NULL,
        PRIMARY KEY (meeting_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS local_meta.audio_files (
        meeting_id TEXT PRIMARY KEY, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, sha256 TEXT
      )
    `);
    const audioColumns = this.#database.query<{ readonly name: string }, []>('PRAGMA local_meta.table_info(audio_files)').all();
    if (!audioColumns.some((column) => column.name === 'sha256')) {
      this.#database.exec('ALTER TABLE local_meta.audio_files ADD COLUMN sha256 TEXT');
    }
    mkdirSync(this.#audioDirectory, { recursive: true, mode: 0o700 });
  }

  #createNativeSchema(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, folder_path TEXT
      );
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, transcript TEXT NOT NULL,
        timestamp TEXT NOT NULL, summary TEXT, action_items TEXT, key_points TEXT,
        audio_start_time REAL, audio_end_time REAL, duration REAL, speaker TEXT,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS summary_processes (
        meeting_id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, error TEXT, result TEXT, start_time TEXT, end_time TEXT,
        chunk_count INTEGER DEFAULT 0, processing_time REAL DEFAULT 0.0, metadata TEXT,
        result_backup TEXT, result_backup_timestamp TEXT,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS transcript_chunks (
        meeting_id TEXT PRIMARY KEY, meeting_name TEXT, transcript_text TEXT NOT NULL,
        model TEXT NOT NULL, model_name TEXT NOT NULL, chunk_size INTEGER, overlap INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );
    `);
  }

  #tableMissing(table: string): boolean {
    return this.#database.query<{ readonly name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) === null;
  }

  listMeetings(): readonly LocalMeeting[] {
    const rows = this.#database.query<{
      readonly id: string; readonly title: string; readonly createdAt: string; readonly updatedAt: string;
      readonly language: string | null; readonly interpret: number | null; readonly segmentCount: number;
    }, []>(`SELECT m.id, m.title, m.created_at AS createdAt, m.updated_at AS updatedAt,
      s.language, s.interpret, (SELECT COUNT(*) FROM transcripts t WHERE t.meeting_id = m.id) AS segmentCount
      FROM meetings m LEFT JOIN local_meta.meeting_settings s ON s.meeting_id = m.id
      ORDER BY m.created_at DESC`).all();
    return rows.map((row) => meetingSchema.parse({
      ...row,
      language: row.language === null ? 'auto' : languageSchema.parse(row.language),
      interpret: row.interpret === 1,
    }));
  }

  createMeeting(input: CreateMeetingInput): LocalMeeting {
    const id = `meeting-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      this.#database.run(
        'INSERT INTO meetings (id, title, created_at, updated_at, folder_path) VALUES (?, ?, ?, ?, NULL)',
        [id, input.title, now, now],
      );
      this.#database.run(
        'INSERT INTO local_meta.meeting_settings (meeting_id, language, interpret) VALUES (?, ?, ?)',
        [id, input.language, input.interpret ? 1 : 0],
      );
    })();
    return meetingSchema.parse({
      id,
      title: input.title,
      createdAt: now,
      updatedAt: now,
      language: input.language,
      interpret: input.interpret,
      segmentCount: 0,
    });
  }

  renameMeeting(meetingId: string, title: string): LocalMeeting {
    const now = new Date().toISOString();
    const result = this.#database.run('UPDATE meetings SET title = ?, updated_at = ? WHERE id = ?', [title, now, meetingId]);
    if (result.changes === 0) throw new LocalServerError('NOT_FOUND', 404, 'Meeting not found');
    const meeting = this.getMeeting(meetingId);
    if (meeting === null) throw new LocalServerError('NOT_FOUND', 404, 'Meeting not found');
    return meetingSchema.parse(meeting);
  }

  getMeeting(meetingId: string): MeetingDetail | null {
    const meeting = this.#database.query<{
      readonly id: string; readonly title: string; readonly createdAt: string; readonly updatedAt: string;
      readonly language: string | null; readonly interpret: number | null;
    }, [string]>(`SELECT m.id, m.title, m.created_at AS createdAt, m.updated_at AS updatedAt,
      s.language, s.interpret FROM meetings m
      LEFT JOIN local_meta.meeting_settings s ON s.meeting_id = m.id WHERE m.id = ?`).get(meetingId);
    if (meeting === null) return null;
    const rows = this.#database.query<{
      readonly id: string; readonly sourceText: string; readonly timestamp: string;
      readonly start: number | null; readonly end: number | null; readonly duration: number | null;
      readonly sequence: number | null; readonly translation: string | null; readonly translationError: string | null;
    }, [string]>(`SELECT t.id, t.transcript AS sourceText, t.timestamp,
      t.audio_start_time AS start, t.audio_end_time AS end, t.duration,
      x.sequence, x.translation, x.translation_error AS translationError
      FROM transcripts t LEFT JOIN local_meta.segment_metadata x ON x.transcript_id = t.id
      WHERE t.meeting_id = ? ORDER BY COALESCE(t.audio_start_time, 0), t.timestamp, t.id`).all(meetingId);
    const segments = rows.map((row, index) => ({
      id: row.id,
      sequence: row.sequence ?? index,
      start: row.start ?? 0,
      end: row.end ?? ((row.start ?? 0) + (row.duration ?? 0)),
      sourceText: row.sourceText,
      translation: row.translation,
      translationError: row.translationError,
    }));
    const summaryRow = this.#database.query<{ readonly result: string | null }, [string]>(
      "SELECT result FROM summary_processes WHERE meeting_id = ? AND LOWER(status) = 'completed'",
    ).get(meetingId);
    const summary = summaryRow?.result === null || summaryRow === null ? null : parseSummary(summaryRow.result);
    const audio = this.#database.query<{ readonly fileName: string }, [string]>(
      'SELECT file_name AS fileName FROM local_meta.audio_files WHERE meeting_id = ?',
    ).get(meetingId);
    return meetingDetailSchema.parse({
      ...meeting,
      language: meeting.language === null ? 'auto' : languageSchema.parse(meeting.language),
      interpret: meeting.interpret === 1,
      segmentCount: segments.length,
      segments,
      summary,
      audioAvailable: audio !== null && safeAudioName(audio.fileName) && existsSync(join(this.#audioDirectory, audio.fileName)),
    });
  }

  persistChunk(meetingId: string, sequence: number, segments: readonly LocalSegment[]): { readonly segments: readonly LocalSegment[] } {
    const existing = this.getChunkReceipt(meetingId, sequence);
    if (existing !== null) return existing;
    const meeting = this.getMeeting(meetingId);
    if (meeting === null) throw new LocalServerError('NOT_FOUND', 404, 'Meeting not found');
    const result = chunkResultSchema.parse({ segments });
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      for (const segment of result.segments) {
        this.#database.run(`INSERT INTO transcripts
          (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration, speaker)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
          segment.id, meetingId, segment.sourceText, now, segment.start, segment.end,
          segment.end - segment.start, 'system',
        ]);
        this.#database.run(`INSERT INTO local_meta.segment_metadata
          (transcript_id, meeting_id, sequence, translation, translation_error) VALUES (?, ?, ?, ?, ?)`, [
          segment.id, meetingId, segment.sequence, segment.translation, segment.translationError,
        ]);
      }
      this.#database.run(
        'INSERT INTO local_meta.chunk_receipts (meeting_id, sequence, result_json) VALUES (?, ?, ?)',
        [meetingId, sequence, JSON.stringify(result)],
      );
      this.#database.run('UPDATE meetings SET updated_at = ? WHERE id = ?', [now, meetingId]);
    })();
    return result;
  }

  getChunkReceipt(meetingId: string, sequence: number): { readonly segments: readonly LocalSegment[] } | null {
    const existing = this.#database.query<{ readonly resultJson: string }, [string, number]>(
      'SELECT result_json AS resultJson FROM local_meta.chunk_receipts WHERE meeting_id = ? AND sequence = ?',
    ).get(meetingId, sequence);
    if (existing !== null) return chunkResultSchema.parse(JSON.parse(existing.resultJson));
    return null;
  }

  persistSummary(meetingId: string, markdown: string): void {
    const meeting = this.getMeeting(meetingId);
    if (meeting === null) throw new LocalServerError('NOT_FOUND', 404, 'Meeting not found');
    const transcriptText = meeting.segments.map((segment) => segment.sourceText).join('\n');
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      this.#database.run(`INSERT INTO transcript_chunks
        (meeting_id, meeting_name, transcript_text, model, model_name, chunk_size, overlap, created_at)
        VALUES (?, ?, ?, 'ollama', 'qwen3.5:4b', 40000, 1000, ?)
        ON CONFLICT(meeting_id) DO UPDATE SET meeting_name = excluded.meeting_name,
        transcript_text = excluded.transcript_text, model = excluded.model, model_name = excluded.model_name,
        chunk_size = excluded.chunk_size, overlap = excluded.overlap, created_at = excluded.created_at`,
      [meetingId, meeting.title, transcriptText, now]);
      this.#database.run(`INSERT INTO summary_processes
        (meeting_id, status, created_at, updated_at, result, start_time, end_time, chunk_count, processing_time)
        VALUES (?, 'completed', ?, ?, ?, ?, ?, 1, 0)
        ON CONFLICT(meeting_id) DO UPDATE SET status = 'completed', updated_at = excluded.updated_at,
        result = excluded.result, start_time = excluded.start_time, end_time = excluded.end_time,
        chunk_count = excluded.chunk_count, processing_time = excluded.processing_time, error = NULL,
        result_backup = NULL, result_backup_timestamp = NULL`,
      [meetingId, now, now, JSON.stringify({ markdown }), now, now]);
      this.#database.run('UPDATE meetings SET updated_at = ? WHERE id = ?', [now, meetingId]);
    })();
  }

  async saveAudio(meetingId: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    if (this.getMeeting(meetingId) === null) throw new LocalServerError('NOT_FOUND', 404, 'Meeting not found');
    const sha256 = hashAudio(bytes);
    const existing = this.#database.query<{ readonly fileName: string; readonly sha256: string | null }, [string]>(
      'SELECT file_name AS fileName, sha256 FROM local_meta.audio_files WHERE meeting_id = ?',
    ).get(meetingId);
    if (existing !== null) {
      const path = safeAudioName(existing.fileName) ? join(this.#audioDirectory, existing.fileName) : null;
      const storedHash = existing.sha256 ?? (path !== null && existsSync(path) ? hashAudio(new Uint8Array(await Bun.file(path).arrayBuffer())) : null);
      if (storedHash === sha256) return;
      throw new LocalServerError('AUDIO_EXISTS', 409, 'This meeting already has a recording');
    }
    const fileName = `${crypto.randomUUID()}.wav`;
    await Bun.write(join(this.#audioDirectory, fileName), bytes);
    this.#database.run('INSERT INTO local_meta.audio_files (meeting_id, file_name, mime_type, sha256) VALUES (?, ?, ?, ?)',
      [meetingId, fileName, mimeType, sha256]);
  }

  getAudio(meetingId: string): { readonly file: ReturnType<typeof Bun.file>; readonly mimeType: string } | null {
    const row = this.#database.query<{ readonly fileName: string; readonly mimeType: string }, [string]>(
      'SELECT file_name AS fileName, mime_type AS mimeType FROM local_meta.audio_files WHERE meeting_id = ?',
    ).get(meetingId);
    if (row === null || !safeAudioName(row.fileName)) return null;
    return { file: Bun.file(join(this.#audioDirectory, row.fileName)), mimeType: row.mimeType };
  }

  close(): void { this.#database.close(); }
}

function parseSummary(value: string): string | null {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || !('markdown' in parsed)) return null;
  return typeof parsed.markdown === 'string' ? parsed.markdown : null;
}

function safeAudioName(value: string): boolean {
  return /^[0-9a-f-]{36}\.wav$/.test(value);
}

function hashAudio(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

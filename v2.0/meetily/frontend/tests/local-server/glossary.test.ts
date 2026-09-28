import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  appendGlossaryAndPolish,
  applyReplacementRules,
  buildWhisperGlossaryPrompt,
} from '../../local-server/inference';
import { LocalStore } from '../../local-server/database';
import type { GlossaryTerm } from '../../src/local/contracts';

function term(partial: Partial<GlossaryTerm> & Pick<GlossaryTerm, 'sourceValue' | 'destinationValue'>): GlossaryTerm {
  return {
    id: `glossary-test-${Math.random().toString(36).slice(2, 10)}`,
    kind: 'term',
    enabled: true,
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
    ...partial,
  };
}

describe('glossary prompt builders', () => {
  test('whisper prompt lists enabled entries and skips disabled ones', () => {
    const prompt = buildWhisperGlossaryPrompt([
      term({ sourceValue: 'ミティリー', destinationValue: 'Meetily' }),
      term({ sourceValue: 'ゾックリヤ', destinationValue: 'Zackriya', enabled: false }),
      term({ sourceValue: 'KDDI', destinationValue: 'KDDI' }),
    ]);
    expect(prompt).toContain('ミティリー（Meetily）');
    expect(prompt).toContain('KDDI');
    expect(prompt).not.toContain('ゾックリヤ');
    expect(prompt).not.toContain('（Zackriya）');
  });

  test('whisper prompt is empty without enabled terms', () => {
    expect(buildWhisperGlossaryPrompt([])).toBe('');
    expect(buildWhisperGlossaryPrompt([term({ sourceValue: 'a', destinationValue: 'b', enabled: false })])).toBe('');
  });

  test('whisper prompt respects the length budget', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      term({ sourceValue: `長い固有名詞その${index}`, destinationValue: `LongProperNoun${index}` }));
    expect(buildWhisperGlossaryPrompt(many).length).toBeLessThanOrEqual(700);
  });

  test('translation prompt includes glossary spelling and polish rules', () => {
    const basePrompt = '기본 시스템 프롬프트 同時通訳 규칙';
    const base = appendGlossaryAndPolish(basePrompt, [], false);
    expect(base).toContain('기본 시스템 프롬프트');
    expect(base).not.toContain('필러');

    const polished = appendGlossaryAndPolish(basePrompt, [], true);
    expect(polished).toContain('필러');
    expect(polished).toContain('요약하거나 생략하지 마세요');

    const withGlossary = appendGlossaryAndPolish(
      basePrompt,
      [term({ sourceValue: 'ミティリー', destinationValue: 'Meetily' })],
      true,
    );
    expect(withGlossary).toContain('ミティリー → Meetily');
  });
});

describe('glossary replacement rules', () => {
  test('replaces all occurrences of enabled replacement rules only', () => {
    const result = applyReplacementRules('ミティリーを使ってミティリーを確認', [
      term({ sourceValue: 'ミティリー', destinationValue: 'Meetily', kind: 'replacement' }),
      term({ sourceValue: '確認', destinationValue: 'IGNORED', kind: 'term' }),
      term({ sourceValue: '無効', destinationValue: 'X', kind: 'replacement', enabled: false }),
    ]);
    expect(result).toBe('Meetilyを使ってMeetilyを確認');
  });

  test('longest source wins to avoid partial-overlap corruption', () => {
    const result = applyReplacementRules('ミティリーテスト', [
      term({ sourceValue: 'ミティリー', destinationValue: 'Meetily', kind: 'replacement' }),
      term({ sourceValue: 'ミティ', destinationValue: 'MT', kind: 'replacement' }),
    ]);
    expect(result).toBe('Meetilyテスト');
  });

  test('identical source and destination is a no-op', () => {
    expect(applyReplacementRules('그대로', [term({ sourceValue: '그대로', destinationValue: '그대로', kind: 'replacement' })])).toBe('그대로');
  });
});

describe('glossary store CRUD', () => {
  test('create, list, update, delete roundtrip', () => {
    const root = mkdtempSync(join(tmpdir(), 'meetily-glossary-'));
    const native = new Database(join(root, 'native.sqlite'), { create: true });
    native.exec(`
      CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, folder_path TEXT);
      CREATE TABLE transcripts (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, transcript TEXT NOT NULL, timestamp TEXT NOT NULL);
      CREATE TABLE summary_processes (meeting_id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE transcript_chunks (meeting_id TEXT PRIMARY KEY, transcript_text TEXT NOT NULL, model TEXT NOT NULL, model_name TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    native.close();
    const store = new LocalStore({
      nativePath: join(root, 'native.sqlite'),
      sidecarPath: join(root, 'sidecar.sqlite'),
      audioDirectory: join(root, 'audio'),
      bootstrapIfMissing: false,
    });
    store.initialize();

    const created = store.createGlossaryTerm({ sourceValue: 'ミティリー', destinationValue: 'Meetily', kind: 'replacement' });
    expect(store.listGlossary()).toHaveLength(1);

    const disabled = store.updateGlossaryTerm(created.id, { enabled: false, destinationValue: 'Meetily2' });
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.destinationValue).toBe('Meetily2');

    expect(store.updateGlossaryTerm('glossary-does-not-exact', { enabled: true })).toBeNull();
    expect(store.deleteGlossaryTerm(created.id)).toBe(true);
    expect(store.deleteGlossaryTerm(created.id)).toBe(false);
    expect(store.listGlossary()).toHaveLength(0);
    store.close();
  });
});

describe('glossary HTTP routes', () => {
  test('GET /api/local/glossary is routable at the top level', async () => {
    // Regression: the glossary routes were once nested inside the translate
    // if-block, which typechecked fine but made GET unreachable (404).
    const { createLocalApp } = await import('../../local-server/app');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const root = mkdtempSync(join(tmpdir(), 'meetily-glossary-route-'));
    const native = new Database(join(root, 'native.sqlite'), { create: true });
    native.exec(`
      CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, folder_path TEXT);
      CREATE TABLE transcripts (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, transcript TEXT NOT NULL, timestamp TEXT NOT NULL);
      CREATE TABLE summary_processes (meeting_id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE transcript_chunks (meeting_id TEXT PRIMARY KEY, transcript_text TEXT NOT NULL, model TEXT NOT NULL, model_name TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    native.close();
    const store = new LocalStore({
      nativePath: join(root, 'native.sqlite'),
      sidecarPath: join(root, 'sidecar.sqlite'),
      audioDirectory: join(root, 'audio'),
    });
    store.initialize();
    const created = store.createGlossaryTerm({ sourceValue: 'ミティリー', destinationValue: 'Meetily', kind: 'term' });
    const inference = {
      status: async () => ({ ready: true, whisper: { ready: true, model: 'm', error: null }, ollama: { ready: true, model: 'm', error: null } }),
      transcribe: async () => [],
      translate: async () => ({ text: '번역', elapsedMs: 1 }),
      summarize: async () => '# 요약',
    };
    const app = createLocalApp({
      port: 3118,
      getStore: () => store,
      inference,
      staticDirectory: root,
    });
    const response = await app(new Request('http://127.0.0.1:3118/api/local/glossary', {
      headers: { host: '127.0.0.1:3118', origin: 'http://127.0.0.1:3118', 'x-meetily-client': 'test' },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(created.id);
    store.close();
  });
});

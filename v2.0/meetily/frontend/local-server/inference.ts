import { z } from 'zod';

import {
  serviceStatusSchema,
  translationSchema,
  type GlossaryTerm,
  type LocalSegment,
  type TranslationContextTurn,
} from '../src/local/contracts';
import { LocalServerError } from './errors';

// ---------------------------------------------------------------------------
// Glossary helpers (exported for tests)
// ---------------------------------------------------------------------------

const WHISPER_PROMPT_BUDGET = 700;

/** Prompt injected into whisper's `prompt` field so recurring proper nouns
 * are transcribed with the right spelling instead of being re-guessed. */
export function buildWhisperGlossaryPrompt(terms: readonly GlossaryTerm[]): string {
  const entries = terms
    .filter((term) => term.enabled)
    .map((term) => (term.sourceValue === term.destinationValue
      ? term.destinationValue
      : `${term.sourceValue}（${term.destinationValue}）`));
  if (entries.length === 0) return '';
  let prompt = `固有名詞・専門用語の正しい表記に注意して書き起こしてください。用語集: ${entries.join('、')}`;
  if (prompt.length > WHISPER_PROMPT_BUDGET) {
    prompt = `${prompt.slice(0, WHISPER_PROMPT_BUDGET - 1)}…`;
  }
  return prompt;
}

/** Longest-first literal replacement so overlapping rules cannot corrupt
 * each other (e.g. 「ミティリー」 before 「ミティ」). */
export function applyReplacementRules(text: string, terms: readonly GlossaryTerm[]): string {
  const rules = terms
    .filter((term) => term.enabled && term.kind === 'replacement' && term.sourceValue !== term.destinationValue)
    .sort((a, b) => b.sourceValue.length - a.sourceValue.length);
  let result = text;
  for (const rule of rules) result = result.split(rule.sourceValue).join(rule.destinationValue);
  return result;
}

/** Appends glossary spelling and the optional filler/repeat cleanup rule to a
 * translation system prompt (single LLM call — no extra latency). */
export function appendGlossaryAndPolish(baseSystem: string, terms: readonly GlossaryTerm[], polish: boolean): string {
  const parts = [baseSystem];
  if (polish) {
    parts.push('출력은 통역 문장만 담습니다. 필러(えー、あのー、そのー 등), 무의미한 반복, 말하다 만 어구는 제거하고 내용은 요약하거나 생략하지 마세요.');
  }
  const glossary = terms
    .filter((term) => term.enabled)
    .map((term) => `${term.sourceValue} → ${term.destinationValue}`);
  if (glossary.length > 0) {
    parts.push(`고유명사·용어 표기(이 표기를 따르세요): ${glossary.join(' / ')}`);
  }
  return parts.join(' ');
}

export interface InferenceClient {
  status(): Promise<{
    readonly ready: boolean;
    readonly whisper: { readonly ready: boolean; readonly model: string; readonly error: string | null };
    readonly ollama: { readonly ready: boolean; readonly model: string; readonly error: string | null };
  }>;
  transcribe(audio: Blob, context: TranscriptionContext): Promise<readonly LocalSegment[]>;
  translate(text: string, context: readonly TranslationContextTurn[], signal?: AbortSignal, options?: { readonly polish?: boolean }): Promise<{ readonly text: string; readonly elapsedMs: number }>;
  translateBatch?(items: readonly { readonly id: string; readonly start: number; readonly end: number; readonly speakerId: string | null; readonly text: string }[], context: readonly TranslationContextTurn[]): Promise<readonly { readonly id: string; readonly text: string }[]>;
  summarize(transcript: string): Promise<string>;
}

type TranscriptionContext = {
  readonly sequence: number;
  readonly start: number;
  readonly duration: number;
  readonly language: string;
  readonly interpret: boolean;
  readonly signal?: AbortSignal;
  readonly minimumLanguageProbability?: number;
};

type InferenceOptions = {
  readonly whisperUrl: string;
  readonly whisperModel: string;
  readonly ollamaUrl: string;
  readonly ollamaModel: string;
  readonly timeoutMs: number;
  readonly queueLimit: number;
  /** Live glossary feed (re-read per request so edits apply immediately). */
  readonly getGlossary?: () => readonly GlossaryTerm[];
};

const whisperResponseSchema = z.object({
  text: z.string().default(''),
  language_probabilities: z.record(z.number()).optional(),
  segments: z.array(z.object({
    text: z.string(),
    start: z.number().optional(),
    end: z.number().optional(),
    offsets: z.object({ from: z.number(), to: z.number() }).optional(),
  })).optional(),
});
const ollamaResponseSchema = z.object({ message: z.object({ content: z.string() }) });
const ollamaTagsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });
const koreanSchema = z.object({ ko: z.string().trim().min(1) });
const koreanBatchSchema = z.object({ translations: z.array(z.object({ id: z.string(), ko: z.string().trim().min(1) })) });
const markdownSchema = z.object({ markdown: z.string().trim().min(1) });
type TranslationRegister = 'polite' | 'plain' | 'preserve';

function translationRegister(text: string): TranslationRegister {
  const normalized = text.trim();
  if (/(?:です|ます|ました|ません|でしょう|ください|ございます|いたします)(?:か)?[。！？?]?$/.test(normalized)) return 'polite';
  if (/[?？]$/.test(normalized)) return 'plain';
  return 'preserve';
}

class SerialQueue {
  #tail: Promise<void> = Promise.resolve();
  #pending = 0;
  readonly #limit: number;

  constructor(limit: number) { this.#limit = limit; }

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    if (this.#pending >= this.#limit) throw new LocalServerError('INFERENCE_BUSY', 429, 'Local inference queue is full');
    this.#pending += 1;
    const previous = this.#tail;
    let release: () => void = () => undefined;
    this.#tail = new Promise((resolve) => { release = resolve; });
    let acquired = false;
    try {
      await waitForTurn(previous, signal);
      throwIfAborted(signal);
      acquired = true;
      return await operation();
    } finally {
      this.#pending -= 1;
      if (acquired) release();
      else void previous.then(release);
    }
  }
}

async function waitForTurn(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return previous;
  throwIfAborted(signal);
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { await Promise.race([previous, aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('This operation was aborted', 'AbortError');
}

async function parseInferenceResponse<T>(response: Response, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  try { return schema.parse(await response.json()); }
  catch (error) { return rethrowInvalidInferenceResponse(error); }
}

function parseInferenceContent<T>(content: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  try { return schema.parse(JSON.parse(content)); }
  catch (error) { return rethrowInvalidInferenceResponse(error); }
}

function rethrowInvalidInferenceResponse(error: unknown): never {
  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    throw new LocalServerError('INFERENCE_FAILED', 502, 'Local inference returned an invalid response');
  }
  throw error;
}

export class LocalInference implements InferenceClient {
  readonly #options: InferenceOptions;
  readonly #whisperQueue: SerialQueue;
  readonly #ollamaQueue: SerialQueue;

  constructor(options: InferenceOptions) {
    this.#options = options;
    this.#whisperQueue = new SerialQueue(options.queueLimit);
    this.#ollamaQueue = new SerialQueue(options.queueLimit);
  }

  async status() {
    const [whisper, ollama] = await Promise.all([this.#whisperStatus(), this.#ollamaStatus()]);
    return serviceStatusSchema.parse({ ready: whisper.ready && ollama.ready, whisper, ollama });
  }

  async transcribe(audio: Blob, context: TranscriptionContext): Promise<readonly LocalSegment[]> {
    const glossary = this.#options.getGlossary?.() ?? [];
    const whisperPrompt = buildWhisperGlossaryPrompt(glossary);
    const result = await this.#whisperQueue.run(async () => {
      const form = new FormData();
      form.set('file', audio, 'chunk.wav');
      form.set('response_format', 'verbose_json');
      form.set('language', context.language);
      form.set('temperature', '0');
      if (whisperPrompt !== '') form.set('prompt', whisperPrompt);
      const response = await this.#request(`${this.#options.whisperUrl}/inference`, { method: 'POST', body: form }, context.signal);
      return parseInferenceResponse(response, whisperResponseSchema);
    }, context.signal);
    const languageProbabilities = result.language_probabilities;
    const languageProbability = languageProbabilities === undefined || Object.keys(languageProbabilities).length === 0
      ? undefined
      : languageProbabilities[context.language] ?? 0;
    if (context.minimumLanguageProbability !== undefined
      && languageProbability !== undefined
      && languageProbability < context.minimumLanguageProbability) return [];
    const rawSegments = result.segments ?? (result.text.trim().length === 0 ? [] : [{ text: result.text, start: 0, end: context.duration }]);
    const segments: LocalSegment[] = [];
    for (const [index, raw] of rawSegments.entries()) {
      const sourceText = applyReplacementRules(raw.text.trim(), glossary);
      if (sourceText.length === 0) continue;
      let translation: string | null = null;
      let translationError: string | null = null;
      if (context.interpret && context.language === 'ja') {
        try { translation = await this.#ollamaQueue.run(() => this.#translateDirect(sourceText, [], context.signal), context.signal); } catch (error) {
          if (context.signal?.aborted === true) throw abortReason(context.signal);
          translationError = error instanceof Error ? error.message : 'Translation failed';
        }
      }
      const whisperStart = raw.start ?? (raw.offsets === undefined ? 0 : raw.offsets.from / 1000);
      const whisperEnd = raw.end ?? (raw.offsets === undefined ? context.duration : raw.offsets.to / 1000);
      const relativeStart = Math.max(0, Math.min(whisperStart, context.duration));
      const relativeEnd = Math.max(relativeStart, Math.min(whisperEnd, context.duration));
      segments.push({
        id: `segment-${crypto.randomUUID()}`,
        sequence: context.sequence * 1000 + index,
        start: context.start + relativeStart,
        end: context.start + relativeEnd,
        sourceText,
        translation,
        translationError,
      });
    }
    return segments;
  }

  async translate(text: string, context: readonly TranslationContextTurn[] = [], signal?: AbortSignal, options?: { readonly polish?: boolean }) {
    const startedAt = performance.now();
    const polish = options?.polish !== false;
    // Replacement rules are deterministic — apply them to the input text so
    // direct translations match what the ASR path already produces.
    const prepared = applyReplacementRules(text, this.#options.getGlossary?.() ?? []);
    const translated = await this.#ollamaQueue.run(() => this.#translateDirect(prepared, context, signal, polish), signal);
    return translationSchema.parse({ text: translated, elapsedMs: performance.now() - startedAt });
  }

  async translateBatch(items: readonly { readonly id: string; readonly start: number; readonly end: number; readonly speakerId: string | null; readonly text: string }[], context: readonly TranslationContextTurn[]) {
    if (items.length === 0) return [];
    const content = await this.#ollamaQueue.run(() => this.#ollama(
      '일본어 회의 발언을 시간 순서대로 한국어로 충실히 통역하세요. 각 id를 정확히 한 번씩 유지하고, 발언별 어조·존댓말·질문·수치·고유명사를 보존하세요. speakerId가 null이면 화자를 추측하지 마세요. 이전 문맥은 용어와 생략된 주어 해석에만 사용하세요. 설명이나 추측을 추가하지 마세요.',
      JSON.stringify({ context, items }),
      { type: 'object', properties: { translations: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, ko: { type: 'string' } }, required: ['id', 'ko'] } } }, required: ['translations'] },
    ));
    const parsed = parseInferenceContent(content, koreanBatchSchema).translations;
    const byId = new Map(parsed.map((item) => [item.id, item.ko]));
    if (parsed.length !== items.length || byId.size !== items.length || items.some((item) => !byId.has(item.id))) {
      throw new LocalServerError('INVALID_TRANSLATION', 502, 'Batch translation omitted or repeated a segment');
    }
    return items.map((item) => ({ id: item.id, text: byId.get(item.id)! }));
  }

  async summarize(transcript: string): Promise<string> {
    return this.#ollamaQueue.run(async () => {
      const content = await this.#ollama(
        '당신은 한국어 회의록 작성자입니다. 제공된 발언에만 근거해 Markdown으로 핵심 논의, 결정, 다음 단계를 정리하세요. 불명확하거나 근거가 없는 내용은 추정하지 말고 확인 필요로 표시하세요.',
        transcript,
        { type: 'object', properties: { markdown: { type: 'string' } }, required: ['markdown'] },
      );
      return parseInferenceContent(content, markdownSchema).markdown;
    });
  }

  async #translateDirect(
    text: string,
    context: readonly TranslationContextTurn[] = [],
    signal?: AbortSignal,
    polish = true,
  ): Promise<string> {
    const system = appendGlossaryAndPolish(
      '일본어 발언의 현재 문장만 자연스럽고 충실한 한국어로 통역하세요. targetRegister가 plain이면 반드시 비격식체로, polite이면 반드시 존댓말로, preserve이면 원문의 말투를 그대로 옮기세요. 이전 문맥은 호칭, 어조, 생략된 주어와 용어를 일관되게 해석하는 데만 사용하고 번역문에 반복하지 마세요. 질문, 확신, 완곡함을 유지하세요. 문장이 덜 끝났다면 내용을 추측해 완성하지 마세요. 통역 전문 용어는 정확히 옮기고 同時通訳는 동시통역으로 번역하세요. 고유명사는 임의로 음역하거나 바꾸지 말고, 불확실하면 원문을 보존하세요. 설명이나 추측을 추가하지 마세요.',
      this.#options.getGlossary?.() ?? [],
      polish,
    );
    const content = await this.#ollama(
      system,
      JSON.stringify({ context, targetRegister: translationRegister(text), current: text }),
      { type: 'object', properties: { ko: { type: 'string' } }, required: ['ko'] },
      signal,
    );
    return parseInferenceContent(content, koreanSchema).ko;
  }

  async #ollama(system: string, content: string, format: object, signal?: AbortSignal): Promise<string> {
    const response = await this.#request(`${this.#options.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.#options.ollamaModel, messages: [{ role: 'system', content: system }, { role: 'user', content }], stream: false, think: false, keep_alive: '5m', format, options: { temperature: 0 } }),
    }, signal);
    return (await parseInferenceResponse(response, ollamaResponseSchema)).message.content;
  }

  // Status probes must fail fast: they reuse #request's inference timeout
  // (180s), so a hung service would stack minutes-long polls. 5s is plenty
  // for a loopback health check.
  async #probe(url: string): Promise<Response | null> {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(5_000) });
    } catch {
      return null;
    }
  }

  async #whisperStatus() {
    const response = await this.#probe(`${this.#options.whisperUrl}/health`);
    if (response === null) return { ready: false, model: this.#options.whisperModel, error: 'Unavailable' };
    return { ready: response.ok, model: this.#options.whisperModel, error: response.ok ? null : `HTTP ${response.status}` };
  }

  async #ollamaStatus() {
    const response = await this.#probe(`${this.#options.ollamaUrl}/api/tags`);
    if (response === null) return { ready: false, model: this.#options.ollamaModel, error: 'Unavailable' };
    if (!response.ok) return { ready: false, model: this.#options.ollamaModel, error: `HTTP ${response.status}` };
    try {
      const tags = ollamaTagsSchema.parse(await response.json());
      const ready = tags.models.some((model) => model.name === this.#options.ollamaModel);
      return { ready, model: this.#options.ollamaModel, error: ready ? null : 'Configured model is not installed' };
    } catch {
      return { ready: false, model: this.#options.ollamaModel, error: 'Unavailable' };
    }
  }

  async #request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const timeoutSignal = AbortSignal.timeout(this.#options.timeoutMs);
    const requestSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
    const response = await fetch(url, { ...init, signal: requestSignal });
    if (!response.ok) throw new LocalServerError('INFERENCE_FAILED', 502, `Local inference returned HTTP ${response.status}`);
    return response;
  }
}

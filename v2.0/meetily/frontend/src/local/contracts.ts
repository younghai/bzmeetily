import { z } from 'zod';

export const languageSchema = z.enum(['ja', 'ko', 'en', 'auto']);
export type SourceLanguage = z.infer<typeof languageSchema>;
export const meetingIdSchema = z.string().regex(/^meeting-[a-zA-Z0-9-]{8,80}$/);
export const createMeetingSchema = z.object({
  title: z.string().trim().min(1).max(180),
  language: languageSchema,
  interpret: z.boolean(),
});
export const segmentSchema = z.object({
  id: z.string(),
  sequence: z.number().int().nonnegative(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  sourceText: z.string(),
  translation: z.string().nullable(),
  translationError: z.string().nullable(),
});
export type LocalSegment = z.infer<typeof segmentSchema>;
export const meetingSchema = z.object({
  id: meetingIdSchema,
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  language: languageSchema,
  interpret: z.boolean(),
  segmentCount: z.number().int().nonnegative(),
});
export type LocalMeeting = z.infer<typeof meetingSchema>;
export const meetingDetailSchema = meetingSchema.extend({
  segments: z.array(segmentSchema),
  summary: z.string().nullable(),
  audioAvailable: z.boolean(),
});
export type MeetingDetail = z.infer<typeof meetingDetailSchema>;
export const serviceStatusSchema = z.object({
  ready: z.boolean(),
  whisper: z.object({ ready: z.boolean(), model: z.string(), error: z.string().nullable() }),
  ollama: z.object({ ready: z.boolean(), model: z.string(), error: z.string().nullable() }),
});
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export const translationContextTurnSchema = z.object({
  sourceText: z.string().trim().min(1).max(3000),
  translation: z.string().trim().min(1).max(3000),
});
export type TranslationContextTurn = z.infer<typeof translationContextTurnSchema>;
export const translationRequestSchema = z.object({
  text: z.string().trim().min(1).max(12000),
  sourceLanguage: z.literal('ja'),
  targetLanguage: z.literal('ko'),
  context: z.array(translationContextTurnSchema).max(2).default([]),
  /** Clean fillers/repeats in the Korean output (default true). */
  polish: z.boolean().optional(),
});
export const glossaryIdSchema = z.string().regex(/^glossary-[a-zA-Z0-9-]{8,80}$/);
export const glossaryTermSchema = z.object({
  id: glossaryIdSchema,
  sourceValue: z.string().trim().min(1).max(120),
  destinationValue: z.string().trim().min(1).max(120),
  kind: z.enum(['term', 'replacement']),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;
export const glossaryTermListSchema = z.array(glossaryTermSchema);
export const createGlossaryTermSchema = z.object({
  sourceValue: z.string().trim().min(1).max(120),
  destinationValue: z.string().trim().min(1).max(120),
  kind: z.enum(['term', 'replacement']).default('term'),
});
export const updateGlossaryTermSchema = z.object({
  sourceValue: z.string().trim().min(1).max(120).optional(),
  destinationValue: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(['term', 'replacement']).optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export const translationSchema = z.object({ text: z.string(), elapsedMs: z.number().nonnegative() });
export const summarySchema = z.object({ markdown: z.string() });
export const importResultSchema = z.object({ meeting: meetingDetailSchema });
export const importJobSchema = z.object({
  id: z.string().regex(/^import-[0-9a-f-]{36}$/),
  meetingId: meetingIdSchema,
  state: z.enum(['queued', 'processing', 'failed', 'completed']),
  stage: z.enum(['queued', 'decoding', 'transcribing', 'translating', 'saving', 'completed']),
  completedChunks: z.number().int().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
  error: z.string().nullable(),
  metrics: z.object({ uploadMs: z.number().nonnegative(), decodeMs: z.number().nonnegative(), silenceMs: z.number().nonnegative(), asrMs: z.number().nonnegative(), translateMs: z.number().nonnegative(), saveMs: z.number().nonnegative(), totalMs: z.number().nonnegative(), firstTranscriptMs: z.number().nonnegative().nullable(), peakRssBytes: z.number().nonnegative(), translatedSegments: z.number().int().nonnegative() }),
});
export type ImportJob = z.infer<typeof importJobSchema>;
export const chunkResultSchema = z.object({ segments: z.array(segmentSchema) });
export const chunkQuerySchema = z.object({
  sequence: z.coerce.number().int().min(0).max(100000),
  start: z.coerce.number().min(0).max(86400),
  duration: z.coerce.number().positive().max(60),
});

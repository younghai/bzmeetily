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
export const translationRequestSchema = z.object({
  text: z.string().trim().min(1).max(12000),
  sourceLanguage: z.literal('ja'),
  targetLanguage: z.literal('ko'),
});
export const translationSchema = z.object({ text: z.string(), elapsedMs: z.number().nonnegative() });
export const summarySchema = z.object({ markdown: z.string() });
export const importResultSchema = z.object({ meeting: meetingDetailSchema });
export const chunkResultSchema = z.object({ segments: z.array(segmentSchema) });
export const chunkQuerySchema = z.object({
  sequence: z.coerce.number().int().min(0).max(100000),
  start: z.coerce.number().min(0).max(86400),
  duration: z.coerce.number().positive().max(60),
});

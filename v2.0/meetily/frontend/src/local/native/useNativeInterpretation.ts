import { useEffect, useRef, useState } from 'react';

import { requestTranslation } from '@/local/client';
import type { Transcript } from '@/types';

import {
  InterpretationQueue,
  type InterpretationSnapshot,
} from './interpretationQueue';

type InterpretationOptions = {
  readonly enabled: boolean;
  readonly isRecording: boolean;
  readonly currentMeetingId: string | null;
  readonly transcripts: readonly Transcript[];
};

type ActiveSession = {
  readonly meetingId: string | null;
  readonly seenTranscriptIds: Set<string>;
};

const EMPTY_SNAPSHOT: InterpretationSnapshot = { items: [], pending: 0 };

function transcriptIdentity(transcript: Transcript): string {
  return transcript.sequence_id === undefined ? transcript.id : `sequence-${transcript.sequence_id}`;
}

export function useNativeInterpretation(options: InterpretationOptions) {
  const [snapshot, setSnapshot] = useState<InterpretationSnapshot>(EMPTY_SNAPSHOT);
  const queueRef = useRef<InterpretationQueue | null>(null);
  const sessionRef = useRef<ActiveSession | null>(null);
  const previousRecordingRef = useRef(false);
  const idleTranscriptIdsRef = useRef<Set<string>>(new Set());

  if (queueRef.current === null) {
    queueRef.current = new InterpretationQueue(
      async ({ text, context }, signal) => ({ text: (await requestTranslation(text, context, signal)).text }),
      setSnapshot,
    );
  }
  const queue = queueRef.current;

  useEffect(() => () => queue.cancel(), [queue]);

  useEffect(() => {
    if (options.enabled && !options.isRecording) {
      idleTranscriptIdsRef.current = new Set(options.transcripts.map(transcriptIdentity));
    }
  }, [options.enabled, options.isRecording, options.transcripts]);

  useEffect(() => {
    const recordingStarted = options.isRecording && !previousRecordingRef.current;
    previousRecordingRef.current = options.isRecording;

    if (!options.enabled) {
      sessionRef.current = null;
      queue.reset();
      return;
    }

    if (recordingStarted) {
      queue.reset();
      sessionRef.current = {
        meetingId: options.currentMeetingId,
        seenTranscriptIds: new Set(idleTranscriptIdsRef.current),
      };
      return;
    }

    const session = sessionRef.current;
    if (!session) return;

    if (session.meetingId === null && options.currentMeetingId !== null) {
      sessionRef.current = { ...session, meetingId: options.currentMeetingId };
      return;
    }

    if (session.meetingId !== options.currentMeetingId) {
      if (!options.isRecording) return;
      queue.reset();
      sessionRef.current = {
        meetingId: options.currentMeetingId,
        seenTranscriptIds: new Set(idleTranscriptIdsRef.current),
      };
    }
  }, [options.currentMeetingId, options.enabled, options.isRecording, options.transcripts, queue]);

  useEffect(() => {
    if (!options.enabled) return;
    const session = sessionRef.current;
    if (!session) return;

    options.transcripts.forEach((transcript) => {
      const id = transcriptIdentity(transcript);
      if (!transcript.text.trim() || session.seenTranscriptIds.has(id)) return;
      session.seenTranscriptIds.add(id);
      queue.enqueue({
        id,
        sourceText: transcript.text.trim(),
        timestamp: transcript.timestamp,
      });
    });
  }, [options.enabled, options.transcripts, queue]);

  return {
    ...snapshot,
    retry: (id: string) => queue.retry(id),
  };
}

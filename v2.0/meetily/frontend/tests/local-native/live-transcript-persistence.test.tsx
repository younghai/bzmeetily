import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Transcript, TranscriptUpdate } from '../../src/types';
import type { RecordingLifecyclePayload, RecordingStoppedPayload } from '../../src/services/recordingService';

const originalRecordingService = { ...await import('../../src/services/recordingService') };
const originalTranscriptService = { ...await import('../../src/services/transcriptService') };
const originalIndexedDBService = { ...await import('../../src/services/indexedDBService') };
const originalRecordingContext = { ...await import('../../src/contexts/RecordingStateContext') };

let onStarting: ((payload: RecordingLifecyclePayload) => void) | undefined;
let onStarted: ((payload: RecordingLifecyclePayload) => void) | undefined;
let onStopped: ((payload: RecordingStoppedPayload) => void) | undefined;
let onTranscript: ((update: TranscriptUpdate) => void) | undefined;

const init = mock(async () => {});
const saveMeetingMetadata = mock(async () => {});
const saveTranscript = mock(async () => {});

mock.module('../../src/services/recordingService', () => ({
  recordingService: {
    onRecordingStarting: async (callback: (payload: RecordingLifecyclePayload) => void) => {
      onStarting = callback;
      return () => {};
    },
    onRecordingStarted: async (callback: (payload: RecordingLifecyclePayload) => void) => {
      onStarted = callback;
      return () => {};
    },
    onRecordingStopped: async (callback: (payload: RecordingStoppedPayload) => void) => {
      onStopped = callback;
      return () => {};
    },
    getRecordingMeetingName: async () => null,
  },
}));
mock.module('../../src/services/transcriptService', () => ({
  transcriptService: {
    onTranscriptUpdate: async (callback: (update: TranscriptUpdate) => void) => {
      onTranscript = callback;
      return () => {};
    },
    getTranscriptHistory: async () => [],
  },
}));
mock.module('../../src/services/indexedDBService', () => ({
  indexedDBService: {
    init,
    saveMeetingMetadata,
    saveTranscript,
    getMeetingMetadata: async () => null,
  },
}));
mock.module('../../src/contexts/RecordingStateContext', () => ({
  ...originalRecordingContext,
  useRecordingState: () => recordingSnapshot,
}));

const { TranscriptProvider, useTranscripts } = await import('../../src/contexts/TranscriptContext');

let renderer: ReactTestRenderer | undefined;
let observedTranscripts: Transcript[] = [];
let observedMeetingId: string | null = null;
let observedLiveInterpretation = false;
let recordingSnapshot = {
  isRecording: true,
  isLiveInterpretation: false,
  status: originalRecordingContext.RecordingStatus.RECORDING,
};
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');

function Probe() {
  const context = useTranscripts();
  observedTranscripts = context.transcripts;
  observedMeetingId = context.currentMeetingId;
  observedLiveInterpretation = context.isLiveInterpretation;
  return null;
}

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  init.mockClear();
  saveMeetingMetadata.mockClear();
  saveTranscript.mockClear();
  observedMeetingId = null;
  observedLiveInterpretation = false;
  recordingSnapshot = {
    isRecording: true,
    isLiveInterpretation: false,
    status: originalRecordingContext.RecordingStatus.RECORDING,
  };
});

afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  observedTranscripts = [];
  onStarting = undefined;
  onStarted = undefined;
  onStopped = undefined;
  onTranscript = undefined;
});

afterAll(() => {
  if (originalSessionStorage) Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
  else Reflect.deleteProperty(globalThis, 'sessionStorage');
  mock.module('../../src/services/recordingService', () => originalRecordingService);
  mock.module('../../src/services/transcriptService', () => originalTranscriptService);
  mock.module('../../src/services/indexedDBService', () => originalIndexedDBService);
  mock.module('../../src/contexts/RecordingStateContext', () => originalRecordingContext);
});

describe('live interpretation transcript persistence', () => {
  test('restores live suppression from synchronized backend state after remount', async () => {
    // Given: the provider remounts while the native backend is already interpreting.
    recordingSnapshot = {
      isRecording: true,
      isLiveInterpretation: true,
      status: originalRecordingContext.RecordingStatus.RECORDING,
    };

    // When: transcript state initializes without receiving the earlier started event.
    await act(async () => {
      renderer = create(<TranscriptProvider><Probe /></TranscriptProvider>);
      await Promise.resolve();
    });

    // Then: the session remains temporary and skips recovery persistence.
    expect(observedLiveInterpretation).toBe(true);
    expect(observedMeetingId).toBeNull();
    expect(saveMeetingMetadata).not.toHaveBeenCalled();
  });

  test('preserves the previous meeting identity when live startup fails', async () => {
    // Given: an ordinary recording has established recovery identity.
    await act(async () => {
      renderer = create(<TranscriptProvider><Probe /></TranscriptProvider>);
      await Promise.resolve();
    });
    await act(async () => {
      onStarted?.({});
      await Promise.resolve();
    });
    const previousMeetingId = observedMeetingId;
    expect(previousMeetingId).not.toBeNull();

    // When: live startup begins, emits early text, and then fails.
    await act(async () => {
      onStarting?.({ live_interpretation: true });
      onTranscript?.({
        text: '開始途中です。',
        timestamp: '10:00:00',
        source: 'system',
        sequence_id: 1,
        chunk_start_time: 0,
        is_partial: true,
        confidence: 0.9,
        audio_start_time: 0,
        audio_end_time: 1,
        duration: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(observedMeetingId).toBe(previousMeetingId);
    expect(observedLiveInterpretation).toBe(false);
    expect(saveTranscript).not.toHaveBeenCalled();

    recordingSnapshot = {
      isRecording: false,
      isLiveInterpretation: false,
      status: originalRecordingContext.RecordingStatus.ERROR,
    };
    await act(async () => {
      renderer?.update(<TranscriptProvider><Probe /></TranscriptProvider>);
      await Promise.resolve();
    });

    // Then: suppression rolls back and later ordinary data uses the old identity.
    await act(async () => {
      onTranscript?.({
        text: '既存会議を続けます。',
        timestamp: '10:00:02',
        source: 'system',
        sequence_id: 2,
        chunk_start_time: 2,
        is_partial: false,
        confidence: 0.9,
        audio_start_time: 2,
        audio_end_time: 3,
        duration: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(saveTranscript).toHaveBeenCalledWith(previousMeetingId, expect.objectContaining({ sequence_id: 2 }));
  });

  test('shows live transcripts without writing meeting recovery data', async () => {
    await act(async () => {
      renderer = create(<TranscriptProvider><Probe /></TranscriptProvider>);
      await Promise.resolve();
    });

    await act(async () => {
      onStarting?.({ live_interpretation: true });
      onStarted?.({ live_interpretation: true });
    });

    const update: TranscriptUpdate = {
      text: '短い音声です。',
      timestamp: '10:00:01',
      source: 'system',
      sequence_id: 1,
      chunk_start_time: 0,
      is_partial: true,
      confidence: 0.9,
      audio_start_time: 0,
      audio_end_time: 2,
      duration: 2,
    };
    await act(async () => {
      onTranscript?.(update);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(observedTranscripts).toHaveLength(1);
    expect(observedTranscripts[0]?.text).toBe('短い音声です。');
    expect(saveMeetingMetadata).not.toHaveBeenCalled();
    expect(saveTranscript).not.toHaveBeenCalled();
  });
});

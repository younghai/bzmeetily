import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const originalRecordingService = { ...await import('../../src/services/recordingService') };
const originalTranscriptContext = { ...await import('../../src/contexts/TranscriptContext') };
const originalRecordingContext = { ...await import('../../src/contexts/RecordingStateContext') };

const startLiveInterpretation = mock(async () => {});
const stopLiveInterpretation = mock(async () => {});
const clearTranscripts = mock(() => {});
const setStatus = mock(() => {});
let recordingSnapshot = {
  isRecording: false,
  isLiveInterpretation: false,
  status: originalRecordingContext.RecordingStatus.IDLE,
  setStatus,
};

mock.module('../../src/services/recordingService', () => ({
  ...originalRecordingService,
  recordingService: { startLiveInterpretation, stopLiveInterpretation },
}));
mock.module('../../src/contexts/TranscriptContext', () => ({
  ...originalTranscriptContext,
  useTranscripts: () => ({ clearTranscripts }),
}));
mock.module('../../src/contexts/RecordingStateContext', () => ({
  ...originalRecordingContext,
  useRecordingState: () => recordingSnapshot,
}));

const { useLiveInterpretation } = await import('../../src/local/native/useLiveInterpretation');

let renderer: ReactTestRenderer | undefined;
let latest: ReturnType<typeof useLiveInterpretation> | undefined;

function Probe() {
  latest = useLiveInterpretation({
    pendingTranslations: 0,
    micDeviceName: null,
    systemDeviceName: null,
  });
  return null;
}

beforeEach(() => {
  startLiveInterpretation.mockClear();
  stopLiveInterpretation.mockClear();
  clearTranscripts.mockClear();
  setStatus.mockClear();
  recordingSnapshot = {
    isRecording: false,
    isLiveInterpretation: false,
    status: originalRecordingContext.RecordingStatus.IDLE,
    setStatus,
  };
});

afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  latest = undefined;
});

afterAll(() => {
  mock.module('../../src/services/recordingService', () => originalRecordingService);
  mock.module('../../src/contexts/TranscriptContext', () => originalTranscriptContext);
  mock.module('../../src/contexts/RecordingStateContext', () => originalRecordingContext);
});

describe('native live interpretation controls', () => {
  test('restores an active live session and returns to idle after an external stop', async () => {
    // Given: the backend-synchronized context says live interpretation is active.
    recordingSnapshot = {
      isRecording: true,
      isLiveInterpretation: true,
      status: originalRecordingContext.RecordingStatus.RECORDING,
      setStatus,
    };

    // When: the live hook mounts.
    await act(async () => {
      renderer = create(<Probe />);
    });

    // Then: the control resumes without starting a second stream.
    expect(latest?.phase).toBe('live');
    expect(startLiveInterpretation).not.toHaveBeenCalled();

    // When: a tray stop is synchronized through the global context.
    recordingSnapshot = {
      isRecording: false,
      isLiveInterpretation: false,
      status: originalRecordingContext.RecordingStatus.IDLE,
      setStatus,
    };
    await act(async () => {
      renderer?.update(<Probe />);
    });

    // Then: the local control leaves the stale live phase.
    expect(latest?.phase).toBe('idle');
  });

  test('starts both audio sources and stops without invoking the saved recording flow', async () => {
    await act(async () => {
      renderer = create(<Probe />);
    });

    await act(async () => {
      await latest?.start();
    });
    expect(startLiveInterpretation).toHaveBeenCalledWith(null, null, 'both');
    expect(clearTranscripts).toHaveBeenCalledTimes(1);
    expect(latest?.phase).toBe('live');

    await act(async () => {
      await latest?.stop();
    });
    expect(stopLiveInterpretation).toHaveBeenCalledTimes(1);
    expect(latest?.phase).toBe('idle');
  });
});

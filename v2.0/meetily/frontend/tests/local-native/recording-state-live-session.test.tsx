import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

let startedListener: ((payload: { live_interpretation?: boolean }) => void) | undefined;

const originalRecordingService = { ...await import('../../src/services/recordingService') };
const getRecordingState = mock(async () => ({
  is_recording: true,
  live_interpretation: true,
  is_paused: false,
  is_active: true,
  recording_duration: 12,
  active_duration: 12,
}));

mock.module('../../src/services/recordingService', () => ({
  recordingService: {
    getRecordingState,
    onRecordingStarted: async (callback: (payload: { live_interpretation?: boolean }) => void) => {
      startedListener = callback;
      return () => { startedListener = undefined; };
    },
    onRecordingStarting: async () => () => {},
    onRecordingStopped: async () => () => {},
    onRecordingPaused: async () => () => {},
    onRecordingResumed: async () => () => {},
    onMicDeviceSwitched: async () => () => {},
    onMicSwapFailed: async () => () => {},
    onMicUnavailable: async () => () => {},
    onMicRecoveryExhausted: async () => () => {},
  },
}));

const recordingContext = await import('../../src/contexts/RecordingStateContext');
const { RecordingStateProvider, useRecordingState } = recordingContext;

let renderer: ReactTestRenderer | undefined;
let latestState: ReturnType<typeof useRecordingState> | undefined;
let observed = {
  isRecording: false,
  isLiveInterpretation: false,
  status: recordingContext.RecordingStatus.IDLE,
};

function Probe() {
  const state = useRecordingState();
  latestState = state;
  observed = {
    isRecording: state.isRecording,
    isLiveInterpretation: state.isLiveInterpretation,
    status: state.status,
  };
  return null;
}

beforeEach(() => {
  getRecordingState.mockClear();
  observed = {
    isRecording: false,
    isLiveInterpretation: false,
    status: recordingContext.RecordingStatus.IDLE,
  };
});

afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
});

afterAll(() => {
  mock.module('../../src/services/recordingService', () => originalRecordingService);
});

describe('recording state live session recovery', () => {
  test('keeps the stopping status while the live backend drains audio', async () => {
    await act(async () => {
      renderer = create(<RecordingStateProvider><Probe /></RecordingStateProvider>);
    });
    await act(async () => { startedListener?.({ live_interpretation: true }); });
    await act(async () => { latestState?.setStatus(recordingContext.RecordingStatus.STOPPING); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
    expect(getRecordingState.mock.calls.length).toBeGreaterThan(1);
    expect(observed.status).toBe(recordingContext.RecordingStatus.STOPPING);
  });

  test('restores the live interpretation flag from backend state', async () => {
    // Given: native capture is already running as a live interpretation session.
    // When: the provider mounts and synchronizes with Rust.
    await act(async () => {
      renderer = create(<RecordingStateProvider><Probe /></RecordingStateProvider>);
      await Promise.resolve();
    });

    // Then: consumers can distinguish live interpretation from saved recording.
    expect(getRecordingState).toHaveBeenCalled();
    expect(observed).toEqual({
      isRecording: true,
      isLiveInterpretation: true,
      status: recordingContext.RecordingStatus.RECORDING,
    });
  });
});

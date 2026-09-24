import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const originalRecordingService = { ...await import('../../src/services/recordingService') };
const isRecording = mock(async (): Promise<boolean> => true);
mock.module('../../src/services/recordingService', () => ({ recordingService: { isRecording } }));
const { useRecordingStateSync } = await import('../../src/hooks/useRecordingStateSync');

let renderer: ReactTestRenderer | undefined;
const setIsRecording = mock((_value: boolean): void => {});
const setIsMeetingActive = mock((_value: boolean): void => {});

function RecordingStateProbe() {
  useRecordingStateSync(false, setIsRecording, setIsMeetingActive);
  return null;
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'isTauri', { configurable: true, value: true });
  isRecording.mockClear();
  setIsRecording.mockClear();
  setIsMeetingActive.mockClear();
});

afterEach(async () => {
  if (renderer) {
    await act(async () => renderer?.unmount());
  }
  renderer = undefined;
  Reflect.deleteProperty(globalThis, 'isTauri');
});

afterAll(() => {
  mock.module('../../src/services/recordingService', () => originalRecordingService);
});

describe('recording state synchronization', () => {
  test('sets the recording flags on initial sync in a Tauri v2 runtime', async () => {
    // Given: the Tauri v2 runtime marker is present and the backend is recording.
    // When: the synchronization hook mounts.
    await act(async () => {
      renderer = create(<RecordingStateProbe />);
    });

    // Then: the frontend state is synchronized immediately.
    expect(isRecording).toHaveBeenCalledTimes(1);
    expect(setIsRecording).toHaveBeenCalledWith(true);
    expect(setIsMeetingActive).toHaveBeenCalledWith(true);
  });
});

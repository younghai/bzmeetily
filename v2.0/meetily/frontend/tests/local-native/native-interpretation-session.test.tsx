import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Transcript } from '../../src/types';

const originalClient = { ...await import('../../src/local/client') };
const requestTranslation = mock(async () => ({ text: '회의를 시작합니다.', elapsedMs: 1 }));
mock.module('../../src/local/client', () => ({ ...originalClient, requestTranslation }));
const { useNativeInterpretation } = await import('../../src/local/native/useNativeInterpretation');

type ProbeProps = {
  readonly isRecording: boolean;
  readonly currentMeetingId: string | null;
  readonly transcripts: readonly Transcript[];
};

let renderer: ReactTestRenderer | undefined;
let latestItems: ReturnType<typeof useNativeInterpretation>['items'] = [];

function Probe(props: ProbeProps) {
  latestItems = useNativeInterpretation({ enabled: true, ...props }).items;
  return null;
}

afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  latestItems = [];
  requestTranslation.mockClear();
});

afterAll(() => {
  mock.module('../../src/local/client', () => originalClient);
});

describe('native interpretation session', () => {
  test('translates a short partial chunk while live capture is still running', async () => {
    await act(async () => {
      renderer = create(<Probe isRecording currentMeetingId={null} transcripts={[]} />);
    });

    const partialChunk: Transcript = {
      id: 'short-chunk',
      text: '会議を始めます。',
      timestamp: '10:00:01',
      sequence_id: 1,
      is_partial: true,
    };
    await act(async () => {
      renderer?.update(<Probe isRecording currentMeetingId={null} transcripts={[partialChunk]} />);
      await Promise.resolve();
    });

    expect(latestItems).toHaveLength(1);
    expect(latestItems[0]).toMatchObject({
      sourceText: '会議を始めます。',
      translation: '회의를 시작합니다.',
    });
  });

  test('keeps completed captions when saving clears the current meeting id', async () => {
    await act(async () => {
      renderer = create(<Probe isRecording currentMeetingId="meeting-live" transcripts={[]} />);
    });

    const transcript: Transcript = {
      id: 'segment-1',
      text: '会議を始めます。',
      timestamp: '10:00:01',
      sequence_id: 1,
      is_partial: false,
    };
    await act(async () => {
      renderer?.update(<Probe isRecording currentMeetingId="meeting-live" transcripts={[transcript]} />);
      await Promise.resolve();
    });
    expect(latestItems).toHaveLength(1);
    expect(latestItems[0]?.translation).toBe('회의를 시작합니다.');

    await act(async () => {
      renderer?.update(<Probe isRecording={false} currentMeetingId={null} transcripts={[transcript]} />);
    });

    expect(latestItems).toHaveLength(1);
    expect(latestItems[0]?.sourceText).toBe('会議を始めます。');
  });
});

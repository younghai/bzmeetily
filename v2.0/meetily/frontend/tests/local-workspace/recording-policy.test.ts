import { describe, expect, test } from 'bun:test';

import { recordingLock, recordingSaveNotice, recordingStartBlock } from '../../src/local/recordingPolicy';
import type { MeetingDetail, ServiceStatus } from '../../src/local/contracts';

const readyStatus: ServiceStatus = {
  ready: true,
  whisper: { ready: true, model: 'test-whisper', error: null },
  ollama: { ready: true, model: 'test-ollama', error: null },
};

const emptyMeeting: MeetingDetail = {
  id: 'meeting-test-12345678',
  title: '테스트 회의',
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
  language: 'ja',
  interpret: true,
  segmentCount: 0,
  segments: [],
  summary: null,
  audioAvailable: false,
};

describe('recording policy', () => {
  test('allows recording only for a ready, new empty meeting', () => {
    // Given
    const meeting = emptyMeeting;

    // When
    const block = recordingStartBlock(meeting, readyStatus, false);

    // Then
    expect(block).toBeNull();
  });

  test('blocks additional recording when persisted transcript or audio exists', () => {
    // Given
    const transcriptMeeting = { ...emptyMeeting, segmentCount: 1 };
    const audioMeeting = { ...emptyMeeting, audioAvailable: true };

    // When
    const blocks = [
      recordingStartBlock(transcriptMeeting, readyStatus, false),
      recordingStartBlock(audioMeeting, readyStatus, false),
    ];

    // Then
    expect(blocks).toEqual([
      '추가 녹음은 새 회의를 만들어 시작하세요.',
      '추가 녹음은 새 회의를 만들어 시작하세요.',
    ]);
  });

  test('blocks recording while another workspace operation is active', () => {
    // Given
    const workspaceBusy = true;

    // When
    const block = recordingStartBlock(emptyMeeting, readyStatus, workspaceBusy);

    // Then
    expect(block).toBe('다른 작업이 끝난 뒤 녹음을 시작하세요.');
  });

  test('keeps the workspace locked while failed recording data awaits recovery', () => {
    // Given
    const phase = 'error';

    // When
    const locked = recordingLock(phase, true);

    // Then
    expect(locked).toBe(true);
  });

  test('retains a capture timeout warning through save failure and retry success', () => {
    // Given
    const warning = '최대 녹음 시간에 도달해 자동으로 중지했습니다.';

    // When
    const failedNotice = recordingSaveNotice(warning, '녹음 파일 저장 실패');
    const retrySuccessNotice = recordingSaveNotice(warning, null);

    // Then
    expect(failedNotice).toBe(`${warning}\n녹음 파일 저장 실패`);
    expect(retrySuccessNotice).toBe(warning);
  });
});

import type { MeetingDetail, ServiceStatus } from './contracts';

export type RecordingPhase = 'idle' | 'requesting' | 'recording' | 'draining' | 'error';

export function recordingStartBlock(
  meeting: MeetingDetail | null,
  status: ServiceStatus | null,
  externallyDisabled: boolean,
): string | null {
  if (externallyDisabled) return '다른 작업이 끝난 뒤 녹음을 시작하세요.';
  if (!meeting) return '먼저 새 회의를 만들어 주세요.';
  if (meeting.segmentCount > 0 || meeting.segments.length > 0 || meeting.audioAvailable) {
    return '추가 녹음은 새 회의를 만들어 시작하세요.';
  }
  if (status?.whisper.ready !== true) return '음성 인식 모델이 준비되지 않았습니다.';
  if (meeting.interpret && status.ollama.ready !== true) return '한국어 통역 모델이 준비되지 않았습니다.';
  return null;
}

export function recordingLock(phase: RecordingPhase, hasPendingRecording: boolean): boolean {
  return hasPendingRecording || phase === 'requesting' || phase === 'recording' || phase === 'draining';
}

export function recordingSaveNotice(captureWarning: string | null, saveError: string | null): string | null {
  if (captureWarning && saveError) return `${captureWarning}\n${saveError}`;
  return saveError ?? captureWarning;
}

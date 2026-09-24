export class CaptureError extends Error {
  readonly code: 'unsupported' | 'gesture-required' | 'denied' | 'missing-device' | 'no-display-audio' | 'cancelled';

  constructor(
    code: CaptureError['code'],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CaptureError';
    this.code = code;
  }
}

export function captureRequestError(error: unknown, sourceLabel: string): CaptureError {
  if (error instanceof CaptureError) return error;
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return new CaptureError('denied', `${sourceLabel} 권한이 거부되었습니다. 브라우저 권한을 확인해 주세요.`, { cause: error });
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return new CaptureError('missing-device', `${sourceLabel} 장치를 찾을 수 없습니다.`, { cause: error });
    }
    if (error.name === 'AbortError') {
      return new CaptureError('cancelled', `${sourceLabel} 선택이 취소되었습니다.`, { cause: error });
    }
  }
  return new CaptureError('unsupported', `${sourceLabel} 캡처를 시작하지 못했습니다. 브라우저 설정을 확인해 주세요.`, {
    cause: error,
  });
}

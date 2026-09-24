import { CaptureError, captureRequestError } from './errors';

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export async function requestStream(
  request: () => Promise<MediaStream>,
  signal: AbortSignal | undefined,
  sourceLabel: string,
): Promise<MediaStream> {
  if (signal?.aborted) throw new CaptureError('cancelled', `${sourceLabel} 요청이 취소되었습니다.`);
  if (!signal) {
    try {
      return await request();
    } catch (error) {
      throw captureRequestError(error, sourceLabel);
    }
  }

  return await new Promise<MediaStream>((resolve, reject) => {
    let abandoned = false;
    const onAbort = (): void => {
      abandoned = true;
      reject(new CaptureError('cancelled', `${sourceLabel} 요청이 취소되었습니다.`));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    request().then(
      (stream) => {
        signal.removeEventListener('abort', onAbort);
        if (abandoned) {
          stopStream(stream);
          return;
        }
        resolve(stream);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        if (!abandoned) reject(captureRequestError(error, sourceLabel));
      },
    );
  });
}

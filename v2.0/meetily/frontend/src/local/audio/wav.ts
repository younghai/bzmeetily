const WAV_HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodeWavHeader(dataBytes: number, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, WAV_HEADER_BYTES + dataBytes - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  return buffer;
}

export function encodePcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 32_768 : sample * 32_767, true);
  }

  return buffer;
}

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const header = encodeWavHeader(samples.length * 2, sampleRate);
  const pcm = encodePcm16(samples);
  const wav = new Uint8Array(header.byteLength + pcm.byteLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(new Uint8Array(pcm), header.byteLength);
  return wav.buffer;
}

export function wavBlob(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' });
}

export function wavBlobFromPcm(
  parts: readonly Blob[],
  sampleCount: number,
  sampleRate: number,
): Blob {
  return new Blob(
    [encodeWavHeader(sampleCount * 2, sampleRate), ...parts],
    { type: 'audio/wav' },
  );
}

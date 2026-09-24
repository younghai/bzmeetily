export const TARGET_SAMPLE_RATE = 16_000;

export function resampleLinear(
  input: Float32Array,
  inputRate: number,
  outputRate = TARGET_SAMPLE_RATE,
): Float32Array {
  if (input.length === 0 || inputRate === outputRate) {
    return input.slice();
  }

  const outputLength = Math.round((input.length * outputRate) / inputRate);
  const output = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const left = input[leftIndex] ?? 0;
    const right = input[rightIndex] ?? left;
    output[index] = left + (right - left) * (position - leftIndex);
  }

  return output;
}

export function rootMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) return 0;

  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function hasSpeechActivity(samples: Float32Array, sampleRate: number): boolean {
  const frameLength = Math.max(1, Math.round(sampleRate * 0.02));
  const frameCount = Math.ceil(samples.length / frameLength);
  const requiredActiveFrames = Math.min(3, frameCount);
  let activeFrames = 0;

  for (let offset = 0; offset < samples.length; offset += frameLength) {
    const frame = samples.subarray(offset, Math.min(offset + frameLength, samples.length));
    let peak = 0;
    for (const sample of frame) peak = Math.max(peak, Math.abs(sample));
    if (rootMeanSquare(frame) >= 0.01 && peak >= 0.02) {
      activeFrames += 1;
      if (activeFrames >= requiredActiveFrames) return true;
    }
  }

  return false;
}

export function joinSamples(parts: readonly Float32Array[], length?: number): Float32Array {
  const totalLength = length ?? parts.reduce((total, part) => total + part.length, 0);
  const joined = new Float32Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }

  return joined;
}

import { describe, expect, test } from 'bun:test';

import { AudioChunker } from '../../src/local/audio/chunker';
import { hasSpeechActivity, resampleLinear } from '../../src/local/audio/pcm';
import { encodePcm16, encodeWav, wavBlobFromPcm } from '../../src/local/audio/wav';

function constantSamples(length: number, value: number): Float32Array {
  return Float32Array.from({ length }, () => value);
}

describe('browser audio PCM pipeline', () => {
  test('writes a mono 16-bit 16 kHz WAV header and clamped samples', () => {
    // Given
    const samples = Float32Array.of(-2, 0, 2);

    // When
    const wav = encodeWav(samples, 16_000);
    const view = new DataView(wav);

    // Then
    expect(new TextDecoder().decode(new Uint8Array(wav, 0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(new Uint8Array(wav, 8, 4))).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32_767);
  });

  test('resamples 48 kHz PCM to the expected 16 kHz duration', () => {
    // Given
    const input = Float32Array.from({ length: 48_000 }, (_, index) =>
      Math.sin((2 * Math.PI * 440 * index) / 48_000),
    );

    // When
    const output = resampleLinear(input, 48_000, 16_000);

    // Then
    expect(output.length).toBe(16_000);
    expect(Math.abs(output[4_000])).toBeLessThan(0.001);
  });

  test('composes the full WAV from PCM Blob parts without joining Float32 recording data', async () => {
    // Given
    const first = new Blob([encodePcm16(Float32Array.of(-1, 0))]);
    const second = new Blob([encodePcm16(Float32Array.of(1))]);

    // When
    const recording = wavBlobFromPcm([first, second], 3, 16_000);
    const view = new DataView(await recording.arrayBuffer());

    // Then
    expect(recording.size).toBe(50);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(48, true)).toBe(32_767);
  });

  test('emits ordered voiced chunks while preserving silent timeline gaps', () => {
    // Given
    const emitted: Array<{ readonly sequence: number; readonly start: number; readonly duration: number }> = [];
    const chunker = new AudioChunker({
      sampleRate: 10,
      chunkSeconds: 4,
      silenceRms: 0.01,
      onChunk: (chunk) => emitted.push({ sequence: chunk.sequence, start: chunk.start, duration: chunk.duration }),
    });

    // When
    chunker.push(constantSamples(40, 0.25));
    chunker.push(constantSamples(40, 0));
    chunker.push(constantSamples(20, 0.5));
    chunker.flush();

    // Then
    expect(emitted).toEqual([
      { sequence: 0, start: 0, duration: 4 },
      { sequence: 1, start: 8, duration: 2 },
    ]);
  });

  test('flush emits a final partial voiced chunk exactly once', () => {
    // Given
    const emitted: number[] = [];
    const chunker = new AudioChunker({
      sampleRate: 10,
      chunkSeconds: 5,
      silenceRms: 0.01,
      onChunk: (chunk) => emitted.push(chunk.duration),
    });
    chunker.push(constantSamples(23, 0.2));

    // When
    chunker.flush();
    chunker.flush();

    // Then
    expect(emitted).toEqual([2.3]);
  });

  test('retains silent samples in the full recording callback', () => {
    // Given
    const recordingParts: Float32Array[] = [];
    const chunker = new AudioChunker({
      sampleRate: 10,
      chunkSeconds: 4,
      silenceRms: 0.01,
      onChunk: () => undefined,
      onSamples: (samples) => recordingParts.push(samples),
    });

    // When
    chunker.push(constantSamples(40, 0));
    chunker.push(constantSamples(15, 0.2));
    chunker.flush();

    // Then
    expect(recordingParts.reduce((length, part) => length + part.length, 0)).toBe(55);
  });

  test('rejects low noise and isolated clicks while retaining a quiet speech-like signal', () => {
    // Given
    const sampleRate = 16_000;
    const lowNoise = constantSamples(sampleRate * 2, 0.01);
    const isolatedClick = new Float32Array(sampleRate * 2);
    isolatedClick.fill(0.2, 0, 160);
    const quietSpeech = new Float32Array(sampleRate * 2);
    for (let index = 0; index < 1_920; index += 1) {
      quietSpeech[index] = 0.045 * Math.sin((2 * Math.PI * 220 * index) / sampleRate);
    }

    // When
    const noiseDetected = hasSpeechActivity(lowNoise, sampleRate);
    const clickDetected = hasSpeechActivity(isolatedClick, sampleRate);
    const speechDetected = hasSpeechActivity(quietSpeech, sampleRate);

    // Then
    expect(noiseDetected).toBe(false);
    expect(clickDetected).toBe(false);
    expect(speechDetected).toBe(true);
  });
});

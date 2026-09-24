import { describe, expect, test } from 'bun:test';

async function loadProcessor() {
  const messages = [];
  class TestAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage: (value) => messages.push(value),
      };
    }
  }

  let Processor;
  const source = await Bun.file(new URL('../../public/local-audio-worklet.js', import.meta.url)).text();
  const install = new Function('AudioWorkletProcessor', 'registerProcessor', source);
  install(TestAudioWorkletProcessor, (name, processor) => {
    expect(name).toBe('meetily-pcm-capture');
    Processor = processor;
  });
  return { processor: new Processor(), messages };
}

describe('audio worklet', () => {
  test('mixes stereo input to mono without monitoring output', async () => {
    // Given
    const { processor, messages } = await loadProcessor();

    // When
    const keepAlive = processor.process([[
      Float32Array.of(1, 0.5, -1),
      Float32Array.of(-1, 0.5, 1),
    ]]);

    // Then
    expect(keepAlive).toBe(true);
    expect(Array.from(new Float32Array(messages[0]))).toEqual([0, 0.5, 0]);
  });

  test('acknowledges flush after earlier PCM messages', async () => {
    // Given
    const { processor, messages } = await loadProcessor();
    processor.process([[Float32Array.of(0.25)]]);

    // When
    processor.port.onmessage({ data: { type: 'flush', requestId: 17 } });

    // Then
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ type: 'flush-ack', requestId: 17 });
  });
});

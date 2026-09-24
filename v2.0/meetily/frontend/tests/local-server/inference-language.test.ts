import { afterEach, describe, expect, it } from 'bun:test';

import { LocalInference } from '../../local-server/inference';

const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe('LocalInference language confidence', () => {
  it('abstains from low-probability Japanese without blacklisting the decoded phrase', async () => {
    // Given
    const whisper = serveWhisper({
      text: 'ご視聴ありがとうございました',
      language_probabilities: { en: 0.45, ja: 0.079 },
    });
    const inference = createInference(serverPort(whisper));

    // When
    const segments = await inference.transcribe(new Blob([new Uint8Array([1])]), {
      sequence: 0, start: 0, duration: 1.5, language: 'ja', interpret: false, minimumLanguageProbability: 0.5,
    });

    // Then
    expect(segments).toEqual([]);
  });

  it('preserves genuine Japanese above the configured probability', async () => {
    // Given
    const whisper = serveWhisper({
      text: 'ありがとうございます',
      language_probabilities: { ja: 0.997 },
    });
    const inference = createInference(serverPort(whisper));

    // When
    const segments = await inference.transcribe(new Blob([new Uint8Array([1])]), {
      sequence: 0, start: 0, duration: 1.5, language: 'ja', interpret: false, minimumLanguageProbability: 0.5,
    });

    // Then
    expect(segments[0]?.sourceText).toBe('ありがとうございます');
  });

  it('treats an omitted requested language in a populated probability map as below the cutoff', async () => {
    // Given
    const whisper = serveWhisper({
      text: 'ご視聴ありがとうございました',
      language_probabilities: { en: 0.9, ru: 0.05 },
    });
    const inference = createInference(serverPort(whisper));

    // When
    const segments = await inference.transcribe(new Blob([new Uint8Array([1])]), {
      sequence: 0, start: 0, duration: 1.5, language: 'ja', interpret: false, minimumLanguageProbability: 0.5,
    });

    // Then
    expect(segments).toEqual([]);
  });

  it('preserves legacy behavior for an empty probability map', async () => {
    // Given
    const whisper = serveWhisper({ text: '短い発言', language_probabilities: {} });
    const inference = createInference(serverPort(whisper));

    // When
    const segments = await inference.transcribe(new Blob([new Uint8Array([1])]), {
      sequence: 0, start: 0, duration: 1.5, language: 'ja', interpret: false, minimumLanguageProbability: 0.5,
    });

    // Then
    expect(segments[0]?.sourceText).toBe('短い発言');
  });
});

function serveWhisper(response: unknown): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({ port: 0, fetch: () => Response.json(response) });
  servers.push(server);
  return server;
}

function createInference(whisperPort: number): LocalInference {
  return new LocalInference({
    whisperUrl: `http://127.0.0.1:${whisperPort}`,
    whisperModel: 'test-whisper',
    ollamaUrl: 'http://127.0.0.1:9',
    ollamaModel: 'test-ollama',
    timeoutMs: 1000,
    queueLimit: 2,
  });
}

function serverPort(server: ReturnType<typeof Bun.serve>): number {
  if (server.port === undefined) throw new Error('Test server has no port');
  return server.port;
}

import { describe, expect, it } from 'bun:test';

import { authorizeRequest, readBoundedBody } from '../../local-server/security';

describe('authorizeRequest', () => {
  it('allows a same-origin write with the local client header', () => {
    // Given
    const request = new Request('http://127.0.0.1:3118/api/local/meetings', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3118',
        origin: 'http://127.0.0.1:3118',
        'x-meetily-client': 'browser',
      },
    });

    // When
    const result = authorizeRequest(request, 3118);

    // Then
    expect(result).toEqual({ allowedOrigin: 'http://127.0.0.1:3118' });
  });

  it('rejects a cross-origin write', () => {
    // Given
    const request = new Request('http://127.0.0.1:3118/api/local/meetings', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3118',
        origin: 'https://attacker.example',
        'x-meetily-client': 'browser',
      },
    });

    // When
    const result = authorizeRequest(request, 3118);

    // Then
    expect(result).toEqual({ reason: 'origin' });
  });

  it('rejects a write without the local client header', () => {
    // Given
    const request = new Request('http://127.0.0.1:3118/api/local/meetings', {
      method: 'POST',
      headers: { host: '127.0.0.1:3118', origin: 'http://127.0.0.1:3118' },
    });

    // When
    const result = authorizeRequest(request, 3118);

    // Then
    expect(result).toEqual({ reason: 'client-header' });
  });
});

describe('readBoundedBody', () => {
  it('rejects a body larger than the configured limit', async () => {
    // Given
    const request = new Request('http://127.0.0.1:3118/api/local/chunk', {
      method: 'POST',
      body: new Uint8Array(9),
    });

    // When
    const result = readBoundedBody(request, 8);

    // Then
    await expect(result).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});

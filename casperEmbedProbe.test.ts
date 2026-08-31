// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedBlockReason, probeFrameEmbeddable } from './casperEmbedProbe';

describe('embedBlockReason', () => {
  function headers(map: Record<string, string>) {
    return {
      get(name: string) {
        return map[name.toLowerCase()] ?? null;
      },
    };
  }

  it('blocks X-Frame-Options deny/sameorigin', () => {
    expect(embedBlockReason(headers({ 'x-frame-options': 'DENY' }))).toMatch(/X-Frame-Options/i);
    expect(embedBlockReason(headers({ 'x-frame-options': 'sameorigin' }))).toMatch(/X-Frame-Options/i);
  });

  it('blocks restrictive CSP frame-ancestors', () => {
    expect(
      embedBlockReason(headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" })),
    ).toBe('CSP frame-ancestors');
  });

  it('allows wildcard frame-ancestors and missing headers', () => {
    expect(embedBlockReason(headers({ 'content-security-policy': 'frame-ancestors *' }))).toBeNull();
    expect(embedBlockReason(headers({}))).toBeNull();
  });
});

describe('probeFrameEmbeddable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses private and metadata URLs without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const loopback = await probeFrameEmbeddable('https://127.0.0.1/secret');
    const metadata = await probeFrameEmbeddable('http://169.254.169.254/latest/meta-data');
    expect(loopback.embeddable).toBe(false);
    expect(metadata.embeddable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports X-Frame-Options from a public host', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        headers: {
          get(name: string) {
            return name.toLowerCase() === 'x-frame-options' ? 'DENY' : null;
          },
        },
      })),
    );
    const result = await probeFrameEmbeddable('https://1.1.1.1');
    expect(result.embeddable).toBe(false);
    expect(result.reason).toMatch(/X-Frame-Options/i);
    expect(result.probed).toBe(true);
  });
});

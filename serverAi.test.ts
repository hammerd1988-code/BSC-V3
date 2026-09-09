// @vitest-environment node
/**
 * `/api/ai/generate-text` bills the platform's provider key and passed the
 * request body's `maxTokens` straight to the provider. The 30-per-minute limiter
 * counts requests, not spend, so an unbounded value made each of those requests
 * arbitrarily expensive.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_REQUESTED_MAX_TOKENS,
  MAX_VISION_IMAGE_BYTES,
  clampRequestedMaxTokens,
  decodedBase64Bytes,
} from './serverAi';

describe('clampRequestedMaxTokens', () => {
  it('passes a reasonable request through unchanged', () => {
    expect(clampRequestedMaxTokens(1200)).toBe(1200);
  });

  it('caps an oversized request', () => {
    expect(clampRequestedMaxTokens(10_000_000)).toBe(MAX_REQUESTED_MAX_TOKENS);
  });

  it('falls back to the provider default for anything not a usable number', () => {
    expect(clampRequestedMaxTokens(undefined)).toBeUndefined();
    expect(clampRequestedMaxTokens('4096')).toBeUndefined();
    expect(clampRequestedMaxTokens(Number.NaN)).toBeUndefined();
    expect(clampRequestedMaxTokens(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(clampRequestedMaxTokens(0)).toBeUndefined();
    expect(clampRequestedMaxTokens(-100)).toBeUndefined();
  });

  it('floors a fractional request instead of forwarding it', () => {
    expect(clampRequestedMaxTokens(512.9)).toBe(512);
  });
});

/**
 * `/api/ai/vision` is the most expensive provider call in the app and bounded
 * neither its prompt nor its image. Sizing the image by `image.length` would
 * have been bypassable, so the check measures the decoded payload.
 */
describe('decodedBase64Bytes', () => {
  const bytes = (n: number) => Buffer.alloc(n, 7).toString('base64');

  it('reports the decoded size, not the encoded length', () => {
    for (const size of [1, 2, 3, 4, 5, 100, 1023, 4096]) {
      expect(decodedBase64Bytes(bytes(size))).toBe(size);
    }
  });

  it('ignores a data-URL prefix rather than counting it as image data', () => {
    const raw = bytes(3000);
    expect(decodedBase64Bytes(`data:image/jpeg;base64,${raw}`)).toBe(3000);
  });

  it('ignores embedded whitespace, which would otherwise inflate the count', () => {
    const raw = bytes(600);
    const padded = raw.replace(/(.{20})/g, '$1\n  ');
    expect(padded.length).toBeGreaterThan(raw.length);
    expect(decodedBase64Bytes(padded)).toBe(600);
  });

  it('treats an empty payload as zero bytes', () => {
    expect(decodedBase64Bytes('')).toBe(0);
    expect(decodedBase64Bytes('data:image/png;base64,')).toBe(0);
  });

  it('puts a full-size body over the vision ceiling', () => {
    // The route sits behind the 12mb JSON cap, so ~9MB of decoded image is
    // reachable without this check.
    const oversized = 'A'.repeat(Math.ceil((MAX_VISION_IMAGE_BYTES + 1024) * 4 / 3));
    expect(decodedBase64Bytes(oversized)).toBeGreaterThan(MAX_VISION_IMAGE_BYTES);
    expect(decodedBase64Bytes(bytes(MAX_VISION_IMAGE_BYTES))).toBe(MAX_VISION_IMAGE_BYTES);
  });
});

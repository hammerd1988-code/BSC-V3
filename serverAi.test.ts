// @vitest-environment node
/**
 * `/api/ai/generate-text` bills the platform's provider key and passed the
 * request body's `maxTokens` straight to the provider. The 30-per-minute limiter
 * counts requests, not spend, so an unbounded value made each of those requests
 * arbitrarily expensive.
 */
import { describe, expect, it } from 'vitest';
import { MAX_REQUESTED_MAX_TOKENS, clampRequestedMaxTokens } from './serverAi';

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

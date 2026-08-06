import { describe, expect, it } from 'vitest';
import { buildAuthReturnUrl, normalizeNextPath } from './authRedirect';

const ORIGIN = 'http://localhost:3000';

describe('normalizeNextPath', () => {
  it('keeps in-app routes, including their query string', () => {
    expect(normalizeNextPath('/marketplace', ORIGIN)).toBe('/marketplace');
    expect(normalizeNextPath('/search?q=abc', ORIGIN)).toBe('/search?q=abc');
  });

  it('falls back to the root for anything missing or unusable', () => {
    expect(normalizeNextPath(null, ORIGIN)).toBe('/');
    expect(normalizeNextPath(undefined, ORIGIN)).toBe('/');
    expect(normalizeNextPath('', ORIGIN)).toBe('/');
  });

  it('refuses to leave the origin', () => {
    expect(normalizeNextPath('https://evil.example/steal', ORIGIN)).toBe('/');
    expect(normalizeNextPath('javascript:alert(1)', ORIGIN)).toBe('/');
    expect(normalizeNextPath('//evil.example/steal', ORIGIN)).toBe('/');
    // Backslashes resolve to a host for http(s) URLs, so this is off-origin too.
    expect(normalizeNextPath('/\\evil.example/steal', ORIGIN)).toBe('/');
  });

  it('never sends the browser back to the callback route', () => {
    expect(normalizeNextPath('/auth/callback?next=/marketplace', ORIGIN)).toBe('/');
    // Resolved, not textual: the old textual check let this through and the app
    // bounced through sign-in again.
    expect(normalizeNextPath('/feed/../auth/callback', ORIGIN)).toBe('/');
    expect(normalizeNextPath('/Auth/Callback', ORIGIN)).toBe('/');
  });

  it('drops OAuth protocol params instead of replaying them in-app', () => {
    expect(normalizeNextPath('/feed?code=abc123', ORIGIN)).toBe('/');
    expect(normalizeNextPath('/feed?error=access_denied', ORIGIN)).toBe('/');
    expect(normalizeNextPath('/feed?state=xyz', ORIGIN)).toBe('/');
  });
});

describe('buildAuthReturnUrl', () => {
  it('returns to the app root and carries a safe destination', () => {
    expect(buildAuthReturnUrl(ORIGIN, '/marketplace')).toBe('http://localhost:3000/?next=%2Fmarketplace');
  });

  it('sanitises the destination it carries', () => {
    expect(buildAuthReturnUrl(ORIGIN, 'https://evil.example')).toBe('http://localhost:3000/?next=%2F');
    expect(buildAuthReturnUrl(ORIGIN, '/auth/callback')).toBe('http://localhost:3000/?next=%2F');
  });
});

import { describe, expect, it } from 'vitest';
import path from 'path';
import {
  DEFAULT_JSON_BODY_LIMIT,
  LARGE_JSON_BODY_LIMIT,
  cacheControlForAsset,
  jsonBodyLimitForPath,
  userRoom,
} from './serverHttp.js';

describe('jsonBodyLimitForPath', () => {
  it('keeps the large ceiling for base64 image and asset routes', () => {
    expect(jsonBodyLimitForPath('/api/ai/vision')).toBe(LARGE_JSON_BODY_LIMIT);
    expect(jsonBodyLimitForPath('/api/runway/generate')).toBe(LARGE_JSON_BODY_LIMIT);
    expect(jsonBodyLimitForPath('/api/runway/studio-assets')).toBe(LARGE_JSON_BODY_LIMIT);
    expect(jsonBodyLimitForPath('/api/casper/browser/action')).toBe(LARGE_JSON_BODY_LIMIT);
  });

  /**
   * `casperRelay.MAX_UPLOAD_BYTES` is 8MB of decoded bytes, which is ~10.7MB of
   * base64. A 1mb body cap rejects the request in body-parser, before the route
   * can apply its own limit, so every relay file push over ~750KB 413s.
   */
  it('keeps the large ceiling for Casper relay file pushes', () => {
    expect(jsonBodyLimitForPath('/api/casper/relay/file')).toBe(LARGE_JSON_BODY_LIMIT);
    expect(jsonBodyLimitForPath('/api/casper/relay/directive')).toBe(LARGE_JSON_BODY_LIMIT);
  });

  it('applies the small default everywhere else', () => {
    expect(jsonBodyLimitForPath('/api/ai/generate-text')).toBe(DEFAULT_JSON_BODY_LIMIT);
    expect(jsonBodyLimitForPath('/api/comments/bot-reply')).toBe(DEFAULT_JSON_BODY_LIMIT);
    expect(jsonBodyLimitForPath('/api/health')).toBe(DEFAULT_JSON_BODY_LIMIT);
  });

  it('does not let a prefix match a longer sibling segment', () => {
    expect(jsonBodyLimitForPath('/api/runwayx/generate')).toBe(DEFAULT_JSON_BODY_LIMIT);
    expect(jsonBodyLimitForPath('/api/ai/visionary')).toBe(DEFAULT_JSON_BODY_LIMIT);
  });
});

describe('cacheControlForAsset', () => {
  const dist = path.join('/srv', 'app', 'dist');
  const inDist = (...parts: string[]) => path.join(dist, ...parts);

  it('marks content-hashed bundles immutable', () => {
    expect(cacheControlForAsset(dist, inDist('assets', 'index-D8_TFi8V.js'))).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(cacheControlForAsset(dist, inDist('assets', 'Feed-UkFMR9fg.css'))).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('always revalidates the SPA shell and the service worker', () => {
    expect(cacheControlForAsset(dist, inDist('index.html'))).toBe('no-cache');
    expect(cacheControlForAsset(dist, inDist('sw.js'))).toBe('no-cache');
  });

  /**
   * Vite copies `public/` through verbatim, so these keep a stable URL across
   * deploys. `immutable` on them would pin a returning visitor to the copy that
   * was current on their first visit for a year, with no revalidation — a bad
   * icon, manifest, offline page or notification sound could not be fixed by
   * deploying.
   */
  it('leaves unhashed public files revalidatable', () => {
    for (const file of [
      ['manifest.json'],
      ['offline.html'],
      ['icons', 'icon-192x192.png'],
      ['sounds', 'bsc-notification.wav'],
      ['og-image.png'],
    ]) {
      const header = cacheControlForAsset(dist, inDist(...file));
      expect(header).toBe('public, max-age=3600, must-revalidate');
      expect(header).not.toContain('immutable');
    }
  });
});

describe('userRoom', () => {
  it('namespaces the room so it cannot collide with a socket id', () => {
    expect(userRoom('user-1')).toBe('user:user-1');
  });
});

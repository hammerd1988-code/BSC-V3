/**
 * HTTP-layer policy shared by the Express app.
 *
 * These live outside `server.ts` because that module calls `startServer()` at
 * import time — anything defined there is untestable without booting a real
 * listener.
 */
import path from 'path';

/**
 * Paths that legitimately carry large JSON (base64 images / file pushes).
 *
 * `/api/casper/relay` belongs here because the relay's own upload ceiling is 8MB
 * of decoded bytes (~10.7MB once base64-encoded, see `MAX_UPLOAD_BYTES` in
 * `casperRelay.ts`); capping its body at the default would make that limit and
 * the route's own 413 unreachable.
 */
export const LARGE_JSON_BODY_PREFIXES = [
  '/api/ai/vision',
  '/api/runway',
  '/api/casper/browser',
  '/api/casper/relay',
];

export const LARGE_JSON_BODY_LIMIT = '12mb';
export const DEFAULT_JSON_BODY_LIMIT = '1mb';

export function jsonBodyLimitForPath(pathname: string): string {
  const matches = LARGE_JSON_BODY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return matches ? LARGE_JSON_BODY_LIMIT : DEFAULT_JSON_BODY_LIMIT;
}

/**
 * Only Vite's `assets/` output carries a content hash in its filename, so only
 * those files may be marked `immutable`. Everything Vite copies verbatim out of
 * `public/` keeps a stable URL — `sw.js`, `manifest.json`, `offline.html`, the
 * PWA icons, the notification sound — and `immutable` on those would pin a
 * returning visitor to whichever copy was current on their first visit, with no
 * revalidation, for a year. Deploying a fix would not reach them.
 */
export function cacheControlForAsset(rootDir: string, filePath: string): string {
  const relative = path.relative(rootDir, filePath).split(path.sep).join('/');

  // The SPA shell and the service worker are the two files whose entire job is
  // to point at the current build, so they must always be revalidated.
  if (relative === 'index.html' || relative === 'sw.js') {
    return 'no-cache';
  }

  if (relative.startsWith('assets/')) {
    return 'public, max-age=31536000, immutable';
  }

  return 'public, max-age=3600, must-revalidate';
}

/** Socket.IO room carrying every live connection for one verified account. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

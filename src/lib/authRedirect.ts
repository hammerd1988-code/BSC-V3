/**
 * Where a sign-in is allowed to send the browser afterwards.
 *
 * `?next=` arrives from the URL, so it is attacker-controlled: it has to stay on
 * this origin, and it must not point back at the callback route or the app
 * bounces through sign-in forever.
 *
 * This lived inline in `Login.tsx` and was duplicated — in a weaker form — by
 * `scripts/verify-auth-flow.ts`, which meant the smoke test exercised its own
 * copy and could not notice a regression in the code that ships.
 */

const CALLBACK_PATH = '/auth/callback';

/** Params that belong to the OAuth exchange and must not be replayed in-app. */
const OAUTH_PARAMS = ['code', 'state', 'error', 'error_code', 'error_description'];

export function normalizeNextPath(value: string | null | undefined, origin: string): string {
  if (!value) return '/';
  // Anything that is not a rooted path could be an absolute URL or a
  // `javascript:` scheme, and `//host` is protocol-relative.
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';

  let parsed: URL;
  try {
    parsed = new URL(value, origin);
  } catch {
    return '/';
  }

  // `/\evil.example` and other backslash forms resolve to a different host, and
  // percent-encoded tricks resolve to a path — the origin check covers both.
  if (parsed.origin !== origin) return '/';

  // Compare the *resolved* path: `/foo/../auth/callback` normalizes to the
  // callback route and would otherwise loop straight back into sign-in.
  if (parsed.pathname.toLowerCase() === CALLBACK_PATH || parsed.pathname.toLowerCase().startsWith(`${CALLBACK_PATH}/`)) {
    return '/';
  }

  if (OAUTH_PARAMS.some((key) => parsed.searchParams.has(key))) return '/';

  const query = parsed.searchParams.toString();
  return `${parsed.pathname}${query ? `?${query}` : ''}`;
}

/**
 * The URL Supabase is told to return to. Always the app root, because
 * deployments without SPA rewrites cannot serve a deep callback path; the
 * intended destination rides along in `?next=`.
 */
export function buildAuthReturnUrl(origin: string, next: string | null | undefined): string {
  const url = new URL('/', origin);
  url.searchParams.set('next', normalizeNextPath(next, origin));
  return url.toString();
}

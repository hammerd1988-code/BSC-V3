/**
 * Validation helpers for user-supplied endpoint URLs (OpenAI-compatible base
 * URLs, local LM Studio / Ollama endpoints, and the WebSocket relay URL).
 *
 * Rules enforced by {@link validateBaseUrl}:
 *  - must parse as an absolute URL (`new URL`)
 *  - must be http/https (or ws/wss when `allowWebSocket` is set)
 *  - must NOT embed credentials (user:pass@host)
 *  - must be a secure scheme (https/wss) unless it points at a loopback host
 *    (localhost/127.0.0.1/::1) or `allowInsecureHttp` is set — where plaintext
 *    is expected for local model servers
 *  - must NOT carry a query string or fragment (callers append paths like
 *    `${base}/models`, which a `?query`/`#frag` would corrupt)
 *  - all trailing slashes are trimmed so callers can safely append `/models`
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(h)) return true;
  // 127.0.0.0/8 is all loopback.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * Validate and normalize an endpoint URL. Throws an Error with a user-facing
 * message when the URL is unusable; returns the normalized URL (no trailing
 * slash, no query/fragment) on success.
 */
export interface ValidateBaseUrlOptions {
  /**
   * Allow plaintext http:// (or ws://) for any host, not just loopback. Used
   * for local LLM endpoints (LM Studio / Ollama) which are commonly served
   * over http on a LAN address.
   */
  allowInsecureHttp?: boolean;
  /**
   * Also accept ws:// / wss:// schemes. Used for the relay URL, which is a
   * WebSocket endpoint (see getRelayHttpBase).
   */
  allowWebSocket?: boolean;
}

export function validateBaseUrl(raw: string, opts: ValidateBaseUrlOptions = {}): string {
  const input = raw.trim();
  if (!input) {
    throw new Error('URL is empty.');
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`"${input}" is not a valid URL (include the scheme, e.g. https://api.openai.com/v1).`);
  }

  const secure = new Set(['https:', ...(opts.allowWebSocket ? ['wss:'] : [])]);
  const insecure = new Set(['http:', ...(opts.allowWebSocket ? ['ws:'] : [])]);
  const allowed = new Set([...secure, ...insecure]);

  if (!allowed.has(parsed.protocol)) {
    const schemes = opts.allowWebSocket ? 'http://, https://, ws:// or wss://' : 'http:// or https://';
    throw new Error(`Unsupported URL scheme "${parsed.protocol}". Use ${schemes}.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('URL must not embed credentials (user:pass@host). Configure the API key separately.');
  }

  if (parsed.search || parsed.hash) {
    throw new Error('URL must not contain a query string or fragment.');
  }

  if (insecure.has(parsed.protocol) && !opts.allowInsecureHttp && !isLoopbackHost(parsed.hostname)) {
    const sec = opts.allowWebSocket ? 'https:// or wss://' : 'https://';
    throw new Error(
      `Refusing to use a plaintext scheme for non-local host "${parsed.hostname}". ` +
      `Use ${sec} (plaintext is only allowed for localhost / loopback).`,
    );
  }

  // Normalize: drop any trailing slash(es) so `${base}/models` works.
  return parsed.toString().replace(/\/+$/, '');
}

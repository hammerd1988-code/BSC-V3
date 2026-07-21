/**
 * Validation helpers for user-supplied LLM endpoint URLs (OpenAI-compatible
 * base URLs, local LM Studio / Ollama endpoints).
 *
 * Rules enforced by {@link validateBaseUrl}:
 *  - must parse as an absolute URL (`new URL`)
 *  - must be http/https
 *  - must NOT embed credentials (user:pass@host)
 *  - must be HTTPS unless it points at a loopback host (localhost/127.0.0.1/::1),
 *    where plaintext http is expected for local model servers
 *  - a trailing slash is trimmed so callers can safely append `/models` etc.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(h)) return true;
  // 127.0.0.0/8 is all loopback.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * Validate and normalize an LLM base URL. Throws an Error with a
 * user-facing message when the URL is unusable; returns the normalized
 * URL (no trailing slash) on success.
 */
export interface ValidateBaseUrlOptions {
  /**
   * Allow plaintext http:// for any host, not just loopback. Used for local
   * LLM endpoints (LM Studio / Ollama) which are commonly served over http on
   * a LAN address.
   */
  allowInsecureHttp?: boolean;
}

export function validateBaseUrl(raw: string, opts: ValidateBaseUrlOptions = {}): string {
  const input = raw.trim();
  if (!input) {
    throw new Error('Base URL is empty.');
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`"${input}" is not a valid URL (include the scheme, e.g. https://api.openai.com/v1).`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL scheme "${parsed.protocol}". Use http:// or https://.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('Base URL must not embed credentials (user:pass@host). Configure the API key separately.');
  }

  if (parsed.protocol === 'http:' && !opts.allowInsecureHttp && !isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `Refusing to use plaintext http:// for non-local host "${parsed.hostname}". ` +
      'Use https:// (http is only allowed for localhost / loopback).',
    );
  }

  // Normalize: drop a lone trailing slash on the path so `${base}/models` works.
  return parsed.toString().replace(/\/$/, '');
}

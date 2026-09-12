import { describe, it, expect } from 'vitest';
import { browserNavigate } from './casperBrowser.js';

/**
 * `browserNavigate` validates the target before it ever asks for a page, so
 * these cases are reachable without Playwright installed.
 *
 * Each of them was accepted by the hand-rolled guard this replaced:
 *  - `[::ffff:127.0.0.1]` — `new URL()` rewrites it to the hex form
 *    `[::ffff:7f00:1]`, which matched neither the hostname blocklist nor the
 *    private-range test, and `dns.resolve` on an IP literal fails, which the
 *    old code treated as "let Playwright try it".
 *  - Any name `dns.resolve` cannot answer for. It asks for A records only and
 *    never consults `/etc/hosts`, so AAAA-only and hosts-file names failed the
 *    lookup and then resolved perfectly well inside Chromium.
 */
const supabaseStub = {} as never;

describe('browserNavigate SSRF guard', () => {
  it.each([
    ['loopback by name', 'http://localhost:8080/'],
    ['loopback by address', 'http://127.0.0.1/'],
    ['loopback as a decimal literal', 'http://2130706433/'],
    ['loopback as an IPv4-mapped IPv6 literal', 'http://[::ffff:127.0.0.1]/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['cloud instance metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['private RFC1918 range', 'http://10.0.0.5/admin'],
    ['a .internal name', 'https://vault.internal/secret'],
  ])('refuses %s', async (_label, url) => {
    const result = await browserNavigate(url, supabaseStub, 'user-1', { screenshot: false });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private address|local name|does not resolve/i);
  });

  it('refuses a non-http scheme', async () => {
    const result = await browserNavigate('file:///etc/passwd', supabaseStub, 'user-1', { screenshot: false });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unsupported/i);
  });

  it('refuses a hostname that does not resolve rather than letting the browser try it', async () => {
    // `.invalid` is reserved as permanently unresolvable (RFC 6761), so this is
    // deterministic offline. The guard fails closed either by reporting an empty
    // result set or by surfacing the resolver's own error; the old code swallowed
    // both and navigated anyway.
    const result = await browserNavigate(
      'https://not-a-real-host.invalid/',
      supabaseStub,
      'user-1',
      { screenshot: false },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not resolve|ENOTFOUND|EAI_AGAIN/i);
  });
});

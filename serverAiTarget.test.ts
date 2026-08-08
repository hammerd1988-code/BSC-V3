import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOpenAiTarget } from './serverAi.js';

/**
 * The rule these cover: a caller-supplied endpoint may only ever receive a
 * caller-supplied credential.
 *
 * `apiKeyOverride || OPENAI_API_KEY()` broke it. A user sets
 * `ai_settings.endpoint` to a host they control and leaves their own key unset,
 * and the server posts the *platform's* provider key there as a bearer token.
 * Moving the per-user key to `user_ai_credentials` made that more reachable, not
 * less, because `apiKeyOverride` now arrives empty for more users.
 */
describe('resolveOpenAiTarget', () => {
  const saved = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    VITE_AI_API_KEY: process.env.VITE_AI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    VITE_AI_BASE_URL: process.env.VITE_AI_BASE_URL,
  };

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'platform-key';
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.VITE_AI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.VITE_AI_BASE_URL;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('never sends the platform key to a caller-supplied endpoint', async () => {
    const target = await resolveOpenAiTarget('', 'https://attacker.example/v1');
    expect(target.key).toBe('');
    expect(target.key).not.toBe('platform-key');
    expect(target.reason).toMatch(/never sent to a user-supplied endpoint/i);
  });

  // A public literal address, so this stays hermetic — outboundUrl.test.ts uses
  // the same trick to exercise the allow path without a DNS lookup.
  it('pairs a caller endpoint with the caller credential, and trims the path', async () => {
    const target = await resolveOpenAiTarget('user-key', 'https://203.0.113.10/v1/');
    expect(target.key).toBe('user-key');
    expect(target.baseUrl).toBe('https://203.0.113.10/v1');
    expect(target.reason).toBe('');
  });

  /**
   * `isLocalEndpoint()` in casperControlCenter recognises loopback and the
   * RFC1918 ranges but not 169.254.0.0/16, so cloud metadata was reachable
   * through this path. `assertPublicHttpUrl` is the guard that knows.
   */
  it('rejects link-local, loopback and private endpoints even with a caller key', async () => {
    for (const endpoint of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:1234/v1',
      'http://10.0.0.5/v1',
      'http://192.168.1.10/v1',
      'http://[::1]/v1',
    ]) {
      const target = await resolveOpenAiTarget('user-key', endpoint);
      expect(target.key, `${endpoint} should be refused`).toBe('');
      expect(target.reason).toMatch(/openai:/);
    }
  });

  it('rejects a non-http scheme', async () => {
    const target = await resolveOpenAiTarget('user-key', 'file:///etc/passwd');
    expect(target.key).toBe('');
  });

  it('uses the platform key and base URL when the caller supplies no endpoint', async () => {
    const target = await resolveOpenAiTarget('', '');
    expect(target.key).toBe('platform-key');
    expect(target.reason).toBe('');
  });

  it('reports a missing platform key rather than returning an empty credential silently', async () => {
    delete process.env.OPENAI_API_KEY;
    const target = await resolveOpenAiTarget('', '');
    expect(target.key).toBe('');
    expect(target.reason).toMatch(/not set/);
  });
});

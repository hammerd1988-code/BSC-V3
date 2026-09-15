import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateServerText, generateServerToolTurn, openAiModel, resolveOpenAiTarget } from './serverAi.js';

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
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'platform-key';
    process.env.GEMINI_API_KEY = 'gemini-key';
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.VITE_AI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.VITE_AI_BASE_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
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

  it('falls back to Gemini after an OpenAI-compatible failure when Gemini is available', async () => {
    global.fetch = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://api.openai.com/v1/chat/completions')) {
        return new Response('upstream failure', { status: 502 });
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'gemini fallback' }] } }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const result = await generateServerText('say hi', { preferredModel: 'gpt-4.1-mini' });
    expect(result.provider).toBe('gemini');
    expect(result.text).toBe('gemini fallback');
  });
});

describe('generateServerToolTurn', () => {
  const saved = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  const originalFetch = global.fetch;
  let requestBodies: any[] = [];

  const openRouterReply = (message: Record<string, unknown>, finishReason: string) =>
    async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://openrouter.ai/api/v1/chat/completions');
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message, finish_reason: finishReason }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

  beforeEach(() => {
    requestBodies = [];
    process.env.OPENROUTER_API_KEY = 'or-key';
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('sends the OpenRouter reasoning object for Qwen3 when an effort is requested', async () => {
    global.fetch = openRouterReply({ content: 'done' }, 'stop');
    const turn = await generateServerToolTurn([{ role: 'user', content: 'hi' }], {
      preferredModel: 'qwen/qwen3.8-27b',
      reasoningEffort: 'low',
      maxTokens: 1200,
    });
    expect(turn.text).toBe('done');
    expect(requestBodies[0]).toMatchObject({ model: 'qwen/qwen3.8-27b', max_tokens: 1200, reasoning: { effort: 'low' } });
  });

  it('names the exhausted budget when reasoning consumes max_tokens and no text comes back', async () => {
    global.fetch = openRouterReply({ content: '', reasoning: 'thinking…' }, 'length');
    const turn = await generateServerToolTurn([{ role: 'user', content: 'hi' }], {
      preferredModel: 'qwen/qwen3.8-27b',
      maxTokens: 1200,
    });
    expect(turn.text).toBe('');
    expect(turn.toolCalls).toEqual([]);
    expect(turn.lastError).toContain('exhausted the 1200-token completion budget');
    expect(turn.emptyCompletion).toBe(true);
  });

  it('does not flag provider failures as empty completions', async () => {
    global.fetch = async () => new Response('{"error":{"message":"bad key"}}', { status: 401 });
    const turn = await generateServerToolTurn([{ role: 'user', content: 'hi' }], { preferredModel: 'qwen/qwen3.8-27b' });
    expect(turn.text).toBe('');
    expect(turn.emptyCompletion).toBeUndefined();
    expect(turn.lastError).toContain('401');
  });

  it('reports reasoning-only replies distinctly from a plain empty reply', async () => {
    global.fetch = openRouterReply({ content: null, reasoning_content: 'I should answer…' }, 'stop');
    const turn = await generateServerToolTurn([{ role: 'user', content: 'hi' }], { preferredModel: 'qwen/qwen3.8-27b' });
    expect(turn.lastError).toContain('returned reasoning but no visible answer (finish_reason=stop)');
  });

  it('still returns tool calls when content is empty', async () => {
    global.fetch = openRouterReply({
      content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'shell', arguments: '{"cmd":"ls"}' } }],
    }, 'tool_calls');
    const turn = await generateServerToolTurn([{ role: 'user', content: 'hi' }], {
      preferredModel: 'qwen/qwen3.8-27b',
      tools: [{ type: 'function', function: { name: 'shell', description: 'run', parameters: {} } }],
    });
    expect(turn.lastError).toBeUndefined();
    expect(turn.toolCalls).toEqual([{ id: 'call_1', name: 'shell', arguments: '{"cmd":"ls"}' }]);
  });
});

describe('openAiModel', () => {
  const saved = { CASPER_MODEL: process.env.CASPER_MODEL, OPENAI_MODEL: process.env.OPENAI_MODEL, VITE_AI_MODEL: process.env.VITE_AI_MODEL };

  beforeEach(() => {
    process.env.CASPER_MODEL = 'openai/gpt-5.4-mini';
    delete process.env.OPENAI_MODEL;
    delete process.env.VITE_AI_MODEL;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('uses the platform default for empty / platform_default', () => {
    expect(openAiModel(undefined, 'https://openrouter.ai/api/v1')).toBe('openai/gpt-5.4-mini');
    expect(openAiModel('platform_default', 'https://api.openai.com/v1')).toBe('openai/gpt-5.4-mini');
  });

  it('serves an explicit gemini-* choice via OpenRouter under the google/ prefix', () => {
    expect(openAiModel('gemini-2.5-pro', 'https://openrouter.ai/api/v1')).toBe('google/gemini-2.5-pro');
  });

  it('falls back to the platform default for gemini-* on a direct OpenAI endpoint', () => {
    expect(openAiModel('gemini-2.5-pro', 'https://api.openai.com/v1')).toBe('openai/gpt-5.4-mini');
  });

  it('passes any other model id through', () => {
    expect(openAiModel('gpt-5.4', 'https://api.openai.com/v1')).toBe('gpt-5.4');
  });
});

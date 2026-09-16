// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summarizeAiSettingsForCli } from './casperAiSettingsSync';

const platform = { baseUrl: 'https://openrouter.ai/api/v1/', model: 'openai/gpt-5.4-mini' };

describe('summarizeAiSettingsForCli', () => {
  it('returns the user model and endpoint when both are set', () => {
    const out = summarizeAiSettingsForCli(
      { model: 'qwen/qwen3.8-27b', endpoint: 'https://openrouter.ai/api/v1/', apiKey: 'sk-or-user' },
      platform,
    );
    expect(out).toEqual({
      model: 'qwen/qwen3.8-27b',
      endpoint: 'https://openrouter.ai/api/v1',
      modelSource: 'user',
      endpointSource: 'user',
      hasApiKey: true,
    });
  });

  it('falls back to the platform model/endpoint, flagged as such', () => {
    const out = summarizeAiSettingsForCli({ model: 'platform_default', endpoint: null, apiKey: null }, platform);
    expect(out.model).toBe('openai/gpt-5.4-mini');
    expect(out.endpoint).toBe('https://openrouter.ai/api/v1');
    expect(out.modelSource).toBe('platform');
    expect(out.endpointSource).toBe('platform');
    expect(out.hasApiKey).toBe(false);
  });

  it('treats an empty settings object like platform defaults', () => {
    const out = summarizeAiSettingsForCli({}, platform);
    expect(out.modelSource).toBe('platform');
    expect(out.endpointSource).toBe('platform');
  });

  it('never includes the key itself, only whether one is stored', () => {
    const out = summarizeAiSettingsForCli(
      { model: 'qwen/qwen3.8-27b', endpoint: 'https://openrouter.ai/api/v1', apiKey: '  sk-or-user  ' },
      platform,
    );
    expect(out.hasApiKey).toBe(true);
    expect(JSON.stringify(out)).not.toContain('sk-or-user');
  });

  it('reports a blank key as no key', () => {
    const out = summarizeAiSettingsForCli({ model: 'x', endpoint: null, apiKey: '   ' }, platform);
    expect(out.hasApiKey).toBe(false);
  });
});

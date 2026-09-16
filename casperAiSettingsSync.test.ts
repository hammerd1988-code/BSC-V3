// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summarizeAiSettingsForCli } from './casperAiSettingsSync';

const platform = { baseUrl: 'https://openrouter.ai/api/v1/', model: 'openai/gpt-5.4-mini' };

describe('summarizeAiSettingsForCli', () => {
  it('returns the user model and endpoint when both are set', () => {
    const out = summarizeAiSettingsForCli(
      { model: 'qwen/qwen3.8-27b', endpoint: 'https://openrouter.ai/api/v1/', apiKey: 'sk-or-user', temperature: 0.4 },
      platform,
    );
    expect(out).toEqual({
      model: 'qwen/qwen3.8-27b',
      endpoint: 'https://openrouter.ai/api/v1',
      modelSource: 'user',
      endpointSource: 'user',
      hasApiKey: true,
      temperature: 0.4,
    });
  });

  it('falls back to the platform model/endpoint, flagged as such', () => {
    const out = summarizeAiSettingsForCli({ model: 'platform_default', endpoint: null, apiKey: null }, platform);
    expect(out.model).toBe('openai/gpt-5.4-mini');
    expect(out.endpoint).toBe('https://openrouter.ai/api/v1');
    expect(out.modelSource).toBe('platform');
    expect(out.endpointSource).toBe('platform');
    expect(out.hasApiKey).toBe(false);
    expect(out.temperature).toBeNull();
  });

  it('treats an empty settings object like platform defaults', () => {
    const out = summarizeAiSettingsForCli({}, platform);
    expect(out.modelSource).toBe('platform');
    expect(out.endpointSource).toBe('platform');
  });

  it('omits the API key unless explicitly requested', () => {
    const settings = { model: 'qwen/qwen3.8-27b', endpoint: 'https://openrouter.ai/api/v1', apiKey: '  sk-or-user  ' };
    expect(summarizeAiSettingsForCli(settings, platform)).not.toHaveProperty('apiKey');
    expect(summarizeAiSettingsForCli(settings, platform, { includeKey: false })).not.toHaveProperty('apiKey');
    expect(summarizeAiSettingsForCli(settings, platform, { includeKey: true }).apiKey).toBe('sk-or-user');
  });

  it('never returns a key when the user has none, even if requested', () => {
    const out = summarizeAiSettingsForCli({ model: 'x', endpoint: null, apiKey: '   ' }, platform, { includeKey: true });
    expect(out).not.toHaveProperty('apiKey');
    expect(out.hasApiKey).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { maxTokensParam, reasoningParam, temperatureParam, usesMaxCompletionTokens } from './modelParams';

describe('usesMaxCompletionTokens', () => {
  it('flags the gpt-5 family and the o-series', () => {
    expect(usesMaxCompletionTokens('gpt-5.4-mini')).toBe(true);
    expect(usesMaxCompletionTokens('gpt-5')).toBe(true);
    expect(usesMaxCompletionTokens('o3-mini')).toBe(true);
  });

  it('leaves older and non-OpenAI models on max_tokens', () => {
    expect(usesMaxCompletionTokens('gpt-4.1-mini')).toBe(false);
    expect(usesMaxCompletionTokens('gemini-3.6-flash')).toBe(false);
    expect(usesMaxCompletionTokens('accounts/fireworks/models/qwen3p6-plus')).toBe(false);
  });

  it('keeps max_tokens for OpenRouter, which normalises the parameter itself', () => {
    expect(usesMaxCompletionTokens('openai/gpt-5.4-mini', 'https://openrouter.ai/api/v1')).toBe(false);
    expect(usesMaxCompletionTokens('openai/gpt-5.4-mini', 'https://api.openai.com/v1')).toBe(true);
  });
});

describe('maxTokensParam', () => {
  it('emits the parameter the model accepts', () => {
    expect(maxTokensParam('gpt-5.4-mini', 900)).toEqual({ max_completion_tokens: 900 });
    expect(maxTokensParam('gpt-4.1-mini', 900)).toEqual({ max_tokens: 900 });
  });

  it('emits nothing when no limit is requested', () => {
    expect(maxTokensParam('gpt-5.4-mini', undefined)).toEqual({});
  });
});

describe('temperatureParam', () => {
  it('drops temperature for reasoning models that only accept the default', () => {
    expect(temperatureParam('gpt-5.4-mini', 0.92)).toEqual({});
    expect(temperatureParam('openai/gpt-5.4-mini', 0.92)).toEqual({});
    expect(temperatureParam('o3-mini', 0.5)).toEqual({});
  });

  it('keeps temperature for everything else', () => {
    expect(temperatureParam('gpt-4.1-mini', 0.92)).toEqual({ temperature: 0.92 });
    expect(temperatureParam('google/gemini-3.6-flash', 0.7)).toEqual({ temperature: 0.7 });
    expect(temperatureParam('gpt-4.1-mini', undefined)).toEqual({});
  });
});

describe('reasoningParam', () => {
  const openRouter = 'https://openrouter.ai/api/v1';

  it('emits nothing when no effort is requested', () => {
    expect(reasoningParam('openai/gpt-5.4-mini', undefined, openRouter)).toEqual({});
  });

  it('uses the unified reasoning object on OpenRouter for thinking models', () => {
    expect(reasoningParam('openai/gpt-5.4-mini', 'low', openRouter)).toEqual({ reasoning: { effort: 'low' } });
    expect(reasoningParam('google/gemini-3.6-flash', 'low', openRouter)).toEqual({ reasoning: { effort: 'low' } });
    expect(reasoningParam('openai/gpt-4.1-mini', 'low', openRouter)).toEqual({});
  });

  it('uses reasoning_effort on OpenAI direct for the gpt-5 family and o-series only', () => {
    expect(reasoningParam('gpt-5.4-mini', 'low', 'https://api.openai.com/v1')).toEqual({ reasoning_effort: 'low' });
    expect(reasoningParam('o3-mini', 'minimal')).toEqual({ reasoning_effort: 'minimal' });
    expect(reasoningParam('gpt-4.1-mini', 'low', 'https://api.openai.com/v1')).toEqual({});
  });

  it('sends nothing to other OpenAI-compatible servers that may reject unknown fields', () => {
    expect(reasoningParam('gpt-5.4-mini', 'low', 'https://api.together.xyz/v1')).toEqual({});
    expect(reasoningParam('qwen3', 'low', 'http://localhost:1234/v1')).toEqual({});
  });
});

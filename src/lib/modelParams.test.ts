import { describe, expect, it } from 'vitest';
import { maxTokensParam, usesMaxCompletionTokens } from './modelParams';

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

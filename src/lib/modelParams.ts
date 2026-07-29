// GPT-5.x and the o-series reject `max_tokens` on /chat/completions with
// "Unsupported parameter: 'max_tokens' is not supported with this model. Use
// 'max_completion_tokens' instead." Every other model — and OpenRouter, which
// normalises the parameter itself — expects `max_tokens`.
const MAX_COMPLETION_TOKENS_MODELS = /(?:^|\/)(?:gpt-5|o[1-4])(?:$|[-.])/i;

export function usesMaxCompletionTokens(model: string, baseUrl?: string): boolean {
  if (baseUrl && baseUrl.includes('openrouter.ai')) return false;
  return MAX_COMPLETION_TOKENS_MODELS.test(model.trim());
}

export function maxTokensParam(
  model: string,
  maxTokens: number | undefined,
  baseUrl?: string,
): Record<string, number> {
  if (maxTokens === undefined) return {};
  return usesMaxCompletionTokens(model, baseUrl)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}

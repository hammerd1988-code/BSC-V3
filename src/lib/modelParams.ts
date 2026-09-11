// GPT-5.x and the o-series reject `max_tokens` on /chat/completions with
// "Unsupported parameter: 'max_tokens' is not supported with this model. Use
// 'max_completion_tokens' instead." Every other model — and OpenRouter, which
// normalises the parameter itself — expects `max_tokens`.
const MAX_COMPLETION_TOKENS_MODELS = /(?:^|\/)(?:gpt-5|o[1-4])(?:$|[-.])/i;

function hostFor(baseUrl?: string): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isOpenRouterUrl(baseUrl?: string): boolean {
  return hostFor(baseUrl) === 'openrouter.ai';
}

function isOpenAiDirectUrl(baseUrl?: string): boolean {
  if (!baseUrl) return true;
  return hostFor(baseUrl) === 'api.openai.com';
}

export function usesMaxCompletionTokens(model: string, baseUrl?: string): boolean {
  if (isOpenRouterUrl(baseUrl)) return false;
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

// The same GPT-5/o-series models reject any `temperature` other than the
// default ("Unsupported value: 'temperature' does not support 0.92 with this
// model"), whether called directly or through OpenRouter, which forwards the
// field. Omitting it lets the provider use its default.
export function temperatureParam(model: string, temperature: number | undefined): Record<string, number> {
  if (temperature === undefined) return {};
  return MAX_COMPLETION_TOKENS_MODELS.test(model.trim()) ? {} : { temperature };
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

// Reasoning models spend hidden thinking tokens out of the same completion
// budget as the visible answer, so a small `max_tokens` on a "write one
// sentence" prompt can come back truncated or empty. Callers that only want a
// short reply ask for low effort. OpenRouter takes a unified `reasoning`
// object; OpenAI's own endpoint takes `reasoning_effort` on the GPT-5/o-series
// only. Other OpenAI-compatible servers may reject unknown fields, so nothing
// is sent to them.
const OPENROUTER_REASONING_MODELS = /(?:^|\/)(?:gpt-5|o[1-4]|gemini-(?:2\.5|3))(?:$|[-.])/i;

export function reasoningParam(
  model: string,
  effort: ReasoningEffort | undefined,
  baseUrl?: string,
): Record<string, unknown> {
  if (!effort) return {};
  const trimmed = model.trim();
  if (isOpenRouterUrl(baseUrl)) {
    return OPENROUTER_REASONING_MODELS.test(trimmed) ? { reasoning: { effort } } : {};
  }
  const isOpenAiDirect = isOpenAiDirectUrl(baseUrl);
  if (isOpenAiDirect && MAX_COMPLETION_TOKENS_MODELS.test(trimmed)) {
    return { reasoning_effort: effort };
  }
  return {};
}

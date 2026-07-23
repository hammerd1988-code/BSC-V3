import OpenAI from 'openai';
import { getConfig } from '../config.js';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

export type ToolSpec = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export interface LlmClientOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  /** Override the configured local-LLM preference. */
  preferLocal?: boolean;
  /** Override the configured local-LLM base URL. */
  localLlmUrl?: string;
}

export interface SavedCloudConfig {
  openaiApiKey?: string;
  openrouterApiKey?: string;
  baseUrl?: string;
}

export interface ResolvedCloudConfig {
  provider: 'openai-compatible' | 'openrouter';
  apiKey: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
}

export function isOpenRouterUrl(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai');
  } catch {
    return false;
  }
}

/**
 * Resolve cloud credentials without making a network request.
 *
 * OPENROUTER_API_KEY is a first-class option: when present without an explicit
 * base URL it selects OpenRouter automatically. Explicit options and
 * OPENAI_BASE_URL still win, so custom OpenAI-compatible providers keep
 * working exactly as before.
 */
export function resolveCloudConfig(
  opts: LlmClientOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  saved: SavedCloudConfig = {
    openaiApiKey: getConfig('openaiApiKey'),
    openrouterApiKey: getConfig('openrouterApiKey'),
    baseUrl: getConfig('baseUrl'),
  },
): ResolvedCloudConfig {
  const explicitBaseURL = opts.baseUrl || env.OPENAI_BASE_URL;
  // An environment OpenRouter key represents a per-process provider choice
  // and therefore overrides a stale base URL in the persisted config.
  let baseURL = explicitBaseURL
    || (env.OPENROUTER_API_KEY ? OPENROUTER_BASE_URL : saved.baseUrl);
  const useOpenRouter = isOpenRouterUrl(baseURL)
    || (!baseURL && Boolean(env.OPENROUTER_API_KEY || saved.openrouterApiKey));

  if (useOpenRouter && !baseURL) {
    baseURL = OPENROUTER_BASE_URL;
  }

  const apiKey = opts.apiKey
    || (useOpenRouter
      ? env.OPENROUTER_API_KEY || saved.openrouterApiKey || env.OPENAI_API_KEY || saved.openaiApiKey
      : env.OPENAI_API_KEY || saved.openaiApiKey);

  if (!apiKey) {
    throw new Error(
      'No LLM API key configured. Run:\n' +
      '  casper setup\n' +
      'Or set OPENAI_API_KEY / OPENROUTER_API_KEY.'
    );
  }

  const defaultHeaders = useOpenRouter
    ? {
        'HTTP-Referer': env.OPENROUTER_HTTP_REFERER || 'https://bloodsweatcode.org',
        'X-OpenRouter-Title': env.OPENROUTER_APP_TITLE || 'Casper CLI',
      }
    : undefined;

  return {
    provider: useOpenRouter ? 'openrouter' : 'openai-compatible',
    apiKey,
    baseURL,
    defaultHeaders,
  };
}

/**
 * Create an OpenAI-compatible client. Works with:
 * - OpenAI API (default)
 * - OpenRouter
 * - LM Studio (localhost:1234/v1)
 * - Ollama (localhost:11434/v1)
 */
export function createLlmClient(opts?: LlmClientOptions): OpenAI {
  const preferLocal = opts?.preferLocal ?? getConfig('preferLocalLlm');
  const localUrl = opts?.localLlmUrl ?? getConfig('localLlmUrl');

  if (preferLocal && localUrl) {
    return new OpenAI({
      apiKey: 'not-needed',
      baseURL: localUrl,
    });
  }

  const { apiKey, baseURL, defaultHeaders } = resolveCloudConfig(opts);
  return new OpenAI({ apiKey, baseURL, defaultHeaders });
}

/**
 * Send a chat completion request with tool definitions.
 */
export async function chatCompletion(
  client: OpenAI,
  messages: ChatMessage[],
  tools: ToolSpec[],
  model?: string,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const modelName = model || getConfig('model');
  return client.chat.completions.create({
    model: modelName,
    messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools: tools.length > 0
      ? tools as OpenAI.Chat.Completions.ChatCompletionTool[]
      : undefined,
    temperature: 0.7,
    max_tokens: 4096,
  });
}

/**
 * Send a streaming chat completion request. Returns an async iterable of
 * chunks that the caller can consume token-by-token while also accumulating
 * tool_calls.
 */
export async function chatCompletionStream(
  client: OpenAI,
  messages: ChatMessage[],
  tools: ToolSpec[],
  model?: string,
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const modelName = model || getConfig('model');
  return client.chat.completions.create({
    model: modelName,
    messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools: tools.length > 0
      ? tools as OpenAI.Chat.Completions.ChatCompletionTool[]
      : undefined,
    temperature: 0.7,
    max_tokens: 4096,
    stream: true,
  });
}

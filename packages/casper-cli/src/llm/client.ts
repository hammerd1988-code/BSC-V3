import OpenAI from 'openai';
import { getConfig } from '../config.js';

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

/**
 * Create an OpenAI-compatible client. Works with:
 * - OpenAI API (default)
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

  const apiKey = opts?.apiKey || getConfig('openaiApiKey') || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'No LLM API key configured. Run:\n' +
      '  casper setup\n' +
      'Or set OPENAI_API_KEY env var.'
    );
  }

  const baseURL = opts?.baseUrl || getConfig('baseUrl') || process.env.OPENAI_BASE_URL;

  return new OpenAI({
    apiKey,
    baseURL,
  });
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

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
}

/**
 * Create an OpenAI-compatible client. Works with:
 * - OpenAI API (default)
 * - LM Studio (localhost:1234/v1)
 * - Ollama (localhost:11434/v1)
 */
export function createLlmClient(opts?: LlmClientOptions): OpenAI {
  const preferLocal = getConfig('preferLocalLlm');
  const localUrl = getConfig('localLlmUrl');

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
      '  casper config set openaiApiKey <your-key>\n' +
      'Or set OPENAI_API_KEY env var.'
    );
  }

  return new OpenAI({
    apiKey,
    baseURL: opts?.baseUrl,
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

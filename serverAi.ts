import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

const GEMINI_API_KEY = () => process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.0-flash';

let geminiCooldownUntil = 0;

const OPENAI_API_KEY = () =>
  process.env.OPENAI_API_KEY || process.env.VITE_AI_API_KEY || '';
const OPENAI_BASE_URL = () =>
  (process.env.OPENAI_BASE_URL || process.env.VITE_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = () =>
  process.env.CASPER_MODEL || process.env.OPENAI_MODEL || process.env.VITE_AI_MODEL || 'gpt-4o-mini';

export interface ServerAIOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  preferredModel?: string | null;
  jsonResponse?: boolean;
  /**
   * Optional per-user OpenAI-compatible API key override. When provided,
   * Gemini is skipped entirely (caller has explicitly chosen an
   * OpenAI-compatible provider) and this key is used instead of the
   * server's env-var key. Used by Casper's per-user model selection so
   * users can route their own directives through OpenRouter / Together /
   * Groq / Anthropic-via-OAI-compat / etc. without affecting other users.
   */
  apiKeyOverride?: string | null;
  /**
   * Optional per-user OpenAI-compatible base URL override. When provided,
   * the request goes to this URL (e.g. https://openrouter.ai/api/v1)
   * instead of the server's default. Empty / undefined falls back to the
   * server's OPENAI_BASE_URL env var.
   */
  baseUrlOverride?: string | null;
}

export interface ServerAIResult {
  provider: 'gemini' | 'openai-compatible';
  model: string;
  text: string;
  /**
   * Diagnostic field populated when the call could not produce text
   * (e.g. provider returned empty, was rate-limited, or threw an error).
   * Callers should fall back to alternative content when this is set.
   */
  lastError?: string;
}

// Multi-turn chat message shape for tool-calling. We deliberately keep
// this aligned with OpenAI's Chat Completions API so it round-trips
// directly through callOpenAICompatibleWithTools. Only the OpenAI-
// compatible provider supports tool calls — Gemini falls back to a
// text-only response (no tool_calls) and the caller's loop terminates.
export type ServerAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

// OpenAI-style tool spec. Mirrors casperTools.LlmToolSpec.
// We don't import from casperTools to avoid a circular dep.
export type ServerAIToolSpec = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
};

export interface ServerAIToolOptions extends ServerAIOptions {
  /**
   * Tool specs advertised to the model. Empty/undefined means a normal
   * single-shot completion (identical to generateServerText). Required
   * non-empty for tool-calling to engage.
   */
  tools?: ServerAIToolSpec[];
  /**
   * Optional `tool_choice` override. Defaults to `'auto'` which lets the
   * model decide whether to call a tool or return text.
   */
  toolChoice?: 'auto' | 'none' | 'required';
}

export interface ServerAIToolCall {
  id: string;
  name: string;
  arguments: string; // raw JSON string; caller parses
}

export interface ServerAIToolResult {
  provider: 'gemini' | 'openai-compatible';
  model: string;
  text: string;
  toolCalls: ServerAIToolCall[];
  lastError?: string;
}

export function isServerAIConfigured(): boolean {
  return Boolean(GEMINI_API_KEY()) || Boolean(OPENAI_API_KEY());
}

export const isServerAiConfigured = isServerAIConfigured;

export async function generateServerAIText(
  prompt: string,
  systemPrompt: string,
  options: ServerAIOptions = {},
): Promise<string> {
  const result = await generateServerText(prompt, { ...options, systemPrompt });
  return result.text;
}

export async function generateServerText(
  prompt: string,
  options: ServerAIOptions = {},
): Promise<ServerAIResult> {
  const systemPrompt = options.systemPrompt || 'You are Casper, the Blood Sweat Code AI assistant.';
  const temperature = options.temperature ?? 0.8;
  const maxTokens = options.maxTokens ?? 512;
  const apiKeyOverride = (options.apiKeyOverride || '').trim();
  const baseUrlOverride = (options.baseUrlOverride || '').trim();
  const errors: string[] = [];

  // When the caller supplies a per-user OpenAI-compatible key/endpoint
  // (e.g. user picked OpenRouter / Together / Groq / Anthropic-via-OAI),
  // skip Gemini entirely. The user has explicitly opted into an
  // OpenAI-compatible provider; falling back to Gemini would silently
  // ignore that choice and bill the platform's key instead of theirs.
  const skipGemini = Boolean(apiKeyOverride);
  const geminiKey = skipGemini ? '' : GEMINI_API_KEY();

  if (geminiKey && Date.now() > geminiCooldownUntil) {
    const model = geminiModel(options.preferredModel);
    try {
      const text = await callGemini(geminiKey, model, prompt, systemPrompt, temperature, maxTokens, Boolean(options.jsonResponse));
      if (text) return { provider: 'gemini', model, text };
      errors.push(`gemini(${model}): empty response`);
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? 'unknown gemini error').slice(0, 240);
      errors.push(`gemini(${model}): ${msg}`);
      if (msg.includes('429')) {
        geminiCooldownUntil = Date.now() + 5 * 60_000;
        console.warn('[serverAi] Gemini 429 rate-limited — cooling down for 5 min');
      } else {
        console.warn('[serverAi] Gemini call failed, trying OpenAI-compatible fallback:', msg);
      }
    }
  } else if (geminiKey) {
    errors.push('gemini: cooling down after recent 429');
  } else if (!skipGemini) {
    errors.push('gemini: GEMINI_API_KEY not set');
  }

  const openaiKey = apiKeyOverride || OPENAI_API_KEY();
  const openaiBaseUrl = baseUrlOverride
    ? baseUrlOverride.replace(/\/$/, '')
    : OPENAI_BASE_URL();
  if (openaiKey) {
    const model = openAiModel(options.preferredModel);
    try {
      const text = await callOpenAICompatible(openaiKey, openaiBaseUrl, model, prompt, systemPrompt, temperature, maxTokens, Boolean(options.jsonResponse));
      if (text) return { provider: 'openai-compatible', model, text };
      errors.push(`openai(${model}): empty response`);
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? 'unknown openai error').slice(0, 240);
      errors.push(`openai(${model}): ${msg}`);
      console.warn('[serverAi] OpenAI-compatible call failed:', msg);
    }
  } else {
    errors.push(skipGemini
      ? 'openai: per-user apiKeyOverride was empty after trim'
      : 'openai: OPENAI_API_KEY/VITE_AI_API_KEY not set');
  }

  const lastError = errors.join(' | ');
  console.warn('[serverAi] All providers failed, returning empty text. Errors:', lastError);
  return {
    provider: geminiKey ? 'gemini' : 'openai-compatible',
    model: geminiKey ? geminiModel(options.preferredModel) : openAiModel(options.preferredModel),
    text: '',
    lastError,
  };
}

// Multi-turn tool-calling completion. Routes through the
// OpenAI-compatible provider only — Gemini's tool-calling API has a
// different shape and isn't worth supporting on the platform-default
// path (Gemini is the free fallback; users who want tool-calling
// configure their own OpenAI-compatible provider). When Gemini is the
// only available provider, this function returns the Gemini text
// response with no tool calls so the caller's loop terminates
// gracefully and the directive still completes.
//
// The caller (casperControlCenter) drives the tool-calling loop:
// invoke this once per round, parse `toolCalls`, execute them via
// casperTools.executeTool, append the assistant + tool messages, and
// invoke again until `toolCalls` is empty or a round limit is hit.
export async function generateServerToolTurn(
  messages: ServerAIMessage[],
  options: ServerAIToolOptions = {},
): Promise<ServerAIToolResult> {
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 1200;
  const apiKeyOverride = (options.apiKeyOverride || '').trim();
  const baseUrlOverride = (options.baseUrlOverride || '').trim();
  const errors: string[] = [];

  const skipGemini = Boolean(apiKeyOverride);
  const openaiKey = apiKeyOverride || OPENAI_API_KEY();
  const openaiBaseUrl = baseUrlOverride
    ? baseUrlOverride.replace(/\/$/, '')
    : OPENAI_BASE_URL();

  // Tool-calling requires the OpenAI-compatible path. If that's
  // available, prefer it. Otherwise fall back to a text-only Gemini
  // call (no tool_calls returned, caller's loop terminates).
  if (openaiKey) {
    const model = openAiModel(options.preferredModel);
    try {
      const result = await callOpenAICompatibleWithTools({
        apiKey: openaiKey,
        baseUrl: openaiBaseUrl,
        model,
        messages,
        tools: options.tools ?? [],
        toolChoice: options.toolChoice ?? 'auto',
        temperature,
        maxTokens,
      });
      return { provider: 'openai-compatible', model, text: result.text, toolCalls: result.toolCalls };
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? 'unknown openai error').slice(0, 240);
      errors.push(`openai(${model}): ${msg}`);
      console.warn('[serverAi:tools] OpenAI-compatible call failed:', msg);
    }
  } else {
    errors.push(skipGemini
      ? 'openai: per-user apiKeyOverride was empty after trim'
      : 'openai: OPENAI_API_KEY/VITE_AI_API_KEY not set');
  }

  const geminiKey = skipGemini ? '' : GEMINI_API_KEY();
  if (geminiKey && Date.now() > geminiCooldownUntil) {
    const model = geminiModel(options.preferredModel);
    try {
      // Tool-calling fallback: collapse the message history into a
      // single prompt and call Gemini text-only. Tools are not
      // advertised — the caller's loop will see toolCalls=[] and
      // terminate with whatever text Gemini produced.
      const systemPrompt = collapseSystemMessages(messages) ||
        'You are Casper, the Blood Sweat Code AI assistant.';
      const userPrompt = collapseUserAssistantToPrompt(messages);
      const text = await callGemini(geminiKey, model, userPrompt, systemPrompt, temperature, maxTokens, false);
      return { provider: 'gemini', model, text: text || '', toolCalls: [] };
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? 'unknown gemini error').slice(0, 240);
      errors.push(`gemini(${model}): ${msg}`);
      if (msg.includes('429')) {
        geminiCooldownUntil = Date.now() + 5 * 60_000;
        console.warn('[serverAi:tools] Gemini 429 — cooling down for 5 min');
      }
    }
  }

  const lastError = errors.join(' | ');
  console.warn('[serverAi:tools] All providers failed, returning empty text. Errors:', lastError);
  return {
    provider: openaiKey ? 'openai-compatible' : 'gemini',
    model: openaiKey ? openAiModel(options.preferredModel) : geminiModel(options.preferredModel),
    text: '',
    toolCalls: [],
    lastError,
  };
}

function collapseSystemMessages(messages: ServerAIMessage[]): string {
  return messages
    .filter((m): m is { role: 'system'; content: string } => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
}

function collapseUserAssistantToPrompt(messages: ServerAIMessage[]): string {
  // Gemini fallback can't replay tool calls. We render the conversation
  // linearly so any context from earlier rounds is at least visible to
  // the model, even if the tool-call results are summarized as text.
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      lines.push(`User: ${m.content}`);
    } else if (m.role === 'assistant') {
      const text = typeof m.content === 'string' && m.content ? m.content : '';
      if (text) lines.push(`Assistant: ${text}`);
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          lines.push(`Assistant called tool ${tc.function.name} with args ${tc.function.arguments}`);
        }
      }
    } else if (m.role === 'tool') {
      lines.push(`Tool result: ${m.content}`);
    }
  }
  return lines.join('\n\n');
}

async function callOpenAICompatibleWithTools(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ServerAIMessage[];
  tools: ServerAIToolSpec[];
  toolChoice: 'auto' | 'none' | 'required';
  temperature: number;
  maxTokens: number;
}): Promise<{ text: string; toolCalls: ServerAIToolCall[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (input.baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://bloodsweatcode.org';
      headers['X-Title'] = 'Blood, Sweat, or Code';
    }

    const body: Record<string, any> = {
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
    };
    if (input.tools.length > 0) {
      body.tools = input.tools;
      body.tool_choice = input.toolChoice;
    }

    const response = await fetch(`${input.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI-compatible ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const message = data?.choices?.[0]?.message ?? {};
    const text = typeof message.content === 'string' ? message.content.trim() : '';
    const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls: ServerAIToolCall[] = rawToolCalls
      .filter((tc: any) => tc && tc.type === 'function' && tc.function && typeof tc.function.name === 'string')
      .map((tc: any) => ({
        id: typeof tc.id === 'string' ? tc.id : `call_${Math.random().toString(36).slice(2, 10)}`,
        name: tc.function.name as string,
        arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments ?? {}),
      }));

    return { text, toolCalls };
  } finally {
    clearTimeout(timeout);
  }
}

function bearerToken(req: Request) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function requireSupabaseUser(req: Request, res: Response, supabase: SupabaseClient) {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'Missing Supabase session bearer token.' });
    return false;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ success: false, error: 'Invalid or expired Supabase session.' });
    return false;
  }

  return true;
}

export function registerServerAiRoutes(app: Express, supabase: SupabaseClient) {
  app.post('/api/ai/generate-text', async (req, res) => {
    try {
      const authorized = await requireSupabaseUser(req, res, supabase);
      if (!authorized) return;

      const body = req.body as {
        prompt?: unknown;
        systemPrompt?: unknown;
        temperature?: unknown;
        maxTokens?: unknown;
        jsonResponse?: unknown;
      };

      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      if (!prompt.trim()) {
        res.status(400).json({ success: false, error: 'Prompt is required.' });
        return;
      }

      const result = await generateServerText(prompt, {
        systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
        temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
        maxTokens: typeof body.maxTokens === 'number' ? body.maxTokens : undefined,
        jsonResponse: Boolean(body.jsonResponse),
      });

      if (!result.text) {
        res.status(isServerAIConfigured() ? 502 : 503).json({
          success: false,
          error: isServerAIConfigured()
            ? 'AI provider returned an empty response.'
            : 'No server AI provider is configured. Set GEMINI_API_KEY or OPENAI_API_KEY.',
        });
        return;
      }

      res.json({ success: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI generation failed.';
      console.error('[serverAi] route error:', message);
      res.status(502).json({ success: false, error: message });
    }
  });
}

function geminiModel(preferredModel?: string | null) {
  const model = preferredModel?.trim();
  return model?.startsWith('gemini-') ? model : GEMINI_MODEL();
}

function openAiModel(preferredModel?: string | null) {
  const model = preferredModel?.trim();
  if (!model || model === 'platform_default' || model.startsWith('gemini-')) return OPENAI_MODEL();
  return model;
}

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number,
  jsonResponse: boolean,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: maxTokens,
          ...(jsonResponse ? { responseMimeType: 'application/json' } : {}),
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAICompatible(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number,
  jsonResponse: boolean,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://bloodsweatcode.org';
      headers['X-Title'] = 'Blood, Sweat, or Code';
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
        ...(jsonResponse ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI-compatible ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || '';
  } finally {
    clearTimeout(timeout);
  }
}

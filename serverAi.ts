import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

const GEMINI_API_KEY = () => process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.0-flash';

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
}

export interface ServerAIResult {
  provider: 'gemini' | 'openai-compatible';
  model: string;
  text: string;
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
  const geminiKey = GEMINI_API_KEY();

  if (geminiKey) {
    const model = geminiModel(options.preferredModel);
    try {
      const text = await callGemini(geminiKey, model, prompt, systemPrompt, temperature, maxTokens, Boolean(options.jsonResponse));
      if (text) return { provider: 'gemini', model, text };
    } catch (err) {
      console.warn('[serverAi] Gemini call failed, trying OpenAI-compatible fallback:', err);
    }
  }

  const openaiKey = OPENAI_API_KEY();
  if (openaiKey) {
    const model = openAiModel(options.preferredModel);
    try {
      const text = await callOpenAICompatible(openaiKey, model, prompt, systemPrompt, temperature, maxTokens, Boolean(options.jsonResponse));
      if (text) return { provider: 'openai-compatible', model, text };
    } catch (err) {
      console.warn('[serverAi] OpenAI-compatible call failed:', err);
    }
  }

  console.warn('[serverAi] No AI provider available — returning empty string');
  return {
    provider: geminiKey ? 'gemini' : 'openai-compatible',
    model: geminiKey ? geminiModel(options.preferredModel) : openAiModel(options.preferredModel),
    text: '',
  };
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
  return model && model !== 'platform_default' ? model : OPENAI_MODEL();
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
    const baseUrl = OPENAI_BASE_URL();
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

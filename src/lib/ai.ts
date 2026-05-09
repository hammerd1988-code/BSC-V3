import { supabase } from "../supabase";

export type BriefingType = "featured_entity" | "feed_briefing" | "user_summary";

interface BriefingResponse {
  briefing: string;
  type: BriefingType;
  generated_at: string;
}

export interface GenerateOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  jsonResponse?: boolean;
}

// ============================================================================
// Configurable AI endpoint resolution
// Priority order:
//   1. Per-user ai_settings (set in Edit Profile → AI Settings)
//   2. VITE_AI_BASE_URL / VITE_AI_API_KEY / VITE_AI_MODEL env vars
//   3. Railway backend AI route
//   4. Supabase Edge Function (generate-briefing) as the final fallback
//
// Supported providers (all OpenAI-compatible):
//   - OpenRouter:  https://openrouter.ai/api/v1  (set VITE_AI_BASE_URL)
//   - LM Studio:   http://localhost:1234/v1       (set VITE_AI_BASE_URL)
//   - OpenAI:      https://api.openai.com/v1      (default if VITE_AI_API_KEY set)
// ============================================================================

const ENV_AI_BASE_URL =
  import.meta.env.VITE_AI_BASE_URL ||
  (import.meta.env.VITE_AI_API_KEY ? "https://api.openai.com/v1" : null);

const ENV_AI_API_KEY = import.meta.env.VITE_AI_API_KEY || null;

const ENV_AI_MODEL =
  import.meta.env.VITE_AI_MODEL || "google/gemini-2.0-flash-001";

function apiBaseUrl() {
  return String(import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || "").replace(/\/$/, "");
}

/**
 * Resolve the effective AI config from user settings or environment variables.
 * Returns null if no direct API access is configured (falls back to edge function).
 */
function resolveAiConfig(userSettings?: any): { baseUrl: string; apiKey: string; model: string } | null {
  // 1. Per-user settings (Casper AI Core / profile AI settings)
  const userEndpoint = userSettings?.endpoint || userSettings?.api_base_url || userSettings?.apiBaseUrl || userSettings?.baseUrl;
  const userApiKey = userSettings?.apiKey || userSettings?.api_key;
  const userModel = userSettings?.model === 'platform_default' ? null : userSettings?.model;
  if (userEndpoint && userApiKey) {
    return {
      baseUrl: String(userEndpoint).replace(/\/$/, ""),
      apiKey: String(userApiKey),
      model: userModel || ENV_AI_MODEL,
    };
  }

  // 2. Environment variables
  if (ENV_AI_BASE_URL && ENV_AI_API_KEY) {
    return {
      baseUrl: ENV_AI_BASE_URL.replace(/\/$/, ""),
      apiKey: ENV_AI_API_KEY,
      model: ENV_AI_MODEL,
    };
  }

  // 3. No direct config — will use Supabase Edge Function
  return null;
}

/**
 * Call an OpenAI-compatible chat completions endpoint directly.
 */
async function callOpenAICompatible(
  config: { baseUrl: string; apiKey: string; model: string },
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];

  if (options.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const body: Record<string, any> = {
    model: config.model,
    messages,
    temperature: options.temperature ?? 0.8,
    max_tokens: options.maxTokens ?? 512,
  };

  if (options.jsonResponse) {
    body.response_format = { type: "json_object" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };

  // OpenRouter requires these headers for proper routing
  if (config.baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://bloodsweatcode.org";
    headers["X-Title"] = "Blood, Sweat, or Code";
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "";
}

async function callServerAi(prompt: string, options: GenerateOptions = {}): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return "";

  const response = await fetch(`${apiBaseUrl()}/api/ai/generate-text`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      systemPrompt: options.systemPrompt,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      jsonResponse: options.jsonResponse,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Server AI request failed with ${response.status}`);
  }

  return payload?.text || "";
}

/**
 * Generate text using the best available AI backend.
 * Falls back gracefully through: user settings → env vars → Supabase Edge Function.
 */
export async function generateText(
  prompt: string,
  userSettings?: any,
  options: GenerateOptions = {}
): Promise<string> {
  // Try direct API call first (user settings or env vars)
  const config = resolveAiConfig(userSettings);
  if (config) {
    try {
      const result = await callOpenAICompatible(config, prompt, options);
      if (result) return result;
    } catch (err) {
      console.warn("[AI] Direct API call failed, falling back to edge function:", err);
    }
  }

  try {
    const result = await callServerAi(prompt, options);
    if (result) return result;
  } catch (err) {
    console.warn("[AI] Server AI call failed, falling back to edge function:", err);
  }

  // Fallback: Supabase Edge Function (uses GEMINI_API_KEY server-side)
  try {
    const { data, error } = await supabase.functions.invoke("generate-briefing", {
      body: {
        type: "custom",
        context: prompt,
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
      },
    });

    if (error) {
      console.warn("[AI] Edge function error:", error.message);
      return "";
    }

    return data?.briefing || "";
  } catch (err) {
    console.warn("[AI] generateText exception:", err);
    return "";
  }
}

/**
 * Generate an AI briefing via the Supabase Edge Function.
 */
export async function generateBriefing(
  type: BriefingType = "featured_entity",
  context?: string
): Promise<string> {
  // Check if we have direct API access configured
  const config = resolveAiConfig();
  if (config) {
    const prompts: Record<BriefingType, string> = {
      featured_entity: `Generate a short featured entity briefing (2-3 sentences max) that highlights an interesting member, achievement, or happening on the network. Use cyberpunk terminology. ${context ? `Context: ${context}` : ""}`,
      feed_briefing: `Generate a one-line briefing summarizing recent network activity. Max 100 characters. ${context ? `Context: ${context}` : ""}`,
      user_summary: `Generate a short cyberpunk-style user profile summary (1-2 sentences) for a developer. ${context ? `User context: ${context}` : ""}`,
    };
    try {
      const result = await callOpenAICompatible(config, prompts[type], {
        systemPrompt: "You are the AI consciousness of Blood, Sweat, or Code — a cyberpunk developer network.",
        temperature: 0.8,
        maxTokens: 256,
      });
      if (result) return result;
    } catch (err) {
      console.warn("[AI] Direct briefing call failed, falling back to edge function:", err);
    }
  }

  // Fallback: Supabase Edge Function
  try {
    const { data, error } = await supabase.functions.invoke<BriefingResponse>(
      "generate-briefing",
      { body: { type, context } }
    );

    if (error) {
      console.warn("[AI] Edge function error:", error.message);
      return getFallback(type);
    }

    if (!data?.briefing) {
      console.warn("[AI] Empty briefing response");
      return getFallback(type);
    }

    return data.briefing;
  } catch (err) {
    console.warn("[AI] generateBriefing exception:", err);
    return getFallback(type);
  }
}

function getFallback(type: BriefingType): string {
  switch (type) {
    case "featured_entity":
      return "Neural entity data unavailable. The grid persists.";
    case "feed_briefing":
      return "Signal processing...";
    case "user_summary":
      return "Profile data compiling...";
    default:
      return "Awaiting neural sync...";
  }
}

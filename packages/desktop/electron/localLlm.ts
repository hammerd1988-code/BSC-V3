/**
 * Local LLM bridge.
 *
 * Browser PWAs cannot reliably reach `localhost:1234` (LM Studio) or
 * `localhost:11434` (Ollama) because of mixed-content and CORS restrictions
 * when the page is served over HTTPS. The Electron main process has no such
 * restriction, so it acts as a proxy: the renderer calls these handlers over
 * IPC and the main process performs the actual HTTP request to the local
 * inference server.
 *
 * Both LM Studio and Ollama expose an OpenAI-compatible REST surface, so a
 * single code path works for either provider.
 */

export type LlmProvider = 'lmstudio' | 'ollama' | 'custom';

const DEFAULT_BASE_URLS: Record<Exclude<LlmProvider, 'custom'>, string> = {
  lmstudio: 'http://127.0.0.1:1234/v1',
  ollama: 'http://127.0.0.1:11434/v1',
};

export interface LocalLlmTarget {
  provider: LlmProvider;
  /** Overrides the default base URL for the provider. Required for `custom`. */
  baseUrl?: string;
}

export interface ProviderStatus {
  provider: LlmProvider;
  baseUrl: string;
  online: boolean;
  models: string[];
  error?: string;
}

function resolveBaseUrl(target: LocalLlmTarget): string {
  if (target.baseUrl) return stripTrailingSlash(target.baseUrl);
  if (target.provider === 'custom') {
    throw new Error('A baseUrl is required for the "custom" provider.');
  }
  return DEFAULT_BASE_URLS[target.provider];
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe a single provider for availability and list its models.
 */
export async function probeProvider(target: LocalLlmTarget): Promise<ProviderStatus> {
  const baseUrl = resolveBaseUrl(target);
  try {
    const res = await fetchWithTimeout(`${baseUrl}/models`, { method: 'GET' }, 2500);
    if (!res.ok) {
      return {
        provider: target.provider,
        baseUrl,
        online: false,
        models: [],
        error: `HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (body.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string');
    return { provider: target.provider, baseUrl, online: true, models };
  } catch (err) {
    return {
      provider: target.provider,
      baseUrl,
      online: false,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Probe both well-known local providers concurrently.
 */
export async function detectProviders(): Promise<ProviderStatus[]> {
  return Promise.all([
    probeProvider({ provider: 'lmstudio' }),
    probeProvider({ provider: 'ollama' }),
  ]);
}

export interface LocalChatRequest {
  target: LocalLlmTarget;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Forward a (non-streaming) chat completion to the local inference server.
 */
export async function chatCompletion(req: LocalChatRequest): Promise<unknown> {
  const baseUrl = resolveBaseUrl(req.target);
  const res = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 2048,
        stream: false,
      }),
    },
    120_000,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Local LLM request failed: HTTP ${res.status} ${text}`.trim());
  }
  return res.json();
}

import { supabase } from '../supabase';

// Must stay in sync with SUBAGENT_MAX_PARALLEL in casperControlCenter.ts.
// The server caps at the same number; if the client tried to send more,
// the extras would be silently dropped and the optimistic rows would
// hang forever in queued state.
export const CASPER_SUBAGENT_MAX_PARALLEL = 8;

function apiBaseUrl() {
  return String(import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || '').replace(/\/$/, '');
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Sign in is required before invoking Casper.');
  }
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const errorMessage = (payload as { error?: string; message?: string })?.error
      || (payload as { error?: string; message?: string })?.message
      || `Casper request failed with ${response.status}`;
    const error = new Error(errorMessage) as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload as T;
}

export interface SubagentResult {
  id: string;
  objective: string;
  status: 'queued' | 'working' | 'completed' | 'failed';
  result: string;
}

export interface SubagentSpawnResponse {
  success: true;
  parentTaskId: string;
  objectives: string[];
  results: SubagentResult[];
}

export async function spawnCasperSubagents(input: {
  parentPrompt: string;
  objectives?: string[];
  parentTaskId?: string;
}): Promise<SubagentSpawnResponse> {
  const headers = await authHeaders();
  const response = await fetch(`${apiBaseUrl()}/api/casper/subagents/spawn`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  return parseResponse<SubagentSpawnResponse>(response);
}

// Casper UI surfaces — each one swaps in a different persona module on
// the server side. Must stay in sync with CASPER_SURFACES in
// casperControlCenter.ts; if the client sends an unknown value the
// server falls back to 'control_center'.
//   control_center → operator console (default — full sysadmin/operator)
//   studio         → Studio guide (content + engineering dual expert)
//   guide          → "Ask Casper" floating help popup (concise, page-aware)
//   autopilot      → autonomous routines (terse, machine-parseable)
export type CasperSurface = 'control_center' | 'studio' | 'guide' | 'autopilot';

// One tool invocation made by the LLM during a directive. Persisted
// to casper_tasks.metadata.tool_calls and surfaced in the operator
// console as a chronological action log so operators can see exactly
// what Casper did (vs just what it said).
export interface CasperToolCall {
  id: string;
  name: string;
  ok: boolean;
  data: unknown;
  error: string | null;
  status: number | null;
  durationMs: number;
}

export interface CasperCommandResponse {
  success: true;
  taskId: string | null;
  response: string;
  surface: CasperSurface;
  provider: string;
  model: string;
  // Optional — present only when the directive ran through the
  // tool-calling loop (control_center / studio surfaces). Empty when
  // the model did not request any tool calls.
  toolCalls?: CasperToolCall[];
  toolRounds?: number;
  toolTruncatedReason?: string | null;
}

// Server-side deferred-execution descriptor. When the user has
// configured a local LLM (LM Studio / Ollama / etc.) the directive
// endpoint returns this instead of a finished response — the browser
// then runs the prompt against its localhost endpoint and posts the
// result back so the server can finish the task. This is what lets
// users run directives free on their own hardware.
interface ClientExecutionDescriptor {
  taskId: string;
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  prompt: string;
}

interface DeferredCasperCommandResponse {
  success: true;
  taskId: string | null;
  surface: CasperSurface;
  provider: 'client-local';
  model: string;
  deferredExecution: true;
  clientExecution: ClientExecutionDescriptor;
}

// Read the user's Casper API key from their stored ai_settings on
// the users row. The server doesn't relay this back (deliberate — no
// reason to send the key on a round trip when the browser already
// has it), so the browser fetches it itself when running locally.
async function loadLocalApiKey(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return null;
    const { data } = await supabase
      .from('users')
      .select('ai_settings')
      .eq('auth_uid', userId)
      .maybeSingle();
    const raw = data?.ai_settings as Record<string, any> | null | undefined;
    if (!raw) return null;
    const key = raw.apiKey ?? raw.api_key ?? null;
    return typeof key === 'string' && key.trim().length > 0 ? key.trim() : null;
  } catch {
    return null;
  }
}

// Run the directive against the user's local OpenAI-compatible
// endpoint (LM Studio, Ollama, etc.). Both expose the same
// /v1/chat/completions shape.
async function runDirectiveOnLocalLLM(payload: ClientExecutionDescriptor): Promise<string> {
  const url = payload.endpoint.replace(/\/$/, '') + '/chat/completions';
  // Some local servers (LM Studio especially) require a non-empty
  // bearer token even though they ignore the value. Default to a
  // placeholder when the user hasn't set one.
  const apiKey = (await loadLocalApiKey()) || 'local';
  const body = {
    model: payload.model,
    temperature: payload.temperature,
    max_tokens: payload.maxTokens,
    messages: [
      { role: 'system' as const, content: payload.systemPrompt },
      { role: 'user' as const, content: payload.prompt },
    ],
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Local LLM responded ${response.status}: ${text.slice(0, 300)}`);
  }
  const json = await response.json().catch(() => null);
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Local LLM returned an empty completion.');
  }
  return content.trim();
}

// POST the local-LLM result (or error) back so the server can finish
// the task row and write to the activity log.
async function reportClientExecution(
  taskId: string,
  result: { response: string; model: string; durationMs: number } | { error: string; durationMs: number },
): Promise<CasperCommandResponse> {
  const headers = await authHeaders();
  const response = await fetch(`${apiBaseUrl()}/api/casper/command/complete-client-execution`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ taskId, ...result }),
  });
  return parseResponse<CasperCommandResponse>(response);
}

// Send a directive to Casper from any UI surface. The server appends a
// surface-specific persona module to the system prompt so the same
// /api/casper/command endpoint speaks with the right expertise depending
// on context. Pass `pageContext` (URL path, current feature, etc.) and
// it will be appended to the directive so Casper knows where the user is.
//
// If the user has configured a local LLM (LM Studio / Ollama), the
// server returns a deferred-execution descriptor instead of a finished
// response. We then run the prompt against the user's localhost
// endpoint and POST the answer back. The caller gets the same
// CasperCommandResponse shape regardless — local execution is fully
// transparent.
export async function sendCasperCommand(input: {
  command: string;
  surface?: CasperSurface;
  source?: 'admin' | 'user';
  pageContext?: { path?: string; feature?: string; description?: string };
  metadata?: Record<string, unknown>;
}): Promise<CasperCommandResponse> {
  const headers = await authHeaders();
  let command = input.command.trim();
  if (input.pageContext) {
    const ctx = input.pageContext;
    const parts: string[] = [];
    if (ctx.path) parts.push(`path: ${ctx.path}`);
    if (ctx.feature) parts.push(`feature: ${ctx.feature}`);
    if (ctx.description) parts.push(ctx.description);
    if (parts.length > 0) {
      command = `[Page context — ${parts.join(' | ')}]\n\n${command}`;
    }
  }
  const response = await fetch(`${apiBaseUrl()}/api/casper/command`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      command,
      surface: input.surface ?? 'control_center',
      source: input.source,
      metadata: input.metadata ?? {},
    }),
  });
  const initial = await parseResponse<CasperCommandResponse | DeferredCasperCommandResponse>(response);

  if ('deferredExecution' in initial && initial.deferredExecution && initial.clientExecution) {
    const desc = initial.clientExecution;
    if (!desc.taskId) {
      throw new Error('Local LLM execution failed: server did not return a taskId.');
    }
    const startedAt = Date.now();
    try {
      const text = await runDirectiveOnLocalLLM(desc);
      return reportClientExecution(desc.taskId, {
        response: text,
        model: desc.model,
        durationMs: Date.now() - startedAt,
      });
    } catch (err: any) {
      const message = err?.message || String(err);
      // Best-effort report-back so the task gets marked as failed
      // server-side, but we don't want to mask the original error
      // from the caller.
      try {
        await reportClientExecution(desc.taskId, {
          error: message,
          durationMs: Date.now() - startedAt,
        });
      } catch {
        // ignore — we'll throw the original error anyway
      }
      const wrapped = new Error(
        `Local LLM execution failed (${desc.endpoint}): ${message}. Make sure your local LLM server is running and CORS is enabled.`,
      ) as Error & { cause?: unknown };
      wrapped.cause = err;
      throw wrapped;
    }
  }

  return initial as CasperCommandResponse;
}

// -- Integrations (PR #45) --------------------------------------------------

export interface IntegrationToolDescriptor {
  name: string;
  description: string;
}

export interface IntegrationConnected {
  integration_key: string;
  status: string;
  connected_at: string | null;
  tools: IntegrationToolDescriptor[];
}

export interface IntegrationsConnectedResponse {
  success: true;
  connected: IntegrationConnected[];
}

export interface IntegrationsToolsResponse {
  success: true;
  adapters: Array<{
    integration: string;
    tools: Array<{ name: string; description: string; params: Array<{ name: string; type: string; required?: boolean; description: string; default?: unknown }> }>;
  }>;
}

export interface IntegrationExecuteResponse {
  success: boolean;
  integrationKey: string;
  toolName: string;
  data: unknown;
  error: string | null;
  status: number | null;
  durationMs: number | null;
}

export async function listCasperIntegrationTools(): Promise<IntegrationsToolsResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/casper/integrations/tools`);
  return parseResponse<IntegrationsToolsResponse>(response);
}

export async function listCasperConnectedIntegrations(): Promise<IntegrationsConnectedResponse> {
  const headers = await authHeaders();
  const response = await fetch(`${apiBaseUrl()}/api/casper/integrations/connected`, { headers });
  return parseResponse<IntegrationsConnectedResponse>(response);
}

export async function executeCasperIntegration(input: {
  integrationKey: string;
  toolName: string;
  params?: Record<string, unknown>;
}): Promise<IntegrationExecuteResponse> {
  const headers = await authHeaders();
  const response = await fetch(`${apiBaseUrl()}/api/casper/integrations/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  // Parse without throwing on !ok — failures here are surfaced as
  // structured payloads so callers can distinguish auth/permission
  // errors from the upstream provider's logical errors.
  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  return payload as IntegrationExecuteResponse;
}

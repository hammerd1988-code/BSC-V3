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

export interface CasperCommandResponse {
  success: true;
  taskId: string | null;
  response: string;
  surface: CasperSurface;
  provider: string;
  model: string;
}

// Send a directive to Casper from any UI surface. The server appends a
// surface-specific persona module to the system prompt so the same
// /api/casper/command endpoint speaks with the right expertise depending
// on context. Pass `pageContext` (URL path, current feature, etc.) and
// it will be appended to the directive so Casper knows where the user is.
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
  return parseResponse<CasperCommandResponse>(response);
}

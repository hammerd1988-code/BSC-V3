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

import { supabase } from '../supabase';

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

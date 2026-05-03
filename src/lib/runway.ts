import { supabase } from '../supabase';

export type RunwayAssetType = 'image' | 'video';
export type RunwayStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
export type RunwayAspectRatio = '16:9' | '9:16' | '1:1';

export interface RunwayGenerateRequest {
  prompt: string;
  type: RunwayAssetType;
  duration?: 4 | 5 | 10;
  aspectRatio?: RunwayAspectRatio;
  ratio?: RunwayAspectRatio;
  resolution?: string;
  promptImage?: string;
}

export interface RunwayTaskResponse {
  id?: string | null;
  taskId?: string | null;
  status: RunwayStatus;
  output?: string[];
  assetUrl?: string | null;
  type?: RunwayAssetType;
  ratio?: RunwayAspectRatio;
  duration?: number;
  model?: string;
  raw?: unknown;
}

function apiBaseUrl() {
  return String(import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || '').replace(/\/$/, '');
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Sign in is required before using Visual Forge.');
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Runway request failed with ${response.status}`);
  }
  return payload as RunwayTaskResponse;
}

export async function requestRunwayGeneration(input: RunwayGenerateRequest): Promise<RunwayTaskResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/runway/generate`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });

  return parseResponse(response);
}

export async function getRunwayTask(taskId: string): Promise<RunwayTaskResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/runway/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    headers: await authHeaders(),
  });

  return parseResponse(response);
}

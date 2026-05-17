import { authedFetch } from './authSession';

export type RunwayAssetType = 'image' | 'video';
export type RunwayStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
export type RunwayAspectRatio = '16:9' | '9:16' | '1:1' | '4:3';

export interface RunwayGenerateRequest {
  prompt: string;
  type: RunwayAssetType;
  feature?: 'ai_image_generation' | 'ai_video_generation' | 'thumbnail_generation';
  duration?: 4 | 5 | 10;
  aspectRatio?: RunwayAspectRatio;
  ratio?: RunwayAspectRatio;
  resolution?: string;
  promptImage?: string;
}

export class RunwayRequestError extends Error {
  status: number;
  provider?: string;
  adminBypass?: boolean;
  details?: unknown;

  constructor(message: string, status: number, payload: Record<string, unknown>) {
    super(message);
    this.name = 'RunwayRequestError';
    this.status = status;
    this.provider = typeof payload.provider === 'string' ? payload.provider : undefined;
    this.adminBypass = typeof payload.adminBypass === 'boolean' ? payload.adminBypass : undefined;
    this.details = payload.details;
  }
}

export interface RunwayTaskResponse {
  id?: string | null;
  taskId?: string | null;
  status: RunwayStatus;
  output?: string[];
  assetUrl?: string | null;
  provider?: 'runway' | 'zimage';
  type?: RunwayAssetType;
  ratio?: RunwayAspectRatio;
  duration?: number;
  model?: string;
  usage?: {
    used: number;
    limit: number | null;
    tier: string;
  };
  raw?: unknown;
}

export interface StudioAssetUploadRequest {
  assetUrl: string;
  assetType: RunwayAssetType | 'thumbnail';
  title?: string;
}

export interface StudioAssetUploadResponse {
  publicUrl: string;
  path: string;
  contentType: string;
}

function apiBaseUrl() {
  return String(import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || '').replace(/\/$/, '');
}

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new RunwayRequestError(payload?.error || payload?.message || `Runway request failed with ${response.status}`, response.status, payload);
  }
  return payload as RunwayTaskResponse;
}

export async function requestRunwayGeneration(input: RunwayGenerateRequest): Promise<RunwayTaskResponse> {
  const response = await authedFetch(`${apiBaseUrl()}/api/runway/generate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return parseResponse(response);
}

export async function getRunwayTask(taskId: string): Promise<RunwayTaskResponse> {
  const response = await authedFetch(`${apiBaseUrl()}/api/runway/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET',
  });

  return parseResponse(response);
}

export async function uploadStudioAsset(input: StudioAssetUploadRequest): Promise<StudioAssetUploadResponse> {
  const response = await authedFetch(`${apiBaseUrl()}/api/runway/studio-assets`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return parseResponse(response) as unknown as Promise<StudioAssetUploadResponse>;
}

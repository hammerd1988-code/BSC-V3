import { supabase } from '../supabase';

export type LiveKitRoomType = 'stream' | 'call';
export type LiveKitRole = 'host' | 'viewer' | 'caller' | 'callee' | 'participant';

export interface LiveKitTokenRequest {
  roomType: LiveKitRoomType;
  resourceId?: string;
  roomName?: string;
  role: LiveKitRole;
  displayName?: string;
  avatarUrl?: string | null;
}

export interface LiveKitTokenResponse {
  token: string;
  url: string;
  roomName: string;
  identity: string;
  role: LiveKitRole;
  canPublish: boolean;
}

export function liveKitRoomName(roomType: LiveKitRoomType, resourceId: string): string {
  const safeId = resourceId.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 80);
  return `${roomType}:${safeId}`;
}

export async function requestLiveKitToken(input: LiveKitTokenRequest): Promise<LiveKitTokenResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Sign in is required before joining a LiveKit room.');
  }

  const apiBase = String(import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || '').replace(/\/$/, '');
  const response = await fetch(`${apiBase}/api/livekit/token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `LiveKit token request failed with ${response.status}`);
  }

  return payload as LiveKitTokenResponse;
}

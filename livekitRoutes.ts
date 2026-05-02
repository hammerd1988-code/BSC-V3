import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessToken } from 'livekit-server-sdk';

type LiveKitRoomType = 'stream' | 'call';
type LiveKitRole = 'host' | 'viewer' | 'caller' | 'callee' | 'participant';

interface LiveKitTokenRequest {
  roomName?: string;
  roomType?: LiveKitRoomType;
  resourceId?: string;
  role?: LiveKitRole;
  displayName?: string;
  avatarUrl?: string | null;
}

const ROOM_NAME_PATTERN = /^[A-Za-z0-9:_=-]{3,128}$/;

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || Array.isArray(header)) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function sanitizeRoomPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 80);
}

function resolveRoomName(body: LiveKitTokenRequest): string | null {
  if (body.roomName && ROOM_NAME_PATTERN.test(body.roomName)) return body.roomName;
  if (!body.roomType || !body.resourceId) return null;
  const typePrefix = body.roomType === 'stream' ? 'stream' : 'call';
  const safeId = sanitizeRoomPart(String(body.resourceId));
  const next = `${typePrefix}:${safeId}`;
  return ROOM_NAME_PATTERN.test(next) ? next : null;
}

async function resolveProfile(supabase: SupabaseClient, authUser: any) {
  const select = 'id, username, display_name, avatar_url, auth_uid, email, type';

  const byAuthUid = await supabase.from('users').select(select).eq('auth_uid', authUser.id).maybeSingle();
  if (byAuthUid.data) return byAuthUid.data;

  const byId = await supabase.from('users').select(select).eq('id', authUser.id).maybeSingle();
  if (byId.data) return byId.data;

  if (authUser.email) {
    const byEmail = await supabase.from('users').select(select).eq('email', authUser.email).maybeSingle();
    if (byEmail.data) return byEmail.data;
  }

  return {
    id: authUser.id,
    username: authUser.email?.split('@')[0] ?? `user_${String(authUser.id).slice(0, 8)}`,
    display_name: authUser.user_metadata?.full_name ?? authUser.user_metadata?.name ?? authUser.email ?? 'BSC User',
    avatar_url: authUser.user_metadata?.avatar_url ?? authUser.user_metadata?.picture ?? null,
    auth_uid: authUser.id,
    email: authUser.email ?? null,
    type: 'human',
  };
}

export function registerLiveKitRoutes(app: Express, supabase: SupabaseClient) {
  app.post('/api/livekit/token', async (req: Request, res: Response) => {
    try {
      const liveKitUrl = process.env.LIVEKIT_URL || process.env.VITE_LIVEKIT_URL;
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;

      if (!liveKitUrl || !apiKey || !apiSecret) {
        return res.status(503).json({
          error: 'LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET on the server.',
        });
      }

      const bearerToken = getBearerToken(req);
      if (!bearerToken) {
        return res.status(401).json({ error: 'Missing Supabase session bearer token.' });
      }

      const { data: authData, error: authError } = await supabase.auth.getUser(bearerToken);
      if (authError || !authData?.user) {
        return res.status(401).json({ error: 'Invalid or expired Supabase session.' });
      }

      const body = (req.body ?? {}) as LiveKitTokenRequest;
      const roomName = resolveRoomName(body);
      if (!roomName) {
        return res.status(400).json({ error: 'A valid roomName or roomType/resourceId pair is required.' });
      }

      const roomType: LiveKitRoomType = body.roomType === 'call' ? 'call' : 'stream';
      const role: LiveKitRole = body.role ?? (roomType === 'call' ? 'participant' : 'viewer');
      const profile = await resolveProfile(supabase, authData.user);
      const identity = String(profile.id ?? authData.user.id);
      const displayName = body.displayName || profile.display_name || profile.username || authData.user.email || 'BSC User';
      const canPublish = roomType === 'call' || role === 'host' || role === 'caller' || role === 'callee' || role === 'participant';
      const metadata = JSON.stringify({
        userId: identity,
        username: profile.username ?? null,
        displayName,
        avatarUrl: body.avatarUrl ?? profile.avatar_url ?? null,
        roomType,
        role,
      });

      const accessToken = new AccessToken(apiKey, apiSecret, {
        identity,
        name: displayName,
        metadata,
        ttl: roomType === 'stream' && role === 'viewer' ? '2h' : '6h',
      });

      accessToken.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish,
        canSubscribe: true,
        canPublishData: true,
      });

      const token = await accessToken.toJwt();

      return res.json({
        token,
        url: liveKitUrl,
        roomName,
        identity,
        role,
        canPublish,
      });
    } catch (error: any) {
      console.error('[LiveKit] token generation failed:', error);
      return res.status(500).json({ error: error?.message || 'Failed to generate LiveKit token.' });
    }
  });
}

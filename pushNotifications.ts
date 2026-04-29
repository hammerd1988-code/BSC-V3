import type express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import webPush from 'web-push';

export type PushEventType = 'dm' | 'comment' | 'mention';

type PushSubscriptionJSON = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type PushNotificationInput = {
  recipientUserId: string;
  senderId?: string;
  senderName: string;
  senderUsername?: string | null;
  senderAvatar?: string | null;
  type: PushEventType;
  messagePreview: string;
  url: string;
  postId?: string;
  commentId?: string;
  transmissionId?: string;
  createInAppNotification?: boolean;
};

type PushPayload = {
  title: string;
  body: string;
  icon: string;
  badge: string;
  image?: string;
  tag: string;
  url: string;
  type: PushEventType;
  senderName: string;
  messagePreview: string;
  sound: string;
  vibrate: number[];
  timestamp: number;
  data: Record<string, unknown>;
};

let webPushConfigured = false;
let lastConfigSignature = '';

const DEFAULT_ICON = '/icons/icon-192x192.png';
const DEFAULT_BADGE = '/icons/icon-192x192.png';
const DEFAULT_SOUND = '/sounds/bsc-notification.wav';

function getVapidConfig() {
  return {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || '',
  };
}

function ensureWebPushConfigured(): boolean {
  const { publicKey, privateKey, subject } = getVapidConfig();
  const signature = `${publicKey}:${privateKey}:${subject}`;

  if (webPushConfigured && signature === lastConfigSignature) {
    return true;
  }

  if (!publicKey || !privateKey || !subject) {
    webPushConfigured = false;
    lastConfigSignature = signature;
    return false;
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);
  webPushConfigured = true;
  lastConfigSignature = signature;
  return true;
}

function truncatePreview(value: string, maxLength = 140): string {
  const trimmed = (value || '').replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function titleForType(type: PushEventType, senderName: string): string {
  switch (type) {
    case 'dm':
      return `${senderName} sent you a transmission`;
    case 'comment':
      return `${senderName} commented on your post`;
    case 'mention':
      return `${senderName} mentioned you`;
    default:
      return 'BloodSweatCode notification';
  }
}

function tagFor(input: PushNotificationInput): string {
  if (input.type === 'dm' && input.transmissionId) return `bsc-dm-${input.transmissionId}`;
  if (input.type === 'comment' && input.postId) return `bsc-comment-${input.postId}`;
  if (input.type === 'mention' && input.commentId) return `bsc-mention-${input.commentId}`;
  return `bsc-${input.type}-${input.recipientUserId}`;
}

function makePayload(input: PushNotificationInput): PushPayload {
  const preview = truncatePreview(input.messagePreview || 'New activity on BloodSweatCode');
  return {
    title: titleForType(input.type, input.senderName || 'Someone'),
    body: preview,
    icon: input.senderAvatar || DEFAULT_ICON,
    badge: DEFAULT_BADGE,
    tag: tagFor(input),
    url: input.url || '/',
    type: input.type,
    senderName: input.senderName || 'Someone',
    messagePreview: preview,
    sound: DEFAULT_SOUND,
    vibrate: input.type === 'dm' ? [80, 40, 80] : [60, 35, 60],
    timestamp: Date.now(),
    data: {
      url: input.url || '/',
      type: input.type,
      senderId: input.senderId,
      senderName: input.senderName,
      senderUsername: input.senderUsername,
      postId: input.postId,
      commentId: input.commentId,
      transmissionId: input.transmissionId,
    },
  };
}

function getBearerToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

async function getAuthenticatedUserId(req: express.Request, supabase: SupabaseClient): Promise<string | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

async function verifyUserOwnsProfile(
  req: express.Request,
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const authUserId = await getAuthenticatedUserId(req, supabase);
  if (!authUserId) return false;

  if (authUserId === userId) return true;

  const { data, error } = await supabase
    .from('users')
    .select('id, auth_uid')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return false;
  return data.auth_uid === authUserId;
}

function isValidSubscription(subscription: unknown): subscription is PushSubscriptionJSON {
  const candidate = subscription as PushSubscriptionJSON;
  return Boolean(
    candidate &&
    typeof candidate.endpoint === 'string' &&
    candidate.endpoint.length > 0 &&
    candidate.keys &&
    typeof candidate.keys.p256dh === 'string' &&
    typeof candidate.keys.auth === 'string'
  );
}

async function deactivateSubscription(supabase: SupabaseClient, endpoint: string) {
  const { error } = await supabase
    .from('push_subscriptions')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('endpoint', endpoint);
  if (error) console.warn('[push] Failed to deactivate stale subscription:', error.message);
}

export async function sendPushNotification(
  supabase: SupabaseClient,
  input: PushNotificationInput,
): Promise<{ attempted: number; sent: number; skipped: boolean }> {
  if (!ensureWebPushConfigured()) {
    console.warn('[push] VAPID env vars are not fully configured; skipping push delivery.');
    return { attempted: 0, sent: 0, skipped: true };
  }

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, subscription')
    .eq('user_id', input.recipientUserId)
    .eq('is_active', true);

  if (error) {
    console.error('[push] Failed to load subscriptions:', error.message);
    return { attempted: 0, sent: 0, skipped: false };
  }

  const rows = data ?? [];
  const payload = JSON.stringify(makePayload(input));
  let sent = 0;

  await Promise.all(rows.map(async (row: any) => {
    const subscription = row.subscription as PushSubscriptionJSON;
    if (!isValidSubscription(subscription)) return;

    try {
      await webPush.sendNotification(subscription as webPush.PushSubscription, payload, {
        TTL: 60 * 60 * 24,
        urgency: input.type === 'dm' ? 'high' : 'normal',
      });
      sent += 1;
    } catch (error: any) {
      const statusCode = error?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await deactivateSubscription(supabase, subscription.endpoint);
        return;
      }
      console.warn('[push] Delivery failed:', statusCode || error?.message || error);
    }
  }));

  return { attempted: rows.length, sent, skipped: false };
}

async function createInAppNotificationIfNeeded(supabase: SupabaseClient, input: PushNotificationInput) {
  if (input.createInAppNotification === false || input.type === 'dm') return;

  const payload = {
    from_user_id: input.senderId,
    from_display_name: input.senderName,
    from_username: input.senderUsername,
    sender_avatar: input.senderAvatar,
    message: titleForType(input.type, input.senderName || 'Someone'),
    preview: truncatePreview(input.messagePreview || ''),
    url: input.url,
    post_id: input.postId,
    comment_id: input.commentId,
  };

  const { error } = await supabase.from('notifications').insert({
    user_id: input.recipientUserId,
    type: input.type,
    payload,
    is_read: false,
  });

  if (error) {
    console.warn('[push] Failed to create in-app notification:', error.message);
  }
}

export function registerPushRoutes(app: express.Express, supabase: SupabaseClient): void {
  app.get('/api/push/vapid-public-key', (_req, res) => {
    const { publicKey } = getVapidConfig();
    if (!publicKey) {
      return res.status(503).json({ error: 'VAPID public key is not configured' });
    }
    res.json({ publicKey });
  });

  app.post('/api/push/subscribe', async (req, res) => {
    try {
      const { userId, subscription } = req.body ?? {};
      if (!userId || !isValidSubscription(subscription)) {
        return res.status(400).json({ error: 'userId and a valid PushSubscription are required' });
      }

      const ownsProfile = await verifyUserOwnsProfile(req, supabase, userId);
      if (!ownsProfile) {
        return res.status(401).json({ error: 'Unauthorized push subscription request' });
      }

      const { error } = await supabase.from('push_subscriptions').upsert({
        user_id: userId,
        endpoint: subscription.endpoint,
        subscription,
        user_agent: req.headers['user-agent'] || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' });

      if (error) throw error;
      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error('[push] Subscribe failed:', error);
      res.status(500).json({ error: error?.message || 'Failed to save push subscription' });
    }
  });

  app.post('/api/push/unsubscribe', async (req, res) => {
    try {
      const { userId, endpoint } = req.body ?? {};
      if (!userId || !endpoint) {
        return res.status(400).json({ error: 'userId and endpoint are required' });
      }

      const ownsProfile = await verifyUserOwnsProfile(req, supabase, userId);
      if (!ownsProfile) {
        return res.status(401).json({ error: 'Unauthorized push unsubscribe request' });
      }

      const { error } = await supabase
        .from('push_subscriptions')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('endpoint', endpoint);

      if (error) throw error;
      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error('[push] Unsubscribe failed:', error);
      res.status(500).json({ error: error?.message || 'Failed to remove push subscription' });
    }
  });

  app.post('/api/push/notify', async (req, res) => {
    try {
      const input = req.body as PushNotificationInput;
      if (!input?.recipientUserId || !input?.type || !input?.senderName || !input?.messagePreview) {
        return res.status(400).json({ error: 'recipientUserId, type, senderName, and messagePreview are required' });
      }
      if (!['dm', 'comment', 'mention'].includes(input.type)) {
        return res.status(400).json({ error: 'Unsupported push notification type' });
      }
      if (!input.senderId) {
        return res.status(400).json({ error: 'senderId is required' });
      }
      if (input.recipientUserId === input.senderId) {
        return res.status(200).json({ success: true, skipped: true, reason: 'self-notification' });
      }

      const ownsSenderProfile = await verifyUserOwnsProfile(req, supabase, input.senderId);
      if (!ownsSenderProfile) {
        return res.status(401).json({ error: 'Unauthorized push notification request' });
      }

      await createInAppNotificationIfNeeded(supabase, input);
      const result = await sendPushNotification(supabase, input);
      res.status(200).json({ success: true, ...result });
    } catch (error: any) {
      console.error('[push] Notify failed:', error);
      res.status(500).json({ error: error?.message || 'Failed to send push notification' });
    }
  });
}

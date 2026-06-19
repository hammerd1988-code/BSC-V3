/**
 * Native push delivery for the Capacitor mobile app.
 *
 * Web Push (VAPID) lives in pushNotifications.ts; this module delivers to the
 * APNs/FCM device tokens stored in `device_push_tokens` by the mobile client
 * (see src/lib/mobile.ts + supabase/migrations/0045_device_push_tokens.sql):
 *   - Android tokens  → Firebase Cloud Messaging (firebase-admin)
 *   - iOS tokens      → Apple Push Notification service (apns2, .p8 token auth)
 *
 * Both transports are gated behind environment configuration and no-op cleanly
 * when their credentials are absent, so deployments without push secrets are
 * unaffected. Tokens that providers report as stale/invalid are deactivated.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface NativePushMessage {
  recipientUserId: string;
  title: string;
  body: string;
  url: string;
  /** Custom key/value payload; coerced to strings for FCM compatibility. */
  data?: Record<string, unknown>;
  /** Collapse/thread key (FCM collapseKey, APNs collapseId). */
  tag?: string;
  badge?: number;
  /** When true, deliver with high priority (DMs/calls). */
  highPriority?: boolean;
}

export interface NativePushResult {
  attempted: number;
  sent: number;
  skipped: boolean;
}

type DeviceTokenRow = {
  token: string;
  platform: 'ios' | 'android';
};

// firebase-admin and apns2 are imported lazily so they're only loaded when
// configured, and never add startup cost to deployments that don't use them.
type FcmMessaging = import('firebase-admin').messaging.Messaging;
type ApnsClient = import('apns2').ApnsClient;

const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'org.bloodsweatcode.app';

let fcmMessaging: FcmMessaging | null | undefined;
let apnsClient: ApnsClient | null | undefined;

function isFcmConfigured(): boolean {
  return Boolean(process.env.FCM_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

function isApnsConfigured(): boolean {
  return Boolean(process.env.APNS_KEY && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID);
}

export function isNativePushConfigured(): boolean {
  return isFcmConfigured() || isApnsConfigured();
}

async function getFcm(): Promise<FcmMessaging | null> {
  if (fcmMessaging !== undefined) return fcmMessaging;
  if (!isFcmConfigured()) {
    fcmMessaging = null;
    return null;
  }

  try {
    const admin = (await import('firebase-admin')).default;
    const appName = 'bsc-native-push';
    const existing = admin.apps.find((a) => a?.name === appName);
    const app = existing ?? admin.initializeApp(
      {
        credential: process.env.FCM_SERVICE_ACCOUNT
          ? admin.credential.cert(JSON.parse(process.env.FCM_SERVICE_ACCOUNT))
          : admin.credential.applicationDefault(),
      },
      appName,
    );
    fcmMessaging = admin.messaging(app);
  } catch (err) {
    console.error('[native-push] FCM init failed:', err);
    fcmMessaging = null;
  }
  return fcmMessaging;
}

async function getApns(): Promise<ApnsClient | null> {
  if (apnsClient !== undefined) return apnsClient;
  if (!isApnsConfigured()) {
    apnsClient = null;
    return null;
  }

  try {
    const { ApnsClient: Client, Host } = await import('apns2');
    apnsClient = new Client({
      team: process.env.APNS_TEAM_ID as string,
      keyId: process.env.APNS_KEY_ID as string,
      // The .p8 contents; support literal newlines escaped as \n in env vars.
      signingKey: (process.env.APNS_KEY as string).replace(/\\n/g, '\n'),
      defaultTopic: APNS_BUNDLE_ID,
      host: process.env.APNS_PRODUCTION === 'true' ? Host.production : Host.development,
    });
  } catch (err) {
    console.error('[native-push] APNs init failed:', err);
    apnsClient = null;
  }
  return apnsClient;
}

function stringifyData(data: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === 'string' ? value : String(value);
  }
  return out;
}

async function deactivateToken(supabase: SupabaseClient, token: string): Promise<void> {
  const { error } = await supabase
    .from('device_push_tokens')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('token', token);
  if (error) console.warn('[native-push] Failed to deactivate stale token:', error.message);
}

async function sendFcm(
  supabase: SupabaseClient,
  tokens: string[],
  msg: NativePushMessage,
): Promise<number> {
  const messaging = await getFcm();
  if (!messaging || tokens.length === 0) return 0;

  const data = { ...stringifyData(msg.data), url: msg.url, title: msg.title, body: msg.body };
  const results = await messaging.sendEach(
    tokens.map((token) => ({
      token,
      notification: { title: msg.title, body: msg.body },
      data,
      android: {
        priority: (msg.highPriority ? 'high' : 'normal') as 'high' | 'normal',
        collapseKey: msg.tag,
        notification: { tag: msg.tag },
      },
    })),
  );

  let sent = 0;
  await Promise.all(
    results.responses.map(async (res, i) => {
      if (res.success) {
        sent += 1;
        return;
      }
      const code = res.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        await deactivateToken(supabase, tokens[i]);
      } else {
        console.warn('[native-push] FCM delivery failed:', code || res.error?.message);
      }
    }),
  );
  return sent;
}

async function sendApns(
  supabase: SupabaseClient,
  tokens: string[],
  msg: NativePushMessage,
): Promise<number> {
  const client = await getApns();
  if (!client || tokens.length === 0) return 0;

  const { Notification, Priority } = await import('apns2');
  const notifications = tokens.map(
    (token) =>
      new Notification(token, {
        alert: { title: msg.title, body: msg.body },
        badge: msg.badge,
        sound: 'default',
        topic: APNS_BUNDLE_ID,
        collapseId: msg.tag,
        priority: msg.highPriority ? Priority.immediate : Priority.throttled,
        data: { ...stringifyData(msg.data), url: msg.url },
      }),
  );

  const results = await client.sendMany(notifications);
  let sent = 0;
  await Promise.all(
    results.map(async (res, i) => {
      const error = (res as { error?: { reason?: string } }).error;
      if (!error) {
        sent += 1;
        return;
      }
      if (error.reason === 'Unregistered' || error.reason === 'BadDeviceToken') {
        await deactivateToken(supabase, tokens[i]);
      } else {
        console.warn('[native-push] APNs delivery failed:', error.reason);
      }
    }),
  );
  return sent;
}

export async function sendNativePush(
  supabase: SupabaseClient,
  msg: NativePushMessage,
): Promise<NativePushResult> {
  if (!isNativePushConfigured()) {
    return { attempted: 0, sent: 0, skipped: true };
  }

  const { data, error } = await supabase
    .from('device_push_tokens')
    .select('token, platform')
    .eq('user_id', msg.recipientUserId)
    .eq('is_active', true);

  if (error) {
    console.error('[native-push] Failed to load device tokens:', error.message);
    return { attempted: 0, sent: 0, skipped: false };
  }

  const rows = (data ?? []) as DeviceTokenRow[];
  const androidTokens = rows.filter((r) => r.platform === 'android').map((r) => r.token);
  const iosTokens = rows.filter((r) => r.platform === 'ios').map((r) => r.token);

  const [fcmSent, apnsSent] = await Promise.all([
    sendFcm(supabase, androidTokens, msg).catch((err) => {
      console.warn('[native-push] FCM batch error:', err);
      return 0;
    }),
    sendApns(supabase, iosTokens, msg).catch((err) => {
      console.warn('[native-push] APNs batch error:', err);
      return 0;
    }),
  ]);

  return { attempted: rows.length, sent: fcmSent + apnsSent, skipped: false };
}

/**
 * Native push delivery for the Capacitor mobile app.
 *
 * Web Push (VAPID) lives in pushNotifications.ts; this module delivers to the
 * APNs/FCM device tokens stored in `device_push_tokens` by the mobile client
 * (see src/lib/mobile.ts + supabase/migrations/0045_device_push_tokens.sql):
 *   - Android tokens  → Firebase Cloud Messaging HTTP v1 API
 *   - iOS tokens      → Apple Push Notification service (apns2, .p8 token auth)
 *
 * FCM is called over plain HTTPS using a service-account JWT signed with the
 * built-in `node:crypto` module — no Firebase SDK dependency (see AGENTS.md
 * "No Firebase"). Both transports are gated behind environment configuration
 * and no-op cleanly when their credentials are absent, so deployments without
 * push secrets are unaffected. Tokens that providers report as stale/invalid
 * are deactivated.
 */
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface NativePushMessage {
  recipientUserId: string;
  title: string;
  body: string;
  url: string;
  /** Custom key/value payload; coerced to strings for FCM compatibility. */
  data?: Record<string, unknown>;
  /** Collapse/thread key (FCM collapse_key, APNs collapseId). */
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

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};

// apns2 is imported lazily so it's only loaded when configured.
type ApnsClient = import('apns2').ApnsClient;

const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'org.bloodsweatcode.app';
const FCM_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let serviceAccount: ServiceAccount | null | undefined;
let cachedAccessToken: { value: string; expiresAt: number } | null = null;
let apnsClient: ApnsClient | null | undefined;

function getServiceAccount(): ServiceAccount | null {
  if (serviceAccount !== undefined) return serviceAccount;
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) {
    serviceAccount = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
      throw new Error('service account JSON missing client_email/private_key/project_id');
    }
    serviceAccount = parsed;
  } catch (err) {
    console.error('[native-push] Invalid FCM_SERVICE_ACCOUNT:', err);
    serviceAccount = null;
  }
  return serviceAccount;
}

function isFcmConfigured(): boolean {
  return getServiceAccount() !== null;
}

function isApnsConfigured(): boolean {
  return Boolean(process.env.APNS_KEY && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID);
}

export function isNativePushConfigured(): boolean {
  return isFcmConfigured() || isApnsConfigured();
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Mint (and cache) a Google OAuth2 access token from the service account. */
async function getFcmAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt - 60 > now) {
    return cachedAccessToken.value;
  }

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: FCM_SCOPE,
      aud: FCM_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = base64url(
    crypto.createSign('RSA-SHA256').update(signingInput).sign(sa.private_key),
  );
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(FCM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    console.error('[native-push] FCM token exchange failed:', res.status, await res.text());
    return null;
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  cachedAccessToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600),
  };
  return json.access_token;
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
  const sa = getServiceAccount();
  if (!sa || tokens.length === 0) return 0;

  const accessToken = await getFcmAccessToken(sa);
  if (!accessToken) return 0;

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const data = { ...stringifyData(msg.data), url: msg.url, title: msg.title, body: msg.body };
  const android = {
    priority: msg.highPriority ? 'HIGH' : 'NORMAL',
    ...(msg.tag ? { collapse_key: msg.tag } : {}),
    notification: msg.tag ? { tag: msg.tag } : {},
  };

  let sent = 0;
  await Promise.all(
    tokens.map(async (token) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: { token, notification: { title: msg.title, body: msg.body }, data, android },
          }),
        });

        if (res.ok) {
          sent += 1;
          return;
        }

        const errBody = (await res.json().catch(() => ({}))) as {
          error?: { status?: string; details?: Array<{ errorCode?: string }> };
        };
        const status = errBody.error?.status;
        const errorCode = errBody.error?.details?.find((d) => d.errorCode)?.errorCode;
        if (
          res.status === 404 ||
          status === 'NOT_FOUND' ||
          errorCode === 'UNREGISTERED' ||
          errorCode === 'INVALID_ARGUMENT'
        ) {
          await deactivateToken(supabase, token);
        } else {
          console.warn('[native-push] FCM delivery failed:', res.status, status || errorCode);
        }
      } catch (err) {
        console.warn('[native-push] FCM request error:', err);
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

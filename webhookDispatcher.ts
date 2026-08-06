import { lookup } from 'dns/promises';
import { isIP } from 'net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from './serverSupabase.js';

// Built on first dispatch rather than at import: the module-level client threw
// during import when Supabase env vars were absent, which took down anything that
// merely referenced this file.
let client: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!client) client = createServerSupabaseClient();
  return client;
}

/**
 * Whether an address is inside a range the server should never be talked into
 * reaching on a caller's behalf: loopback, link-local (which is where cloud
 * instance metadata lives), and the private IPv4/IPv6 ranges.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT
    return false;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fe80') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    // IPv4-mapped (::ffff:127.0.0.1) has to be checked as IPv4.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}

/**
 * Bot owners choose their own `webhook_url`, and this process posts to it with the
 * service role, so an unvalidated URL made the server a proxy into its own
 * network — cloud metadata, internal APIs, anything reachable from the host.
 *
 * Resolution happens here rather than trusting the hostname, so pointing a public
 * domain at 127.0.0.1 does not get through either.
 */
export async function assertDispatchableWebhookUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`invalid webhook URL: ${rawUrl}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`unsupported webhook scheme: ${url.protocol}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error(`webhook target is a private address: ${hostname}`);
    return url;
  }

  if (/(^|\.)localhost$/i.test(hostname) || /\.local$/i.test(hostname) || /\.internal$/i.test(hostname)) {
    throw new Error(`webhook target resolves to a local name: ${hostname}`);
  }

  const resolved = await lookup(hostname, { all: true });
  if (resolved.length === 0) throw new Error(`webhook host does not resolve: ${hostname}`);
  const privateHit = resolved.find((entry) => isPrivateAddress(entry.address));
  if (privateHit) {
    throw new Error(`webhook host resolves to a private address: ${hostname} -> ${privateHit.address}`);
  }

  return url;
}

export async function dispatchWebhookEvent(eventType: string, targetUserId: string, payload: any) {
  try {
    // Find active subscriptions for this user and event type
    const { data: subscriptions, error } = await getSupabase()
      .from('bot_webhook_subscriptions')
      .select('webhook_url, secret')
      .eq('bot_user_id', targetUserId)
      .eq('is_active', true)
      .contains('events', `["${eventType}"]`);

    if (error || !subscriptions || subscriptions.length === 0) return;

    // Dispatch to all matching subscriptions
    for (const sub of subscriptions) {
      try {
        await assertDispatchableWebhookUrl(sub.webhook_url);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'BSC-Webhook-Dispatcher/1.0'
        };

        if (sub.secret) {
          headers['X-BSC-Signature'] = sub.secret; // In production, use HMAC
        }

        // Bot-supplied URLs are arbitrary hosts, so a slow or hanging endpoint
        // must not hold this dispatch open indefinitely.
        await fetch(sub.webhook_url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            event: eventType,
            timestamp: new Date().toISOString(),
            data: payload
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000)
        });
      } catch (fetchErr) {
        console.error(`[Webhook] Failed to dispatch ${eventType} to ${sub.webhook_url}:`, fetchErr);
      }
    }
  } catch (err) {
    console.error('[Webhook] Dispatch error:', err);
  }
}

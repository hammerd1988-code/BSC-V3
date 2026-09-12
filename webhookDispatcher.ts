import type { SupabaseClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { createServerSupabaseClient } from './serverSupabase.js';
import { assertPublicHttpUrl } from './outboundUrl.js';

// Built on first dispatch rather than at import: the module-level client threw
// during import when Supabase env vars were absent, which took down anything that
// merely referenced this file.
let client: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!client) client = createServerSupabaseClient();
  return client;
}

/**
 * Bot owners choose their own `webhook_url`, and this process posts to it with the
 * service role, so an unvalidated URL made the server a proxy into its own
 * network — cloud metadata, internal APIs, anything reachable from the host.
 *
 * `allowHttp` keeps endpoints already registered over plain http working; the
 * point of the check is the target, not the scheme. The Studio asset loader
 * shares the same guard with `allowHttp` off.
 */
export async function assertDispatchableWebhookUrl(rawUrl: string): Promise<URL> {
  const { url } = await assertPublicHttpUrl(rawUrl, { label: 'webhook URL', allowHttp: true });
  return url;
}

/**
 * Validating the hostname and then fetching it by name resolves DNS twice, and a
 * subscriber controls what the second answer is: a host that is public when
 * checked can point at 169.254.169.254 microseconds later, and the payload goes
 * to the internal target instead. Connect to the address the guard actually
 * approved and carry the original Host header, the way `casperEmbedProbe.ts`
 * already does for its probes.
 */
export function pinUrlToAddress(url: URL, resolvedAddress: string | null): { target: string; hostHeader: string | null } {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!resolvedAddress || isIP(hostname)) return { target: url.toString(), hostHeader: null };

  const pinned = new URL(url.toString());
  const hostHeader = pinned.host;
  pinned.hostname = resolvedAddress.includes(':') ? `[${resolvedAddress}]` : resolvedAddress;
  return { target: pinned.toString(), hostHeader };
}

/**
 * Sign the exact bytes that go on the wire. The header used to carry the shared
 * secret itself, so a receiver could not tell a genuine delivery from a replay,
 * and anyone who saw one delivery (plain http is permitted for subscribers who
 * registered that way) held the credential for every future one.
 */
export function signWebhookBody(secret: string, body: string, timestamp: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
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
        const { url, resolvedAddress } = await assertPublicHttpUrl(sub.webhook_url, {
          label: 'webhook URL',
          allowHttp: true,
        });

        const timestamp = new Date().toISOString();
        const body = JSON.stringify({ event: eventType, timestamp, data: payload });

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'BSC-Webhook-Dispatcher/1.0'
        };

        if (sub.secret) {
          headers['X-BSC-Timestamp'] = timestamp;
          headers['X-BSC-Signature'] = `sha256=${signWebhookBody(sub.secret, body, timestamp)}`;
        }

        const { target, hostHeader } = pinUrlToAddress(url, resolvedAddress);
        if (hostHeader) headers.Host = hostHeader;

        // Bot-supplied URLs are arbitrary hosts, so a slow or hanging endpoint
        // must not hold this dispatch open indefinitely. Redirects are refused
        // because the guard only vetted the first hop.
        await fetch(target, {
          method: 'POST',
          headers,
          body,
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

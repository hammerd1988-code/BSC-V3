import type { SupabaseClient } from '@supabase/supabase-js';
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
        // Bot owners choose their own webhook_url and this runs with the service
        // role, so an unvalidated target made the server a proxy into its own
        // network (cloud metadata, localhost APIs).
        // allowHttp keeps already-registered plain-http endpoints working; the
        // point of the check is the target, not the scheme.
        await assertPublicHttpUrl(sub.webhook_url, { label: 'webhook URL', allowHttp: true });

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

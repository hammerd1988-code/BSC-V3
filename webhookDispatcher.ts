import { createServerSupabaseClient } from './serverSupabase.js';

const supabase = createServerSupabaseClient();

export async function dispatchWebhookEvent(eventType: string, targetUserId: string, payload: any) {
  try {
    // Find active subscriptions for this user and event type
    const { data: subscriptions, error } = await supabase
      .from('bot_webhook_subscriptions')
      .select('webhook_url, secret')
      .eq('bot_user_id', targetUserId)
      .eq('is_active', true)
      .contains('events', `["${eventType}"]`);

    if (error || !subscriptions || subscriptions.length === 0) return;

    // Dispatch to all matching subscriptions
    for (const sub of subscriptions) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'BSC-Webhook-Dispatcher/1.0'
        };

        if (sub.secret) {
          headers['X-BSC-Signature'] = sub.secret; // In production, use HMAC
        }

        await fetch(sub.webhook_url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            event: eventType,
            timestamp: new Date().toISOString(),
            data: payload
          })
        });
      } catch (fetchErr) {
        console.error(`[Webhook] Failed to dispatch ${eventType} to ${sub.webhook_url}:`, fetchErr);
      }
    }
  } catch (err) {
    console.error('[Webhook] Dispatch error:', err);
  }
}

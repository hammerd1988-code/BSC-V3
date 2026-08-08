import { dispatchWebhookEvent } from './webhookDispatcher.js';
import { createServerSupabaseClient } from './serverSupabase.js';

const supabase = createServerSupabaseClient();

export function initWebhookListener() {
  console.log('[WebhookListener] Initializing realtime subscription for bot webhooks...');

  // Listen for new DMs
  supabase.channel('bot-webhooks-dms')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (payload) => {
      const dm = payload.new;
      // Dispatch to the recipient
      dispatchWebhookEvent('dm', dm.recipient_id, dm);
    })
    .subscribe();

  // Listen for new Comments (which might be replies to a bot's post)
  supabase.channel('bot-webhooks-comments')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, async (payload) => {
      // Realtime callbacks have no caller to catch a rejection, so a transient
      // query failure here would surface as an unhandled rejection.
      try {
        const comment = payload.new;

        // Get the post to see who the author is
        const { data: post } = await supabase.from('posts').select('author_id').eq('id', comment.post_id).maybeSingle();
        if (post && post.author_id !== comment.author_id) {
          await dispatchWebhookEvent('comment', post.author_id, { comment, post_id: comment.post_id });
        }
      } catch (error) {
        console.error('[WebhookListener] comment dispatch failed:', error);
      }
    })
    .subscribe();
    
  // Listen for new notifications (mentions)
  supabase.channel('bot-webhooks-notifications')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
      const notification = payload.new;
      if (notification.type === 'mention') {
        dispatchWebhookEvent('mention', notification.user_id, notification);
      }
    })
    .subscribe();
}

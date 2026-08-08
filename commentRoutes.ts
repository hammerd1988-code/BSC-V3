import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireCasperAuth } from './casperControlCenter.js';
import { createRateLimiter } from './serverSecurity.js';

const MAX_BOT_REPLY_LENGTH = 4000;

/**
 * Which bot a caller may speak as on a given post: the post's own bot author, or
 * a bot they @mentioned in one of their own comments there. Mirrors how
 * `CommentsModal` picks the bots it asks for, so no legitimate call changes.
 */
export function botMayReply(input: {
  botId: string;
  botUsername?: string | null;
  postAuthorId?: string | null;
  comments: Array<{ content?: string | null }>;
}): boolean {
  if (input.postAuthorId && String(input.postAuthorId) === String(input.botId)) return true;
  const username = (input.botUsername ?? '').trim().toLowerCase();
  if (!username) return false;
  const mention = `@${username}`;
  return input.comments.some((comment) => (comment.content ?? '').toLowerCase().includes(mention));
}

// Bot rows in `public.users` carry an `auth_uid`, but no bot ever signs in, so
// a browser session can never satisfy an owner-scoped RLS insert on their
// behalf. Bot replies are therefore written here with the service-role client.
// Doing it server-side also means the `comments` insert policy can stay
// strictly owner-scoped instead of carrying a client-forgeable bot exemption.
export function registerCommentRoutes(app: Express, supabase: SupabaseClient) {
  const botReplyRateLimit = createRateLimiter({ name: 'bot replies', windowMs: 60_000, max: 30 });

  app.post('/api/comments/bot-reply', botReplyRateLimit, async (req: Request, res: Response) => {
    const profile = await requireCasperAuth(req, res, supabase);
    if (!profile) return;

    const postId = typeof req.body?.postId === 'string' ? req.body.postId : '';
    const botId = typeof req.body?.botId === 'string' ? req.body.botId : '';
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';

    if (!postId || !botId || !content) {
      return res.status(400).json({ error: 'postId, botId, and content are required.' });
    }
    if (content.length > MAX_BOT_REPLY_LENGTH) {
      return res.status(400).json({ error: 'Reply exceeds the maximum comment length.' });
    }

    const { data: bot, error: botError } = await supabase
      .from('users')
      .select('id,type,username')
      .eq('id', botId)
      .maybeSingle();

    if (botError) {
      console.error('[comments:bot-reply] bot lookup failed', botError);
      return res.status(500).json({ error: 'Unable to verify the replying bot.' });
    }
    if (!bot || bot.type !== 'bot') {
      return res.status(403).json({ error: 'Replies may only be authored by bot accounts.' });
    }

    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id,author_id')
      .eq('id', postId)
      .maybeSingle();

    if (postError) {
      console.error('[comments:bot-reply] post lookup failed', postError);
      return res.status(500).json({ error: 'Unable to verify the target post.' });
    }
    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    // The caller must already be part of the thread. Without this an authed
    // client could post arbitrary text under any bot on any post.
    const { data: ownComments, error: participationError } = await supabase
      .from('comments')
      .select('content')
      .eq('post_id', postId)
      .eq('author_id', profile.id);

    if (participationError) {
      console.error('[comments:bot-reply] participation check failed', participationError);
      return res.status(500).json({ error: 'Unable to verify thread participation.' });
    }
    if (!ownComments || ownComments.length === 0) {
      return res.status(403).json({ error: 'Comment on the post before requesting a bot reply.' });
    }

    // Participation alone was not enough: one comment anywhere on a thread let a
    // caller publish arbitrary text under *any* bot account. The client only
    // ever asks for a reply from the post's own bot author or a bot the caller
    // @mentioned, so require exactly that.
    if (!botMayReply({ botId, botUsername: bot.username, postAuthorId: post.author_id, comments: ownComments })) {
      return res.status(403).json({
        error: 'That bot is neither the author of this post nor mentioned in your comment.',
      });
    }

    const { data: inserted, error: insertError } = await supabase
      .from('comments')
      .insert({
        post_id: postId,
        author_id: botId,
        content,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error('[comments:bot-reply] insert failed', insertError);
      return res.status(500).json({ error: 'Failed to store the bot reply.' });
    }

    const { error: counterError } = await supabase.rpc('increment_counter', {
      p_table: 'posts',
      p_id: postId,
      p_field: 'comments_count',
      p_amount: 1,
    });
    if (counterError) {
      console.error('[comments:bot-reply] comment counter increment failed', counterError);
    }

    return res.json({ success: true, comment: inserted });
  });
}

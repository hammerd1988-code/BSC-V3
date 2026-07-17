import { supabase } from '../supabase';
import { socket } from './socket';
import { handleDbError } from './errors';
import type { User } from '../types';

export interface ReplayLike {
  id: string;
  title?: string | null;
  replay_url?: string | null;
  thumbnail_url?: string | null;
  category?: string | null;
}

/** Escape HTML-significant characters so user-controlled text can't inject markup. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Absolute playback link for a stream/replay, reusing the copyStreamLink pattern. */
export const streamLink = (streamId: string): string =>
  `${window.location.origin}/golive?streamId=${encodeURIComponent(streamId)}`;

/** Copy a stream/replay playback link to the clipboard. Returns true on success. */
export const shareStreamLink = async (streamId: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(streamLink(streamId));
    return true;
  } catch {
    return false;
  }
};

/**
 * Repost a replay to the social feed. Creates a post referencing the replay,
 * embedding the replay media (or thumbnail) and a link back to playback.
 * Reuses the same posts-table shape the CreatePostModal uses.
 */
export const repostReplayToFeed = async (
  replay: ReplayLike,
  currentUser: Pick<User, 'id'>
): Promise<boolean> => {
  const title = escapeHtml(replay.title?.trim() || 'Live broadcast');
  const category = replay.category ? escapeHtml(String(replay.category)) : '';
  const link = streamLink(replay.id);
  const mediaUrl = replay.replay_url || replay.thumbnail_url || null;
  const mediaType = replay.replay_url ? ('video' as const) : replay.thumbnail_url ? ('image' as const) : null;

  const content = [
    `<p>📺 Replay: ${title}</p>`,
    category ? `<p>${category} broadcast</p>` : '',
    `<p><a href="${link}">Watch the replay →</a></p>`,
  ].join('');

  const newPost = {
    author_id: currentUser.id,
    content,
    media_url: mediaUrl,
    media_type: mediaType,
    likes: 0,
    boosts: 0,
    comments_count: 0,
    is_boosted: false,
    type: mediaUrl ? ('media' as const) : ('text' as const),
    view_count: 0,
  };

  const { data: inserted, error } = await supabase
    .from('posts')
    .insert(newPost)
    .select()
    .maybeSingle();

  if (error) {
    handleDbError(error, 'CREATE', 'posts');
    return false;
  }

  const postResult = inserted ?? { ...newPost, id: `replay-repost-${replay.id}-${Date.now()}`, created_at: new Date().toISOString() };
  try { socket.emit('post:create', postResult); } catch { /* socket optional */ }
  return true;
};

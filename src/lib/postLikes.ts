/**
 * Post likes.
 *
 * The heart button used to be pure theatre: `PostCard` flipped a local boolean
 * and `Feed` emitted a `post:like` socket event, which the server only
 * re-broadcast as an activity toast. Nothing ever wrote `post_likes`, so the
 * counter never moved, the heart was empty again after a reload, and unliking
 * was impossible. `Profile` did not even pass a handler.
 *
 * `post_likes` already carries a `security definer` trigger
 * (`sync_post_like_count`) that keeps `posts.likes` and `posts.likes_count` in
 * step, so writing the join row is the whole job — never touch the counters
 * directly or they get counted twice.
 */
import { supabase } from '../supabase';

export interface LikeablePost {
  id: string;
  likes?: number;
  likes_count?: number;
  is_liked?: boolean;
}

interface QueryError {
  message: string;
  code?: string;
}

/**
 * The slice of Supabase this module uses, named so tests can supply a fake
 * without standing up a client.
 */
export interface PostLikeGateway {
  listLikedPostIds(userId: string, postIds: string[]): Promise<{ data: string[] | null; error: QueryError | null }>;
  like(userId: string, postId: string): Promise<{ error: QueryError | null }>;
  unlike(userId: string, postId: string): Promise<{ error: QueryError | null }>;
}

/**
 * PostgREST puts filters in the query string, so a whole feed page of ids has to
 * go in batches or the URL outgrows what the gateway in front of it accepts.
 */
export const LIKE_LOOKUP_BATCH_SIZE = 100;

/** Unique-violation: the row is already there, which is the state we wanted. */
const ALREADY_EXISTS = '23505';

export function batchIds(ids: string[], size: number = LIKE_LOOKUP_BATCH_SIZE): string[][] {
  if (size < 1) throw new Error('batch size must be positive');
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size) batches.push(ids.slice(i, i + size));
  return batches;
}

export const supabaseLikeGateway: PostLikeGateway = {
  async listLikedPostIds(userId, postIds) {
    const { data, error } = await supabase
      .from('post_likes')
      .select('post_id')
      .eq('user_id', userId)
      .in('post_id', postIds);
    return {
      data: data ? (data as { post_id: string }[]).map((row) => row.post_id) : null,
      error,
    };
  },
  async like(userId, postId) {
    const { error } = await supabase
      .from('post_likes')
      .insert({ post_id: postId, user_id: userId, created_at: new Date().toISOString() });
    return { error };
  },
  async unlike(userId, postId) {
    const { error } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);
    return { error };
  },
};

/** Which of `postIds` this user has already liked. Throws if the lookup fails. */
export async function fetchLikedPostIds(
  userId: string,
  postIds: string[],
  gateway: PostLikeGateway = supabaseLikeGateway,
): Promise<Set<string>> {
  const unique = [...new Set(postIds.filter(Boolean))];
  if (!userId || unique.length === 0) return new Set();

  const liked = new Set<string>();
  for (const batch of batchIds(unique)) {
    const { data, error } = await gateway.listLikedPostIds(userId, batch);
    if (error) throw new Error(error.message);
    for (const id of data ?? []) liked.add(id);
  }
  return liked;
}

/**
 * Stamps `is_liked` onto a page of posts. Returns the same array instance when
 * nothing changes — the feed is virtualised, and a fresh array on every render
 * would remount every row.
 */
export function withLikedFlags<T extends LikeablePost>(posts: T[], likedIds: Set<string>): T[] {
  let changed = false;
  const next = posts.map((post) => {
    const liked = likedIds.has(post.id);
    if (post.is_liked === liked) return post;
    changed = true;
    return { ...post, is_liked: liked };
  });
  return changed ? next : posts;
}

/**
 * Best-effort hydration for a freshly fetched page. A failed lookup leaves the
 * hearts empty rather than failing the whole feed load, which is the tradeoff
 * every caller wants — the posts themselves are already on screen.
 */
export async function attachLikeState<T extends LikeablePost>(
  posts: T[],
  userId: string | null | undefined,
  gateway: PostLikeGateway = supabaseLikeGateway,
): Promise<T[]> {
  if (!userId || posts.length === 0) return posts;
  try {
    const liked = await fetchLikedPostIds(userId, posts.map((post) => post.id), gateway);
    return withLikedFlags(posts, liked);
  } catch (error) {
    console.warn('[likes] could not load like state:', error);
    return posts;
  }
}

/** Applies a completed like/unlike to a list, keeping both counter columns in step. */
export function applyLikeToPosts<T extends LikeablePost>(posts: T[], postId: string, liked: boolean): T[] {
  let changed = false;
  const next = posts.map((post) => {
    if (post.id !== postId || post.is_liked === liked) return post;
    changed = true;
    return {
      ...post,
      is_liked: liked,
      likes: nextCount(post.likes, liked),
      likes_count: nextCount(post.likes_count, liked),
    };
  });
  return changed ? next : posts;
}

/** Counters are `not null default 0` in Postgres and must never read negative. */
export function nextCount(current: number | undefined, liked: boolean): number {
  const base = typeof current === 'number' && Number.isFinite(current) ? current : 0;
  return liked ? base + 1 : Math.max(0, base - 1);
}

/**
 * Writes the like row. Idempotent in both directions: liking something already
 * liked and unliking something already gone both resolve, because the button
 * can be double-tapped and two tabs can disagree.
 */
export async function setPostLike(
  userId: string,
  postId: string,
  liked: boolean,
  gateway: PostLikeGateway = supabaseLikeGateway,
): Promise<void> {
  if (!userId || !postId) throw new Error('setPostLike needs a user and a post');
  const { error } = liked ? await gateway.like(userId, postId) : await gateway.unlike(userId, postId);
  if (!error) return;
  if (liked && error.code === ALREADY_EXISTS) return;
  throw new Error(error.message);
}

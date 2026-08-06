import { describe, expect, it, vi } from 'vitest';
import {
  LIKE_LOOKUP_BATCH_SIZE,
  type PostLikeGateway,
  applyLikeToPosts,
  attachLikeState,
  batchIds,
  fetchLikedPostIds,
  nextCount,
  setPostLike,
  withLikedFlags,
} from './postLikes';

function gateway(overrides: Partial<PostLikeGateway> = {}): PostLikeGateway {
  return {
    listLikedPostIds: async () => ({ data: [], error: null }),
    like: async () => ({ error: null }),
    unlike: async () => ({ error: null }),
    ...overrides,
  };
}

describe('fetchLikedPostIds', () => {
  it('batches the lookup so the query string stays short', async () => {
    const seen: string[][] = [];
    const ids = Array.from({ length: LIKE_LOOKUP_BATCH_SIZE * 2 + 5 }, (_, i) => `p${i}`);
    const liked = await fetchLikedPostIds(
      'u1',
      ids,
      gateway({
        listLikedPostIds: async (_userId, postIds) => {
          seen.push(postIds);
          return { data: [postIds[0]], error: null };
        },
      }),
    );

    expect(seen.map((batch) => batch.length)).toEqual([LIKE_LOOKUP_BATCH_SIZE, LIKE_LOOKUP_BATCH_SIZE, 5]);
    expect([...liked].sort()).toEqual(['p0', 'p100', 'p200'].sort());
  });

  it('de-duplicates ids and skips the round trip when there is nothing to ask about', async () => {
    const list = vi.fn(async () => ({ data: [], error: null }));
    await fetchLikedPostIds('u1', [], gateway({ listLikedPostIds: list }));
    await fetchLikedPostIds('', ['p1'], gateway({ listLikedPostIds: list }));
    expect(list).not.toHaveBeenCalled();

    await fetchLikedPostIds('u1', ['p1', 'p1', 'p2'], gateway({ listLikedPostIds: list }));
    expect(list).toHaveBeenCalledWith('u1', ['p1', 'p2']);
  });

  it('reports a failed lookup instead of pretending nothing is liked', async () => {
    await expect(
      fetchLikedPostIds('u1', ['p1'], gateway({
        listLikedPostIds: async () => ({ data: null, error: { message: 'permission denied' } }),
      })),
    ).rejects.toThrow('permission denied');
  });
});

describe('attachLikeState', () => {
  it('marks the posts this user liked', async () => {
    const posts = [{ id: 'p1' }, { id: 'p2' }];
    const hydrated = await attachLikeState(posts, 'u1', gateway({
      listLikedPostIds: async () => ({ data: ['p2'], error: null }),
    }));
    expect(hydrated).toEqual([{ id: 'p1', is_liked: false }, { id: 'p2', is_liked: true }]);
  });

  it('leaves the page alone when the lookup fails, rather than failing the feed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const posts = [{ id: 'p1', is_liked: true }];
    const hydrated = await attachLikeState(posts, 'u1', gateway({
      listLikedPostIds: async () => ({ data: null, error: { message: 'offline' } }),
    }));
    expect(hydrated).toBe(posts);
    warn.mockRestore();
  });

  it('is a no-op for a signed-out reader', async () => {
    const posts = [{ id: 'p1' }];
    expect(await attachLikeState(posts, null)).toBe(posts);
  });
});

describe('withLikedFlags', () => {
  it('returns the same array when every flag already matches', () => {
    const posts = [{ id: 'p1', is_liked: true }, { id: 'p2', is_liked: false }];
    expect(withLikedFlags(posts, new Set(['p1']))).toBe(posts);
  });

  it('only replaces the rows whose flag changed', () => {
    const posts = [{ id: 'p1', is_liked: false }, { id: 'p2', is_liked: false }];
    const next = withLikedFlags(posts, new Set(['p2']));
    expect(next).not.toBe(posts);
    expect(next[0]).toBe(posts[0]);
    expect(next[1]).toEqual({ id: 'p2', is_liked: true });
  });
});

describe('applyLikeToPosts', () => {
  it('moves both counter columns, which the database trigger also keeps in step', () => {
    const posts = [{ id: 'p1', likes: 4, likes_count: 4, is_liked: false }];
    expect(applyLikeToPosts(posts, 'p1', true)[0]).toEqual({
      id: 'p1', likes: 5, likes_count: 5, is_liked: true,
    });
  });

  it('never shows a negative count when the local number is already behind', () => {
    const posts = [{ id: 'p1', likes: 0, likes_count: 0, is_liked: true }];
    expect(applyLikeToPosts(posts, 'p1', false)[0]).toEqual({
      id: 'p1', likes: 0, likes_count: 0, is_liked: false,
    });
  });

  it('ignores a repeat of the state the post is already in', () => {
    const posts = [{ id: 'p1', likes: 3, likes_count: 3, is_liked: true }];
    expect(applyLikeToPosts(posts, 'p1', true)).toBe(posts);
  });
});

describe('nextCount', () => {
  it('treats a missing or non-numeric counter as zero', () => {
    expect(nextCount(undefined, true)).toBe(1);
    expect(nextCount(Number.NaN, true)).toBe(1);
    expect(nextCount(undefined, false)).toBe(0);
  });
});

describe('setPostLike', () => {
  it('inserts on like and deletes on unlike', async () => {
    const like = vi.fn(async () => ({ error: null }));
    const unlike = vi.fn(async () => ({ error: null }));
    await setPostLike('u1', 'p1', true, gateway({ like, unlike }));
    await setPostLike('u1', 'p1', false, gateway({ like, unlike }));
    expect(like).toHaveBeenCalledWith('u1', 'p1');
    expect(unlike).toHaveBeenCalledWith('u1', 'p1');
  });

  it('accepts a like that is already recorded', async () => {
    await expect(
      setPostLike('u1', 'p1', true, gateway({
        like: async () => ({ error: { message: 'duplicate key', code: '23505' } }),
      })),
    ).resolves.toBeUndefined();
  });

  it('surfaces a real write failure so the button can roll back', async () => {
    await expect(
      setPostLike('u1', 'p1', true, gateway({
        like: async () => ({ error: { message: 'row-level security', code: '42501' } }),
      })),
    ).rejects.toThrow('row-level security');
  });
});

describe('batchIds', () => {
  it('rejects a non-positive batch size instead of looping forever', () => {
    expect(() => batchIds(['a'], 0)).toThrow();
  });
});

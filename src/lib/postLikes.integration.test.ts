// @vitest-environment node
/**
 * End-to-end check of the like flow against a real Postgres.
 *
 * The unit tests above it cover the module's own branching with a fake gateway.
 * This one wires the same functions to the schema the migration chain actually
 * produces (PGlite), because the part that was broken in production was
 * precisely the seam between them: the client wrote nothing, and the code that
 * did write went at the counters directly instead of letting the
 * `post_likes_sync_count` trigger move them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, createDatabase, type PgLiteLike } from '../../scripts/migrationHarness';
import { type LikeablePost, type PostLikeGateway, attachLikeState, setPostLike } from './postLikes';

let db: PgLiteLike;

/** The same operations supabaseLikeGateway performs, issued as plain SQL. */
const gateway: PostLikeGateway = {
  async listLikedPostIds(userId, postIds) {
    const { rows } = await db.query<{ post_id: string }>(
      `select post_id from public.post_likes where user_id = $1 and post_id = any($2::text[])`,
      [userId, postIds],
    );
    return { data: rows.map((row) => row.post_id), error: null };
  },
  async like(userId, postId) {
    try {
      await db.query(`insert into public.post_likes (post_id, user_id) values ($1, $2)`, [postId, userId]);
      return { error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: { message, code: /duplicate key/i.test(message) ? '23505' : undefined } };
    }
  },
  async unlike(userId, postId) {
    await db.query(`delete from public.post_likes where post_id = $1 and user_id = $2`, [postId, userId]);
    return { error: null };
  },
};

async function counters(postId: string) {
  const { rows } = await db.query<{ likes: number; likes_count: number }>(
    `select likes, likes_count from public.posts where id = $1`,
    [postId],
  );
  return { likes: Number(rows[0]?.likes), likesCount: Number(rows[0]?.likes_count) };
}

beforeAll(async () => {
  db = await createDatabase();
  await applyMigrations(db);
  await db.query(`insert into public.users (id, username, display_name) values ('reader', 'reader', 'Reader')`);
  await db.query(`insert into public.posts (id, author_id, content) values ('p1', 'reader', 'one')`);
  await db.query(`insert into public.posts (id, author_id, content) values ('p2', 'reader', 'two')`);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('the like flow against the real schema', () => {
  it('persists a like, moves both counters, and survives a reload', async () => {
    const page: LikeablePost[] = [{ id: 'p1', likes: 0, likes_count: 0 }, { id: 'p2', likes: 0, likes_count: 0 }];
    expect(await attachLikeState(page, 'reader', gateway)).toEqual([
      { id: 'p1', likes: 0, likes_count: 0, is_liked: false },
      { id: 'p2', likes: 0, likes_count: 0, is_liked: false },
    ]);

    await setPostLike('reader', 'p1', true, gateway);
    expect(await counters('p1')).toEqual({ likes: 1, likesCount: 1 });

    // "Reload": a fresh page fetch has to come back with the heart still filled.
    const reloaded = await attachLikeState(page, 'reader', gateway);
    expect(reloaded[0].is_liked).toBe(true);
    expect(reloaded[1].is_liked).toBe(false);
  });

  it('treats a double tap as already liked instead of failing', async () => {
    await expect(setPostLike('reader', 'p1', true, gateway)).resolves.toBeUndefined();
    expect(await counters('p1')).toEqual({ likes: 1, likesCount: 1 });
  });

  it('unlikes, and an unlike of something already gone is not an error', async () => {
    await setPostLike('reader', 'p1', false, gateway);
    expect(await counters('p1')).toEqual({ likes: 0, likesCount: 0 });

    await expect(setPostLike('reader', 'p1', false, gateway)).resolves.toBeUndefined();
    expect(await counters('p1')).toEqual({ likes: 0, likesCount: 0 });

    const reloaded = await attachLikeState<LikeablePost>([{ id: 'p1' }], 'reader', gateway);
    expect(reloaded[0].is_liked).toBe(false);
  });
});

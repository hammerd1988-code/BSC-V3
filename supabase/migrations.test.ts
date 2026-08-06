// @vitest-environment node
/**
 * Guards the SQL schema in two directions:
 *
 *  1. every migration still applies to an empty database, in filename order;
 *  2. the columns, tables and functions the application writes to actually exist
 *     at the end of the chain.
 *
 * Both directions had already broken in production. Migration 0017 indexed
 * `transmits.receiver_id` without creating it, 0038 used `create policy if not
 * exists` (not valid Postgres), 0029/0045/0057/0058 declared uuid columns with
 * foreign keys onto text primary keys, 0040 renamed tier values before relaxing
 * the CHECK, and `users.onboarding_complete`/`users.friend_requests` were written
 * by the client but never added — and PostgREST rejects an entire payload that
 * names an unknown column, so those updates silently discarded valid fields too.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  createDatabase,
  migrationFiles,
  migrationVersion,
  readMigration,
  revokedPrivileges,
  type MigrationFailure,
  type PgLiteLike,
} from '../scripts/migrationHarness';

/** Columns the app reads or writes that no test would otherwise notice losing. */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  users: [
    'onboarding_complete',
    'friend_requests',
    'current_streak',
    'longest_streak',
    'last_active_date',
    'referral_count',
    'profile_theme',
    'profile_sections',
    'profile_music_url',
    'profile_music_title',
    'profile_music_artist',
    'cred_balance',
    'compute_tokens',
    'reputation_score',
    'subscription_tier',
    'friends',
    'blocked_users',
    'ai_settings',
  ],
  transmits: ['receiver_id', 'status', 'delivered_at', 'seen_at', 'attachment_url', 'encryption_key'],
  transmissions: ['participant_ids', 'unread_counts', 'typing_status', 'last_transmit'],
  notifications: ['payload', 'is_read', 'data', 'read'],
  posts: ['likes_count', 'view_count', 'updated_at', 'poll_data'],
  casper_routines: ['is_enabled', 'next_run_at', 'last_run_at'],
  casper_activity_log: ['action_type', 'description', 'metadata', 'actor_id'],
};

/** Tables whose creating migration used to abort, so they were absent at runtime. */
const REQUIRED_TABLES = [
  'bot_forge_config',
  'compute_transactions',
  'casper_skills',
  'casper_integrations',
  'device_push_tokens',
  'referrals',
  'gladiators',
];

/** Functions called via supabase.rpc(...) somewhere in the app. */
const REQUIRED_FUNCTIONS = [
  'increment_counter',
  'increment_cred_balance',
  'exchange_cred_for_tokens',
  'increment_gladiator_wins',
  'send_friend_request',
  'cancel_friend_request',
  'respond_friend_request',
  'remove_friend',
  'convert_cred_to_compute',
  'complete_colosseum_match',
];

describe('supabase migrations', () => {
  let db: PgLiteLike;
  let failures: MigrationFailure[];

  beforeAll(async () => {
    db = await createDatabase();
    failures = await applyMigrations(db);
  }, 120_000);

  it('applies the whole chain to an empty database', () => {
    expect(failures.map((failure) => `${failure.file}: ${failure.message}`)).toEqual([]);
  });

  it('ends up with every table the app queries', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const present = new Set(rows.map((row) => row.table_name));
    expect(REQUIRED_TABLES.filter((table) => !present.has(table))).toEqual([]);
  });

  it('ends up with every column the app reads or writes', async () => {
    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    );
    const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));

    const missing = Object.entries(REQUIRED_COLUMNS).flatMap(([table, columns]) =>
      columns.filter((column) => !present.has(`${table}.${column}`)).map((column) => `${table}.${column}`),
    );
    expect(missing).toEqual([]);
  });

  it('defines every function reachable through supabase.rpc()', async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`,
    );
    const present = new Set(rows.map((row) => row.proname));
    expect(REQUIRED_FUNCTIONS.filter((name) => !present.has(name))).toEqual([]);
  });

  it('keeps the transmits receiver index that 0017 could not create', async () => {
    const { rows } = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = 'transmits'`,
    );
    expect(rows.map((row) => row.indexname)).toContain('transmits_seen_idx');
  });

  it('enables row level security on every table, since the API roles are granted all', async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((row) => row.relname)).toEqual([]);
  });

  /**
   * 20260801000002_grant_public_api_roles.sql runs last and grants the API roles
   * everything, which is how a from-scratch `db reset` gets a usable schema — and
   * is also how the hardening in 0014-0063 gets silently reversed. Ask Postgres
   * whether each revoke in the sources actually still holds.
   */
  it('leaves every deliberate revoke in force at the end of the chain', async () => {
    const revoked = revokedPrivileges();
    expect(revoked.length).toBeGreaterThan(20);

    const stillGranted: string[] = [];
    for (const entry of revoked) {
      const probe =
        entry.kind === 'function'
          ? `select has_function_privilege($1, $2, $3) as granted`
          : `select has_table_privilege($1, $2, $3) as granted`;
      const { rows } = await db.query<{ granted: boolean }>(probe, [entry.role, entry.object, entry.privilege]);
      if (rows[0]?.granted) {
        stillGranted.push(`${entry.role} still has ${entry.privilege} on ${entry.object} (revoked by ${entry.file})`);
      }
    }
    expect(stillGranted).toEqual([]);
  });

  /**
   * Postgres checks the column grant before it evaluates RLS, so 0038's
   * `for select to anon using (true)` policy on gladiators did nothing until anon
   * was granted the same non-secret columns authenticated has. Both halves have
   * to stay true: the display columns readable, api_key not.
   */
  it.each(['anon', 'authenticated'])('lets %s read gladiator display columns but not api_key', async (role) => {
    const readable = await db.query<{ ok: boolean }>(
      `select bool_and(has_column_privilege($1, 'public.gladiators', column_name, 'select')) as ok
         from unnest(array['id','user_id','name','avatar_url','personality','stats','glow_color',
                           'wins','losses','cred','created_at','model','api_base_url']) as column_name`,
      [role],
    );
    expect(readable.rows[0]?.ok).toBe(true);

    const secret = await db.query<{ ok: boolean }>(
      `select has_column_privilege($1, 'public.gladiators', 'api_key', 'select') as ok`,
      [role],
    );
    expect(secret.rows[0]?.ok).toBe(false);
  });

  it('gives every migration a version prefix of its own', () => {
    const byVersion = new Map<string, string[]>();
    for (const file of migrationFiles()) {
      const version = migrationVersion(file);
      byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
    }
    const collisions = [...byVersion.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([version, files]) => `${version}: ${files.join(', ')}`);
    expect(collisions).toEqual([]);
  });
});

/**
 * 0023_subscriptions.sql and 0059_increment_counter_id_type.sql were renamed to
 * 00231_/00591_ to break a version collision. The CLI keys applied migrations on
 * that version, so on an already-migrated database the renamed files look pending
 * and get re-applied out of order — after the migrations that supersede them.
 * Re-applying them has to be a no-op.
 */
describe('renamed migrations re-applied out of order', () => {
  const RENAMED = ['00231_subscriptions.sql', '00591_increment_counter_id_type.sql'];

  let db: PgLiteLike;

  beforeAll(async () => {
    db = await createDatabase();
    await applyMigrations(db);
    for (const file of RENAMED) {
      await db.exec(readMigration(file));
    }
  }, 120_000);

  it('still downgrades a cancelled subscriber to the post-0040 tier vocabulary', async () => {
    await db.query(`insert into public.users (id, username, display_name) values ('u1', 'u1', 'u1')`);
    await db.query(
      `insert into public.subscriptions (user_id, tier, status) values ('u1', 'architect', 'active')`,
    );
    const upgraded = await db.query<{ subscription_tier: string }>(
      `select subscription_tier from public.users where id = 'u1'`,
    );
    expect(upgraded.rows[0]?.subscription_tier).toBe('architect');

    // Pre-0040 the fallback tier was 'free', which users_subscription_tier_check
    // no longer permits, so a reverted trigger makes this statement throw.
    await db.query(`update public.subscriptions set status = 'cancelled' where user_id = 'u1'`);
    const downgraded = await db.query<{ subscription_tier: string }>(
      `select subscription_tier from public.users where id = 'u1'`,
    );
    expect(downgraded.rows[0]?.subscription_tier).toBe('indie');
  });

  it('still counts through the type-resolving increment_counter from 00591', async () => {
    await db.query(
      `insert into public.users (id, username, display_name) values ('u2', 'u2', 'u2')`,
    );
    await db.query(
      `insert into public.posts (id, author_id, content) values ('p1', 'u2', 'hello')`,
    );
    await db.query(`select public.increment_counter('posts', 'p1', 'likes', 2)`);
    const { rows } = await db.query<{ likes: number }>(`select likes from public.posts where id = 'p1'`);
    expect(Number(rows[0]?.likes)).toBe(2);
  });
});

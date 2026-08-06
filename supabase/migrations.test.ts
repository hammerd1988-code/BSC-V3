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
import { applyMigrations, createDatabase, type MigrationFailure, type PgLiteLike } from '../scripts/migrationHarness';

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
  transactions: ['external_id'],
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
  'bump_public_counter',
  'spend_cred',
  'boost_post',
  'tip_post',
  'redeem_referral',
  'increment_cred_balance',
  'exchange_cred_for_tokens',
  'grant_cred_purchase',
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

  it('grants a CRED purchase exactly once per payment id', async () => {
    await db.query(
      `insert into public.users (id, username, display_name, cred_balance)
       values ('cred-buyer', 'cred_buyer', 'CRED Buyer', 0)
       on conflict (id) do update set cred_balance = 0`,
    );

    const first = await db.query<{ result: { granted: boolean; cred_balance?: number } }>(
      `select public.grant_cred_purchase('cred-buyer', 100, 'sq-payment-1', 'first') as result`,
    );
    expect(first.rows[0].result.granted).toBe(true);

    // Square returns the original payment when an idempotency key is replayed,
    // so the second call must be a no-op rather than a second grant.
    const replay = await db.query<{ result: { granted: boolean } }>(
      `select public.grant_cred_purchase('cred-buyer', 100, 'sq-payment-1', 'replay') as result`,
    );
    expect(replay.rows[0].result.granted).toBe(false);

    const balance = await db.query<{ cred_balance: number }>(
      `select cred_balance from public.users where id = 'cred-buyer'`,
    );
    expect(balance.rows[0].cred_balance).toBe(100);

    const ledger = await db.query<{ count: string }>(
      `select count(*)::text as count from public.transactions where external_id = 'sq-payment-1'`,
    );
    expect(ledger.rows[0].count).toBe('1');
  });

  it('rolls the ledger row back when the buyer does not exist', async () => {
    await expect(
      db.query(`select public.grant_cred_purchase('no-such-user', 100, 'sq-payment-2', null)`),
    ).rejects.toThrow();

    const ledger = await db.query<{ count: string }>(
      `select count(*)::text as count from public.transactions where external_id = 'sq-payment-2'`,
    );
    expect(ledger.rows[0].count).toBe('0');
  });

  describe('CRED authority', () => {
    const SPENDER_UID = '11111111-1111-1111-1111-111111111111';
    const ADMIN_UID = '22222222-2222-2222-2222-222222222222';

    /** Impersonates a signed-in caller the way PostgREST does. */
    async function signIn(authUid: string | null) {
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [authUid ?? '']);
    }

    beforeAll(async () => {
      // The 0007 trigger on auth.users creates the profile, keyed by the auth
      // uid, so the signup path is what seeds these rows.
      await db.query(
        `insert into auth.users (id, email)
         values ($1, 'cred-spender@example.test'), ($2, 'cred-admin@example.test')
         on conflict (id) do nothing`,
        [SPENDER_UID, ADMIN_UID],
      );
      await db.query(`update public.users set cred_balance = 200 where id = $1`, [SPENDER_UID]);
      await db.query(`update public.users set cred_balance = 10, role = 'admin' where id = $1`, [ADMIN_UID]);
      await db.query(
        `insert into public.users (id, username, display_name, cred_balance)
         values ('cred-earner', 'cred_earner', 'Earner', 0)
         on conflict (id) do nothing`,
      );
      await db.query(
        `insert into public.posts (id, author_id, content)
         values ('post-tipped', 'cred-earner', 'tip me'), ('post-boosted', 'cred-earner', 'boost me')
         on conflict (id) do nothing`,
      );
    });

    it('keeps the money-moving functions off the end-user roles', async () => {
      const { rows } = await db.query<{ fn: string; anon: boolean; authed: boolean }>(
        `select fn,
                has_function_privilege('anon', fn, 'execute') as anon,
                has_function_privilege('authenticated', fn, 'execute') as authed
           from unnest(array[
             'public.increment_counter(text, text, text, integer)',
             'public.increment_cred_balance(text, integer)',
             'public.exchange_cred_for_tokens(text, integer, integer)',
             'public.grant_cred_purchase(text, integer, text, text)'
           ]) as fn`,
      );

      expect(rows.filter((row) => row.anon || row.authed).map((row) => row.fn)).toEqual([]);
    });

    it('only lets a client bump counters that exist and are not balances', async () => {
      const { rows } = await db.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
      );
      const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
      const { rows: allowed } = await db.query<{ entry: string }>(
        `select unnest(public.public_counter_columns()) as entry`,
      );

      expect(allowed.map((row) => row.entry).filter((entry) => !present.has(entry))).toEqual([]);

      await signIn(SPENDER_UID);
      await expect(
        db.query(`select public.bump_public_counter('users', $1, 'cred_balance', 1)`, [SPENDER_UID]),
      ).rejects.toThrow(/not a client-writable counter/);
      await expect(
        db.query(`select public.bump_public_counter('posts', 'post-tipped', 'view_count', 5000)`),
      ).rejects.toThrow(/non-zero delta/);

      await db.query(`select public.bump_public_counter('posts', 'post-tipped', 'view_count', 1)`);
      const views = await db.query<{ view_count: number }>(
        `select view_count from public.posts where id = 'post-tipped'`,
      );
      expect(views.rows[0].view_count).toBe(1);
    });

    it('refuses to overdraw and leaves no ledger row behind', async () => {
      await signIn(SPENDER_UID);
      await expect(db.query(`select public.spend_cred(500, 'too much')`)).rejects.toThrow(/insufficient_cred/);

      const after = await db.query<{ cred_balance: number; ledger: string }>(
        `select u.cred_balance,
                (select count(*)::text from public.transactions t where t.user_id = $1) as ledger
           from public.users u where u.id = $1`,
        [SPENDER_UID],
      );
      expect(after.rows[0].cred_balance).toBe(200);
      expect(after.rows[0].ledger).toBe('0');
    });

    it('moves the balance and both ledger rows together for a tip', async () => {
      await signIn(SPENDER_UID);
      const result = await db.query<{ result: { spent: number; credited: number } }>(
        `select public.tip_post('post-tipped', 25, 'nice work') as result`,
      );
      expect(result.rows[0].result).toMatchObject({ spent: 25, credited: 25 });

      const balances = await db.query<{ id: string; cred_balance: number }>(
        `select id, cred_balance from public.users where id in ($1, 'cred-earner') order by id`,
        [SPENDER_UID],
      );
      expect(balances.rows).toEqual([
        { id: SPENDER_UID, cred_balance: 175 },
        { id: 'cred-earner', cred_balance: 25 },
      ]);

      const ledger = await db.query<{ count: string }>(
        `select count(*)::text as count from public.transactions
          where description like '%transmission%' or description like 'Tip from%'`,
      );
      expect(ledger.rows[0].count).toBe('2');
    });

    it('boosts a post the caller does not own, which RLS blocked before', async () => {
      await signIn(SPENDER_UID);
      const boost = await db.query<{ result: { ok: boolean; cost: number } }>(
        `select public.boost_post('post-boosted') as result`,
      );
      expect(boost.rows[0].result).toMatchObject({ ok: true, cost: 50 });

      const post = await db.query<{ is_boosted: boolean; boosts: number }>(
        `select is_boosted, boosts from public.posts where id = 'post-boosted'`,
      );
      expect(post.rows[0]).toMatchObject({ is_boosted: true, boosts: 1 });

      // A second boost is a no-op rather than a second charge.
      const replay = await db.query<{ result: { ok: boolean; reason?: string } }>(
        `select public.boost_post('post-boosted') as result`,
      );
      expect(replay.rows[0].result).toMatchObject({ ok: false, reason: 'already_boosted' });
    });

    it('clamps an admin spend at zero instead of going negative', async () => {
      await signIn(ADMIN_UID);
      await db.query(`select public.spend_cred(50, 'admin action')`);

      const balance = await db.query<{ cred_balance: number }>(
        `select cred_balance from public.users where id = $1`,
        [ADMIN_UID],
      );
      expect(balance.rows[0].cred_balance).toBe(0);
    });

    it('awards a referral exactly once', async () => {
      await signIn(SPENDER_UID);
      const first = await db.query<{ result: { ok: boolean } }>(
        `select public.redeem_referral('cred_earner') as result`,
      );
      expect(first.rows[0].result).toMatchObject({ ok: true });

      const replay = await db.query<{ result: { ok: boolean; reason?: string } }>(
        `select public.redeem_referral('cred_earner') as result`,
      );
      expect(replay.rows[0].result).toMatchObject({ ok: false, reason: 'already_redeemed' });

      const rows = await db.query<{ count: string }>(
        `select count(*)::text as count from public.referrals where referred_id = $1`,
        [SPENDER_UID],
      );
      expect(rows.rows[0].count).toBe('1');
    });

    it('pins the balance columns against a direct client update', async () => {
      await signIn(SPENDER_UID);
      await db.query(`grant select, update on public.users to authenticated`);
      await db.query(`set role authenticated`);
      let written: { cred_balance: number; subscription_tier: string } | undefined;
      try {
        // RETURNING proves RLS let the statement through, so the pinned values
        // are the trigger's work rather than a policy rejection.
        const result = await db.query<{ cred_balance: number; subscription_tier: string }>(
          `update public.users set cred_balance = 999999, subscription_tier = 'architect'
            where id = $1
            returning cred_balance, subscription_tier`,
          [SPENDER_UID],
        );
        written = result.rows[0];
      } finally {
        await db.query(`reset role`);
      }

      expect(written).toBeDefined();
      expect(written!.cred_balance).not.toBe(999999);
      expect(written!.subscription_tier).not.toBe('architect');
    });
  });
});

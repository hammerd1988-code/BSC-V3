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

/**
 * Every `upsert(..., { onConflict })` target in the app, as `table -> columns`.
 *
 * PostgREST turns these into `ON CONFLICT (columns)`, which Postgres only accepts
 * when a non-partial unique index covers exactly those columns. `subscriptions`
 * had only the partial `(user_id) where status = 'active'`, so the Stripe webhook
 * failed with 42P10 on every purchase. Nothing was checking, so nothing noticed.
 */
const UPSERT_CONFLICT_TARGETS: Array<[string, string]> = [
  ['battle_crowd_seals', 'match_id,user_id,moment'],
  ['bot_conversations', 'user_id,bot_id'],
  ['bot_forge_config', 'gladiator_id'],
  ['bot_gladiator_profiles', 'gladiator_id'],
  ['bot_listings', 'id'],
  ['bot_mayhem_maga_switches', 'id'],
  ['bot_mayhem_persona_overrides', 'username'],
  ['bot_mayhem_relationships', 'source_username,target_username'],
  ['bot_mayhem_runs', 'id'],
  ['casper_cli_devices', 'machine_id'],
  ['casper_integrations', 'user_id,integration_key'],
  ['device_push_tokens', 'token'],
  ['faction_members', 'id'],
  ['factions', 'id'],
  ['gladiators', 'id'],
  ['match_solution_artifacts', 'match_id,gladiator_id'],
  ['push_subscriptions', 'endpoint'],
  ['users', 'id'],
];

/** Functions called via supabase.rpc(...) somewhere in the app. */
const REQUIRED_FUNCTIONS = [
  'increment_counter',
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

  it('can resolve every upsert conflict target the app uses', async () => {
    const missing: string[] = [];

    for (const [table, columns] of UPSERT_CONFLICT_TARGETS) {
      const sorted = columns.split(',').map((column) => column.trim()).sort().join(',');
      const { rows } = await db.query<{ present: boolean }>(
        `select exists (
           select 1
             from pg_index i
             join pg_class c on c.oid = i.indrelid
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname = $1
              and i.indisunique
              -- A partial index cannot serve as an ON CONFLICT target.
              and i.indpred is null
              and (
                select array_agg(a.attname::text order by a.attname)
                  from unnest(i.indkey) as k(attnum)
                  join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
              ) = $2::text[]
         ) as present`,
        [table, `{${sorted}}`],
      );
      if (!rows[0].present) missing.push(`${table}(${columns})`);
    }

    expect(missing).toEqual([]);
  });

  it('has no ON CONFLICT (user_id) target on subscriptions', async () => {
    // The Stripe webhook used `upsert(..., { onConflict: 'user_id' })`, but the only
    // unique index on the column is partial (`where status = 'active'`), which
    // Postgres refuses as a conflict target — so every purchase failed with 42P10
    // and no subscription was ever recorded. stripeRoutes reads/updates/inserts
    // explicitly now; this pins down why.
    await db.query(
      `insert into public.users (id, username, display_name)
       values ('sub-buyer', 'sub_buyer', 'Sub Buyer')
       on conflict (id) do nothing`,
    );

    await expect(
      db.query(
        `insert into public.subscriptions (user_id, tier, status)
         values ('sub-buyer', 'operator', 'active')
         on conflict (user_id) do update set tier = excluded.tier`,
      ),
    ).rejects.toThrow(/no unique or exclusion constraint/i);
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
});

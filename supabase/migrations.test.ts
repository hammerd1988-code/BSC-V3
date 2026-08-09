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
  'user_ai_credentials',
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
  ['user_ai_credentials', 'user_id'],
  ['faction_members', 'id'],
  ['factions', 'id'],
  ['gladiators', 'id'],
  ['match_solution_artifacts', 'match_id,gladiator_id'],
  ['push_subscriptions', 'endpoint'],
  ['users', 'id'],
];

/**
 * `rpc(name, args)` call sites, as `name -> argument names`.
 *
 * PostgREST resolves an RPC by *argument name*, so a renamed or extra parameter
 * is a 404 (PGRST202) at runtime, not a type error — which is how the app ended up
 * calling functions that did not exist for months. Checking names alone (below)
 * would not have caught it.
 */
const RPC_SIGNATURES: Array<[string, string[]]> = [
  ['bump_transmission_unread', ['p_last_transmit', 'p_recipient_id', 'p_transmission_id']],
  ['clear_transmission_unread', ['p_transmission_id', 'p_user_id']],
  ['casper_memory_stats', ['p_user_id']],
  ['convert_cred_to_compute', ['p_cred_amount', 'p_gladiator_id', 'p_user_id']],
  ['draw_colosseum_arena_modifier', ['p_challenge_type', 'p_challenger_id', 'p_defender_id']],
  ['exchange_cred_for_tokens', ['user_id', 'cred_to_deduct', 'tokens_to_add']],
  ['get_battle_crowd_seals', ['p_match_id', 'p_viewer_user_id']],
  ['get_casper_conversation_history', ['p_limit', 'p_user_id']],
  ['grant_cred_purchase', ['p_user_id', 'p_amount', 'p_payment_id', 'p_description']],
  ['increment_counter', ['p_amount', 'p_field', 'p_id', 'p_table']],
  ['increment_cred_balance', ['p_user_id', 'p_amount']],
  ['increment_gladiator_wins', ['gladiator_id']],
  ['increment_memory_access', ['memory_ids']],
  ['mutate_colosseum_gladiator', ['p_gladiator_id', 'p_mutation_mode', 'p_stat_key']],
  ['promote_faction_captain', ['p_faction_id', 'p_member_id']],
  ['refresh_colosseum_bounties', []],
  ['remove_friend', ['p_friend_id']],
  ['resolve_colosseum_match_server', ['p_actor_auth_uid', 'p_judgement', 'p_match_id', 'p_replay_data', 'p_winner_id']],
  ['respond_friend_request', ['p_accept', 'p_from_id']],
  ['search_casper_memories', ['p_limit', 'p_memory_types', 'p_user_id', 'query_text']],
  ['send_friend_request', ['p_target_id']],
  ['cancel_friend_request', ['p_target_id']],
  ['start_due_tournaments', []],
];

/** Functions called via supabase.rpc(...) somewhere in the app. */
const REQUIRED_FUNCTIONS = [
  'bump_transmission_unread',
  'clear_transmission_unread',
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

  /**
   * apply_increments executes `update public.<caller's table> set <caller's
   * column> = ...`, so definer rights would turn it into an arbitrary
   * row-update primitive that bypasses RLS. A hand-applied script outside the
   * migration chain (scripts/0002_security_and_storage.sql, since removed) had
   * done exactly that.
   */
  /**
   * 0065 revokes increment_counter from PUBLIC and grants it back to
   * authenticated only. That holds only as long as nothing grants routines to
   * anon in bulk — 0000 deliberately grants tables and sequences by default and
   * leaves routines to Postgres' own PUBLIC grant for exactly this reason.
   */
  it('keeps increment_counter out of anon reach', async () => {
    const { rows } = await db.query<{ anon: boolean; authed: boolean }>(
      `select has_function_privilege('anon', 'public.increment_counter(text, text, text, integer)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.increment_counter(text, text, text, integer)', 'execute') as authed`,
    );
    expect(rows[0]?.anon).toBe(false);
    expect(rows[0]?.authed).toBe(true);
  });

  /**
   * The like button writes nothing but the post_likes row and relies entirely on
   * this trigger for the counters, so both columns have to move together and
   * neither may go negative. Before this, nothing wrote post_likes from the
   * browser at all and botApi incremented likes_count itself on top of the
   * trigger, which double-counted every bot reaction.
   */
  it('moves both post counters from the post_likes row alone', async () => {
    await db.query(`insert into public.users (id, username, display_name) values ('liker', 'liker', 'Liker')`);
    await db.query(`insert into public.posts (id, author_id, content) values ('liked-post', 'liker', 'hello')`);

    const counters = async () => {
      const { rows } = await db.query<{ likes: number; likes_count: number }>(
        `select likes, likes_count from public.posts where id = 'liked-post'`,
      );
      return { likes: Number(rows[0]?.likes), likesCount: Number(rows[0]?.likes_count) };
    };

    expect(await counters()).toEqual({ likes: 0, likesCount: 0 });

    await db.query(`insert into public.post_likes (post_id, user_id) values ('liked-post', 'liker')`);
    expect(await counters()).toEqual({ likes: 1, likesCount: 1 });

    // The client treats a duplicate as "already liked" rather than a failure,
    // which only holds because the primary key rejects it.
    await expect(
      db.query(`insert into public.post_likes (post_id, user_id) values ('liked-post', 'liker')`),
    ).rejects.toThrow(/duplicate key/i);
    expect(await counters()).toEqual({ likes: 1, likesCount: 1 });

    await db.query(`delete from public.post_likes where post_id = 'liked-post' and user_id = 'liker'`);
    expect(await counters()).toEqual({ likes: 0, likesCount: 0 });

    // An unlike that matches nothing must not drive the counter below zero.
    await db.query(`delete from public.post_likes where post_id = 'liked-post' and user_id = 'liker'`);
    expect(await counters()).toEqual({ likes: 0, likesCount: 0 });
  });

  /**
   * `users readable by authed` has no column restriction and every client read
   * is `select('*')`, so anything secret in that row is readable by every
   * signed-in account. The provider key the user pays for therefore lives in
   * its own owner-scoped table, and a trigger keeps it from drifting back.
   */
  it('keeps the per-user provider key out of the shared users row', async () => {
    await db.query(
      `insert into public.users (id, username, display_name, ai_settings)
       values ('ai-key-user', 'ai_key_user', 'AI Key User', '{"model":"m","apiKey":"sk-insert"}'::jsonb)`,
    );
    const afterInsert = await db.query<{ settings: string }>(
      `select ai_settings::text as settings from public.users where id = 'ai-key-user'`,
    );
    expect(afterInsert.rows[0]?.settings).not.toContain('sk-insert');

    await db.query(
      `update public.users set ai_settings = '{"model":"m","api_key":"sk-update"}'::jsonb where id = 'ai-key-user'`,
    );
    const afterUpdate = await db.query<{ settings: string }>(
      `select ai_settings::text as settings from public.users where id = 'ai-key-user'`,
    );
    expect(afterUpdate.rows[0]?.settings).not.toContain('sk-update');
  });

  it('scopes user_ai_credentials to its owner and hides it from anon', async () => {
    const { rows } = await db.query<{ anon: boolean; rls: boolean; policies: number }>(
      `select has_table_privilege('anon', 'public.user_ai_credentials', 'select') as anon,
              (select relrowsecurity from pg_class where oid = 'public.user_ai_credentials'::regclass) as rls,
              (select count(*)::int from pg_policy where polrelid = 'public.user_ai_credentials'::regclass) as policies`,
    );
    expect(rows[0]?.anon).toBe(false);
    expect(rows[0]?.rls).toBe(true);
    expect(rows[0]?.policies).toBe(4);
  });

  it('keeps apply_increments on invoker rights', async () => {
    const { rows } = await db.query<{ prosecdef: boolean }>(
      `select p.prosecdef
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'apply_increments'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.prosecdef).toBe(false);
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

  it('declares every rpc with the argument names the app passes', async () => {
    const { rows } = await db.query<{ proname: string; argnames: string[] | null; nargs: number }>(
      `select p.proname, p.proargnames as argnames, p.pronargs as nargs
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'`,
    );

    const overloads = new Map<string, string[]>();
    for (const row of rows) {
      const declared = (row.argnames ?? []).map(String).slice(0, row.nargs).sort().join(',');
      const list = overloads.get(row.proname) ?? [];
      list.push(declared);
      overloads.set(row.proname, list);
    }

    const mismatched = RPC_SIGNATURES.filter(([name, args]) => {
      const declared = overloads.get(name);
      if (!declared) return true;
      return !declared.includes([...args].sort().join(','));
    }).map(([name, args]) => `${name}(${args.join(', ')})`);

    expect(mismatched).toEqual([]);
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

  it('only lets increment_counter touch allowlisted counters', async () => {
    await db.query(
      `insert into public.users (id, username, display_name, view_count, role)
       values ('counter-user', 'counter_user', 'Counter User', 0, 'user')
       on conflict (id) do update set view_count = 0, role = 'user'`,
    );

    await db.query(`select public.increment_counter('users', 'counter-user', 'view_count', 1)`);
    const { rows: bumped } = await db.query<{ view_count: number }>(
      `select view_count from public.users where id = 'counter-user'`,
    );
    expect(bumped[0].view_count).toBe(1);

    // The function is SECURITY DEFINER and took the table and column as text, so
    // any caller could point it at a column nothing meant to expose.
    await expect(
      db.query(`select public.increment_counter('users', 'counter-user', 'compute_tokens', 1000000)`),
    ).rejects.toThrow(/not an incrementable counter/i);

    await expect(
      db.query(`select public.increment_counter('gladiators', 'counter-user', 'cred', 1)`),
    ).rejects.toThrow(/not an incrementable counter/i);

    await expect(
      db.query(`select public.increment_counter('users', 'counter-user', 'view_count', 2000000)`),
    ).rejects.toThrow(/out of range/i);
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

  /**
   * 00591 used to redefine increment_counter, which 0065 later hardened into an
   * allowlisted function. Re-applying 00591 would have handed back the
   * unrestricted SECURITY DEFINER version — write any numeric column of any row,
   * RLS bypassed — so its body is gone and 0065 is the only definition.
   */
  it('still enforces the 0065 counter allowlist', async () => {
    await db.query(`insert into public.users (id, username, display_name) values ('u2', 'u2', 'u2')`);
    await db.query(`insert into public.posts (id, author_id, content) values ('p1', 'u2', 'hello')`);

    await db.query(`select public.increment_counter('posts', 'p1', 'view_count', 2)`);
    const { rows } = await db.query<{ view_count: number }>(
      `select view_count from public.posts where id = 'p1'`,
    );
    expect(Number(rows[0]?.view_count)).toBe(2);

    await expect(
      db.query(`select public.increment_counter('users', 'u2', 'compute_tokens', 1000)`),
    ).rejects.toThrow(/not an incrementable counter/i);
  });

  /**
   * The unread map used to be read, edited in JavaScript and written back whole,
   * so a sender working from a stale snapshot reset the other participant's
   * count. These functions edit one key inside a single UPDATE instead.
   */
  it('bumps one participant\'s unread count without disturbing the other', async () => {
    await db.query(
      `insert into public.transmissions (id, participant_ids, unread_counts)
       values ('t1', array['a','b']::text[], '{"a": 0, "b": 0}'::jsonb)`,
    );

    const unread = async () => {
      const { rows } = await db.query<{ unread_counts: Record<string, number> | string }>(
        `select unread_counts from public.transmissions where id = 't1'`,
      );
      const value = rows[0]?.unread_counts;
      return typeof value === 'string' ? JSON.parse(value) : value;
    };

    await db.query(`select public.bump_transmission_unread('t1', 'b', null)`);
    await db.query(`select public.bump_transmission_unread('t1', 'a', null)`);
    expect(await unread()).toEqual({ a: 1, b: 1 });

    // The stale-snapshot case: a client that still holds {"a":0,"b":0} bumps b.
    // The whole-object write would have published {"a":0,"b":1} and wiped a's
    // unread; the function only ever touches the key it was given.
    await db.query(`select public.bump_transmission_unread('t1', 'b', null)`);
    expect(await unread()).toEqual({ a: 1, b: 2 });

    // Two sends to the same recipient must record two unreads, not one.
    await db.query(`select public.bump_transmission_unread('t1', 'a', null)`);
    await db.query(`select public.bump_transmission_unread('t1', 'a', null)`);
    expect(await unread()).toEqual({ a: 3, b: 2 });

    await db.query(`select public.clear_transmission_unread('t1', 'a')`);
    expect(await unread()).toEqual({ a: 0, b: 2 });

    // A participant who has never been counted starts from zero rather than
    // throwing on a missing key.
    await db.query(`select public.bump_transmission_unread('t1', 'c', null)`);
    expect(await unread()).toEqual({ a: 0, b: 2, c: 1 });
  });

  it('writes last_transmit only when the caller supplies one', async () => {
    await db.query(
      `insert into public.transmissions (id, participant_ids, unread_counts, last_transmit)
       values ('t2', array['a','b']::text[], '{}'::jsonb, '{"content": "first"}'::jsonb)`,
    );

    const lastTransmit = async () => {
      const { rows } = await db.query<{ last_transmit: Record<string, unknown> | string | null }>(
        `select last_transmit from public.transmissions where id = 't2'`,
      );
      const value = rows[0]?.last_transmit;
      return typeof value === 'string' ? JSON.parse(value) : value;
    };

    await db.query(`select public.bump_transmission_unread('t2', 'b', null)`);
    expect(await lastTransmit()).toEqual({ content: 'first' });

    await db.query(
      `select public.bump_transmission_unread('t2', 'b', '{"content": "second"}'::jsonb)`,
    );
    expect(await lastTransmit()).toEqual({ content: 'second' });
  });
});

/**
 * Applies supabase/migrations to a throwaway in-process Postgres (PGlite) so the
 * whole chain can be verified without a Supabase project.
 *
 * This exists because the repo shipped several migrations that could never run:
 * an index over a column no migration added, `create policy if not exists`
 * (invalid in Postgres), uuid columns with foreign keys onto text primary keys,
 * data renames performed before the CHECK constraint was relaxed. Each one aborts
 * `supabase db reset` partway through, so the schema the app talks to drifts away
 * from the schema in git.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(HERE, '..', 'supabase', 'migrations');

/**
 * Supabase supplies the `auth`/`storage` schemas and the anon/authenticated/
 * service_role roles. Recreate just enough of them for the migrations to resolve.
 */
export const SUPABASE_STUBS = `
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin; end if;
end;
$$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
$$;

create or replace function auth.email() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.email', true), '');
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  path_tokens text[],
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select case
    when name is null then '{}'::text[]
    else (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
  end;
$$;

create or replace function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)];
$$;

-- PGlite has no pgcrypto/uuid-ossp; gen_random_uuid() is core since PG13, so
-- alias the uuid-ossp helper the migrations call.
create or replace function public.uuid_generate_v4() returns uuid language sql volatile as $$
  select gen_random_uuid();
$$;

create publication supabase_realtime;
`;

/** `create extension` has no catalog to satisfy it here (see the uuid stub above). */
function stripUnsupportedStatements(sql: string): string {
  return sql.replace(/create\s+extension[^;]*;/gi, '');
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

export function readMigration(file: string): string {
  return stripUnsupportedStatements(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
}

/**
 * The version the Supabase CLI records for a migration, i.e. the digits before
 * the first underscore. Two files that share one are ambiguous: the CLI keys
 * `supabase_migrations.schema_migrations` on it, so only one of them is ever
 * marked applied.
 */
export function migrationVersion(file: string): string {
  return file.split('_')[0];
}

export interface RevokedPrivilege {
  file: string;
  /** 'table' or 'function' — which has_*_privilege() to ask. */
  kind: 'table' | 'function';
  /** Object identity as Postgres accepts it, e.g. `public.f(text, integer)`. */
  object: string;
  privilege: string;
  role: string;
}

const TABLE_PRIVILEGES = ['select', 'insert', 'update', 'delete'];

interface PrivilegeStatement {
  file: string;
  granting: boolean;
  kind: 'table' | 'function';
  object: string;
  privileges: string[];
  roles: string[];
}

const PRIVILEGE_STATEMENT =
  /\b(revoke|grant)\s+([\s\S]+?)\s+on\s+(?:(function|table)\s+)?([\s\S]+?)\s+(?:from|to)\s+([\s\S]+?);/gi;

function privilegeStatements(): PrivilegeStatement[] {
  const statements: PrivilegeStatement[] = [];

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const match of sql.matchAll(PRIVILEGE_STATEMENT)) {
      const [, verb, rawPrivileges, rawKind, rawObject, rawRoles] = match;
      const object = rawObject.replace(/\s+/g, ' ').trim();
      // Skips column definitions that happen to contain the word (`revoked
      // boolean not null`) and the bulk `... on all tables in schema public`
      // form, which is never how a privileged object should become reachable.
      if (!object.startsWith('public.')) continue;

      const kind: 'table' | 'function' =
        rawKind?.toLowerCase() === 'function' || object.includes('(') ? 'function' : 'table';
      // `grant update (col, col) on t` narrows to named columns and leaves the
      // table-level privilege alone, so it says nothing either way here.
      if (kind === 'table' && rawPrivileges.includes('(')) continue;

      const privileges = /\ball\b/i.test(rawPrivileges)
        ? kind === 'function'
          ? ['execute']
          : TABLE_PRIVILEGES
        : rawPrivileges
            .split(',')
            .map((privilege) => privilege.trim().toLowerCase())
            .filter((privilege) => privilege.length > 0);

      statements.push({
        file,
        granting: verb.toLowerCase() === 'grant',
        kind,
        object,
        privileges,
        roles: rawRoles.split(',').map((role) => role.trim().toLowerCase()),
      });
    }
  }

  return statements;
}

/**
 * Replays the `grant`/`revoke` statements in the migration sources, in the order
 * the CLI applies them, and reports the privileges that should end up withheld
 * from anon and authenticated.
 *
 * Roughly a third of this schema's tables and SECURITY DEFINER functions are
 * deliberately unreachable from those roles — gladiator API keys, CRED
 * transfers, match resolution, tournament brackets. Nothing but the revoke
 * statement itself expresses that, and a single
 * `grant all on all tables in schema public` late in the chain silently undoes
 * every one of them, so the test suite re-derives the list from here rather than
 * from a hand-maintained copy. Bulk `on all tables in schema` grants are not
 * treated as re-grants for the same reason.
 *
 * PUBLIC is skipped: `has_table_privilege()` takes a concrete role, and any
 * privilege PUBLIC still carries shows up through anon and authenticated anyway.
 */
export function revokedPrivileges(): RevokedPrivilege[] {
  const outcome = new Map<string, RevokedPrivilege & { granting: boolean }>();

  for (const statement of privilegeStatements()) {
    for (const role of statement.roles) {
      if (role !== 'anon' && role !== 'authenticated') continue;
      for (const privilege of statement.privileges) {
        const key = `${statement.kind}|${statement.object}|${privilege}|${role}`;
        outcome.set(key, {
          file: statement.file,
          granting: statement.granting,
          kind: statement.kind,
          object: statement.object,
          privilege,
          role,
        });
      }
    }
  }

  return [...outcome.values()]
    .filter((entry) => !entry.granting)
    .map(({ granting: _granting, ...entry }) => entry);
}

export interface MigrationFailure {
  file: string;
  message: string;
}

export interface PgLiteLike {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

/** Boots PGlite with the Supabase stubs already applied. */
export async function createDatabase(): Promise<PgLiteLike> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  return db as unknown as PgLiteLike;
}

/**
 * Applies every migration in filename order. Continues past a failure (rolling
 * back the aborted transaction first) so one bad file does not mask the rest.
 */
export async function applyMigrations(
  db: PgLiteLike,
  onResult?: (file: string, failure: MigrationFailure | null) => void,
): Promise<MigrationFailure[]> {
  const failures: MigrationFailure[] = [];

  for (const file of migrationFiles()) {
    const sql = readMigration(file);
    try {
      await db.exec(sql);
      onResult?.(file, null);
    } catch (error) {
      const failure = {
        file,
        message: error instanceof Error ? error.message : String(error),
      };
      failures.push(failure);
      onResult?.(file, failure);
      // A failed statement leaves the implicit transaction aborted, which would
      // make every later file fail with a misleading error.
      await db.exec('rollback').catch(() => {});
    }
  }

  return failures;
}

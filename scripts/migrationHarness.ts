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
    const sql = stripUnsupportedStatements(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
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

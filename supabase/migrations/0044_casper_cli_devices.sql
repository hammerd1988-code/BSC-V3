-- Casper CLI relay devices — one row per machine linked through the
-- device-code auth flow. Only the token hash is stored; the relay token
-- itself is handed to the CLI exactly once during device/poll.
create table if not exists public.casper_cli_devices (
  machine_id text primary key,
  user_id text not null,
  machine_name text not null default 'unknown',
  os text,
  cli_version text,
  token_hash text not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create index if not exists casper_cli_devices_user_id_idx on public.casper_cli_devices (user_id);
create index if not exists casper_cli_devices_token_hash_idx on public.casper_cli_devices (token_hash);

-- Service-role only: the relay server is the sole reader/writer.
alter table public.casper_cli_devices enable row level security;

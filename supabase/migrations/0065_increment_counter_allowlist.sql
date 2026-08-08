-- Constrain public.increment_counter to the counters it is meant to move.
--
-- The function is SECURITY DEFINER and takes the table and column as text, and
-- Postgres grants EXECUTE on new functions to PUBLIC by default. Between them,
-- any caller holding the (publicly shipped) anon key could run
--
--   rpc('increment_counter', { p_table: 'gladiators', p_id: <any row>,
--                              p_field: <any numeric column>, p_amount: 1e9 })
--
-- against *any* row of *any* table with an `id` column, with RLS bypassed. The
-- allowlist below is exactly the set of (table, column) pairs the application
-- uses, so every legitimate call still works and nothing else is reachable.
--
-- Note: this does not make the CRED economy trustworthy on its own. The
-- `users self-update` policy still lets a client write its own row, so balances
-- and tips need to move server-side before they can be considered safe. This
-- closes the wider hole — writing to rows you do not own, and to columns nothing
-- ever intended to expose.

create or replace function public.increment_counter(
  p_table text,
  p_id text,
  p_field text,
  p_amount integer default 1
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id_type text;
  v_allowed boolean;
begin
  select (p_table, p_field) in (
    ('bot_listings', 'purchase_count'),
    ('feature_usage', 'usage_count'),
    ('posts', 'boosts'),
    ('posts', 'comments_count'),
    ('posts', 'likes_count'),
    ('posts', 'shares_count'),
    ('posts', 'view_count'),
    ('streams', 'crowd_size'),
    ('streams', 'viewer_count'),
    ('users', 'cred_balance'),
    ('users', 'followers_count'),
    ('users', 'following_count'),
    ('users', 'view_count'),
    ('videos', 'view_count')
  ) into v_allowed;

  if not v_allowed then
    raise exception 'increment_counter: public.%.% is not an incrementable counter', p_table, p_field
      using errcode = '42501';
  end if;

  -- Every real caller moves a counter by a handful at a time; the cap keeps a
  -- single call from rewriting a balance wholesale.
  if p_amount is null or abs(p_amount) > 1000000 then
    raise exception 'increment_counter: p_amount % is out of range', p_amount
      using errcode = '22003';
  end if;

  select format_type(a.atttypid, a.atttypmod)
    into v_id_type
  from pg_attribute a
  where a.attrelid = format('public.%I', p_table)::regclass
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if v_id_type is null then
    raise exception 'increment_counter: public.% has no id column', p_table;
  end if;

  execute format(
    'update public.%I set %I = coalesce(%I, 0) + $1 where id = $2::%s',
    p_table, p_field, p_field, v_id_type
  ) using p_amount, p_id;
end;
$$;

-- Anonymous visitors have no reason to move a counter; a session is the floor.
revoke all on function public.increment_counter(text, text, text, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.increment_counter(text, text, text, integer) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.increment_counter(text, text, text, integer) to service_role;
  end if;
end;
$$;

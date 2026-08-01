-- public.increment_counter took p_id as text and compared it directly against
-- the target table's id column, so every call against a uuid-keyed table
-- (posts, videos, comments) failed with
--   operator does not exist: uuid = text
-- Resolve the id column's real type and cast the parameter to it, which keeps
-- the primary key index usable and still supports text-keyed tables.

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
begin
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

-- public.increment_counter took p_id as text and compared it directly against
-- the target table's id column, so every call against a uuid-keyed table
-- (posts, videos, comments) failed with
--   operator does not exist: uuid = text
-- Resolve the id column's real type and cast the parameter to it, which keeps
-- the primary key index usable and still supports text-keyed tables.
--
-- Installed only when the function is absent, rather than with `create or
-- replace`. This file was renamed (it used to be
-- 0059_increment_counter_id_type.sql, colliding with
-- 0059_comments_owner_policies.sql), so the CLI sees a version it has no record
-- of and re-applies it to any database that is already migrated. 0065 narrows
-- this same SECURITY DEFINER function to an allowlist of counters, and a
-- `create or replace` here would hand the unrestricted version back. Every
-- database reaches 0065, which carries the type resolution below, so the guard
-- costs nothing.
do $$
begin
  if to_regprocedure('public.increment_counter(text, text, text, integer)') is null then
    execute $fn$
      create function public.increment_counter(
        p_table text,
        p_id text,
        p_field text,
        p_amount integer default 1
      )
      returns void
      language plpgsql
      security definer
      set search_path = pg_catalog, public
      as $body$
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
      $body$;
    $fn$;
  end if;
end;
$$;

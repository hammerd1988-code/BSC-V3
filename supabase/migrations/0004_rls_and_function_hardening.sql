-- Fix security/performance advisor warnings:
-- 1) Set explicit search_path for SECURITY DEFINER function.
-- 2) Rewrite selected RLS policies to use (select auth.uid()) initplans.

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
begin
  execute format(
    'update public.%I set %I = coalesce(%I, 0) + $1 where id = $2',
    p_table, p_field, p_field
  ) using p_amount, p_id;
end;
$$;

do $$
declare
  r record;
  roles_clause text;
  qual_new text;
  check_new text;
  create_sql text;
begin
  for r in
    select schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (tablename, policyname) in (
        ('users', 'users_insert_self'),
        ('users', 'users_update_self'),
        ('posts', 'posts_delete_owner'),
        ('posts', 'posts_insert_self'),
        ('posts', 'posts_update_owner'),
        ('comments', 'comments_delete_owner'),
        ('comments', 'comments_insert_self'),
        ('post_likes', 'likes_delete_self'),
        ('post_likes', 'likes_insert_self'),
        ('transmissions', 'tx_read_participants'),
        ('transmissions', 'tx_write_participants'),
        ('transmits', 'transmits_participants'),
        ('streams', 'streams_host_write'),
        ('stream_chat', 'schat_insert_self')
      )
  loop
    qual_new := case
      when r.qual is null then null
      else regexp_replace(r.qual, '\bauth\.uid\(\)', '(select auth.uid())', 'g')
    end;

    check_new := case
      when r.with_check is null then null
      else regexp_replace(r.with_check, '\bauth\.uid\(\)', '(select auth.uid())', 'g')
    end;

    select string_agg(quote_ident(role_name), ', ')
      into roles_clause
      from unnest(r.roles) as role_name;

    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);

    create_sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      r.policyname,
      r.schemaname,
      r.tablename,
      lower(r.permissive),
      lower(r.cmd),
      coalesce(roles_clause, 'public')
    );

    if qual_new is not null then
      create_sql := create_sql || format(' using (%s)', qual_new);
    end if;

    if check_new is not null then
      create_sql := create_sql || format(' with check (%s)', check_new);
    end if;

    execute create_sql;
  end loop;
end $$;

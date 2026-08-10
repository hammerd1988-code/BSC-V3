-- Make transmission unread counts atomic.
--
-- `transmissions.unread_counts` is a jsonb map of user id -> count, and every
-- writer read the whole object, changed one key in JavaScript, and wrote the
-- whole object back:
--
--   * Transmissions.tsx (send) builds the payload from `activeTransmission`,
--     which is React state captured when the thread was opened. Anything the
--     other participant did since then is overwritten with a stale value, so a
--     badge the reader had already cleared reappears.
--   * Transmissions.tsx (mark-as-read) zeroes its own key but writes the whole
--     map, discarding increments the other side made in the meantime.
--   * casperAutonomy.sendDirectMessage does the same read-modify-write, and
--     also discarded the update's error.
--
-- Two concurrent messages to the same recipient therefore recorded one unread.
--
-- These functions do the whole read-modify-write inside a single UPDATE, so
-- Postgres' row lock serialises them, and each touches exactly one key of the
-- map instead of replacing it.
--
-- security invoker: the `transmissions participants` RLS policy already limits
-- both statements to threads the caller is part of, and running as invoker keeps
-- that true rather than handing out an arbitrary-thread write primitive.

create or replace function public.bump_transmission_unread(
    p_transmission_id text,
    p_recipient_id    text,
    p_last_transmit   jsonb default null
) returns void
language sql
security invoker
set search_path = pg_catalog, public
as $$
    update public.transmissions
       set unread_counts = jsonb_set(
               coalesce(unread_counts, '{}'::jsonb),
               array[p_recipient_id],
               to_jsonb(
                   case
                       when jsonb_typeof(coalesce(unread_counts, '{}'::jsonb) -> p_recipient_id) = 'number'
                           then (unread_counts ->> p_recipient_id)::bigint
                       else 0
                   end + 1
               ),
               true
           ),
           last_transmit = coalesce(p_last_transmit, last_transmit),
           updated_at = now()
     where id = p_transmission_id
       and coalesce(p_recipient_id, '') <> '';
$$;

create or replace function public.clear_transmission_unread(
    p_transmission_id text,
    p_user_id         text
) returns void
language sql
security invoker
set search_path = pg_catalog, public
as $$
    update public.transmissions
       set unread_counts = jsonb_set(
               coalesce(unread_counts, '{}'::jsonb),
               array[p_user_id],
               to_jsonb(0),
               true
           )
     where id = p_transmission_id
       and coalesce(p_user_id, '') <> '';
$$;

-- No blanket PUBLIC execute: a caller that appears later should fail loudly
-- rather than inherit whatever the default grant happens to be.
revoke all on function public.bump_transmission_unread(text, text, jsonb) from public;
revoke all on function public.clear_transmission_unread(text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.bump_transmission_unread(text, text, jsonb) to authenticated;
    grant execute on function public.clear_transmission_unread(text, text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bump_transmission_unread(text, text, jsonb) to service_role;
    grant execute on function public.clear_transmission_unread(text, text) to service_role;
  end if;
end;
$$;

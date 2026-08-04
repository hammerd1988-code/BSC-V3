-- Migration 0007: Add updated_at to posts, atomic transfer_cred function,
--                 and content length constraints.

-- =========================================================================
-- posts.updated_at
-- =========================================================================
alter table public.posts
    add column if not exists updated_at timestamptz not null default now();

-- Keep updated_at in sync automatically
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
    before update on public.posts
    for each row execute function public.set_updated_at();

-- =========================================================================
-- Content length constraints (prevent runaway inserts)
-- =========================================================================
alter table public.posts
    add constraint if not exists posts_content_length check (length(content) between 1 and 10000);

alter table public.comments
    add constraint if not exists comments_content_length check (length(content) between 1 and 2000);

alter table public.transmits
    add constraint if not exists transmits_content_length check (length(content) between 1 and 5000);

-- =========================================================================
-- Atomic CRED transfer stored procedure
-- Performs debit + credit + two ledger inserts in a single transaction.
-- Call from server-side only (service role) — never from the client.
-- =========================================================================
create or replace function public.transfer_cred(
    p_from_user_id  text,
    p_to_user_id    text,
    p_amount        integer,
    p_description   text default 'CRED transfer'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    -- Validate amount
    if p_amount <= 0 then
        raise exception 'transfer amount must be positive';
    end if;

    -- Verify sender has sufficient balance (advisory lock on the row)
    perform pg_advisory_xact_lock(hashtext(p_from_user_id));
    if (select cred_balance from public.users where id = p_from_user_id for update) < p_amount then
        raise exception 'insufficient CRED balance';
    end if;

    -- Debit sender
    update public.users set cred_balance = cred_balance - p_amount where id = p_from_user_id;

    -- Credit receiver
    update public.users set cred_balance = cred_balance + p_amount where id = p_to_user_id;

    -- Ledger entries
    insert into public.transactions (user_id, amount, type, description, created_at)
    values
        (p_from_user_id, p_amount, 'spend', p_description, now()),
        (p_to_user_id,   p_amount, 'earn',  p_description, now());
end;
$$;

-- Revoke public execute — only service role may call this
revoke execute on function public.transfer_cred(text, text, integer, text) from public, anon, authenticated;

-- =========================================================================
-- Atomic CRED spend stored procedure
-- Performs balance check + debit + ledger insert in a single transaction.
-- Call from server-side only (service role) — never from the client.
-- =========================================================================
create or replace function public.spend_cred(
    p_user_id     text,
    p_amount      integer,
    p_description text default 'CRED spend'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_new_balance integer;
begin
    -- Validate amount
    if p_amount <= 0 then
        raise exception 'spend amount must be positive';
    end if;

    -- Lock the row and verify sufficient balance atomically
    perform pg_advisory_xact_lock(hashtext(p_user_id));
    if (select cred_balance from public.users where id = p_user_id for update) < p_amount then
        raise exception 'insufficient CRED balance';
    end if;

    -- Debit
    update public.users
       set cred_balance = cred_balance - p_amount
     where id = p_user_id
    returning cred_balance into v_new_balance;

    -- Ledger entry
    perform pg_advisory_xact_lock(hashtext(p_user_id));

    update public.users
       set cred_balance = cred_balance - p_amount
     where id = p_user_id
       and cred_balance >= p_amount
    returning cred_balance into v_new_balance;

    if not found then
        raise exception 'insufficient CRED balance';
    end if;

    insert into public.transactions (user_id, amount, type, description, created_at)
    values (p_user_id, p_amount, 'spend', p_description, now());

    return v_new_balance;
end;
$$;

-- Revoke public execute — only service role may call this
revoke execute on function public.spend_cred(text, integer, text) from public, anon, authenticated;
grant execute on function public.spend_cred(text, integer, text) to service_role;

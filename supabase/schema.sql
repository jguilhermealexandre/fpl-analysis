-- EasyFPL — accounts and entitlement.
--
-- Run this once, in the Supabase SQL editor, against a project created in an
-- EU region (Frankfurt or Ireland). The region cannot be changed afterwards.
--
-- WHAT SUPABASE ALREADY OWNS, AND WHY THAT WAS THE POINT
--
-- auth.users is theirs: the email, the bcrypt password hash, the confirmation
-- and reset tokens. None of it is in this file and none of it is ours to get
-- wrong. That is the whole reason for choosing a managed provider — password
-- hashing on Cloudflare Workers cannot meet the OWASP floor, because Workers
-- cap PBKDF2 at 100,000 iterations against a recommended minimum of 600,000,
-- and bcrypt, scrypt and Argon2 are not available there at all.
--
-- What this file owns is the one thing Supabase cannot decide for us: which
-- plan someone is on, and which FPL squad is theirs.
--
-- THE RULE THE WHOLE FILE EXISTS TO ENFORCE
--
-- A user may read their own plan and may never write it. Today `plan` lives in
-- localStorage as `st.plan === 'premium'`, which anyone can edit in devtools.
-- That is harmless while nothing is gated and nothing is charged for; it stops
-- being harmless the moment either is true. So the column is writable only by
-- the service role, which means only by a server holding the secret key — in
-- practice, the Mollie webhook.
--
-- Note the mechanism: this is a column-level GRANT, not a row-level policy.
-- Row-level security decides which ROWS you may touch; it cannot say "this row,
-- but not that column". Writing the rule as a policy would leave `plan`
-- editable by its owner, which is exactly the hole being closed.

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
    -- Not a new identity: the same uuid auth.users issues. Deleting the user
    -- deletes the profile, so "delete my account" stays one operation, which
    -- matters under GDPR erasure.
    id          uuid primary key references auth.users (id) on delete cascade,

    plan        text not null default 'free'
                check (plan in ('free', 'premium')),

    -- The FPL entry id, entered exactly as it is today. Text rather than an
    -- integer: it is an opaque identifier we echo back to the FPL API, never
    -- something we do arithmetic on, and leading zeros must survive.
    fpl_team_id text
                check (fpl_team_id is null or fpl_team_id ~ '^[0-9]{1,12}$'),

    -- Set by the webhook alongside `plan`, so a lapsed subscription can be
    -- expired without waiting for another webhook to arrive.
    plan_until  timestamptz,

    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on column public.profiles.plan is
    'free | premium. Writable only by the service role — see the grants below.';
comment on column public.profiles.plan_until is
    'When premium lapses. Null on the free plan. Entitlement is plan = premium AND (plan_until is null or plan_until > now()).';

-- ------------------------------------------------------------ row security

alter table public.profiles enable row level security;

-- Your own row, and only your own. Without this, RLS being on means nobody can
-- read anything, which is the correct default but not a useful one.
drop policy if exists "profiles are readable by their owner" on public.profiles;
create policy "profiles are readable by their owner"
    on public.profiles for select
    using ((select auth.uid()) = id);

-- The `with check` half matters as much as the `using` half: without it a user
-- could satisfy the policy on the row they own and then move the row to
-- somebody else's id.
drop policy if exists "profiles are updatable by their owner" on public.profiles;
create policy "profiles are updatable by their owner"
    on public.profiles for update
    using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

-- No insert policy and no delete policy, deliberately. Rows are created by the
-- trigger below and removed by the cascade from auth.users. A client that can
-- insert its own profile can choose its own plan on the way in.

-- ------------------------------------------------------- column privileges

-- This is the rule. `authenticated` may read the row and may write exactly one
-- column of it. `plan` and `plan_until` are absent from the update grant, so a
-- forged request to change them is refused by Postgres before any policy is
-- consulted. The service role bypasses all of this, which is why its key must
-- never reach a browser or a git repository.
-- One column. updated_at is deliberately absent: the trigger below sets it, and
-- a column privilege is only needed for columns the client's own statement
-- names, so granting it would widen the surface for nothing.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (fpl_team_id) on public.profiles to authenticated;

-- ------------------------------------------------- a profile for every user

-- security definer so it can write a table the new user has no rights to yet,
-- and `set search_path = ''` with fully-qualified names throughout, which is
-- Supabase's current guidance: without it, a definer function can be hijacked
-- by a caller who controls the search path.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id) values (new.id)
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ------------------------------------------------------------ updated_at

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.updated_at = now();
    -- A client with update rights on fpl_team_id could otherwise backdate this.
    return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
    before update on public.profiles
    for each row execute function public.touch_updated_at();

-- --------------------------------------------------------- the entitlement

-- One definition of "is this person premium", so the middleware, the page and
-- any future report cannot answer it differently. Expired is not premium, and
-- an absent row is not premium — a missing profile must fail closed.
create or replace function public.is_premium(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (select p.plan = 'premium'
                and (p.plan_until is null or p.plan_until > now())
         from public.profiles p
         where p.id = uid),
        false);
$$;

grant execute on function public.is_premium(uuid) to authenticated;

-- ------------------------------------------------------------------ notes
--
-- STILL TO DO, IN ORDER:
--
--  1. Auth settings: confirm-email ON, minimum password length 12, and custom
--     SMTP. The built-in sender allows two emails an hour, which is a testing
--     facility rather than a service.
--  2. Leaked-password protection (HaveIBeenPwned) is Pro-plan only. Until then
--     the length and character rules above are the whole defence, which is an
--     argument for a long minimum rather than a complicated one.
--  3. The Mollie webhook gets the service-role key and is the only thing in the
--     system permitted to write `plan`. It must verify the signature before it
--     believes anything, or the entitlement column is writable by the internet.
--  4. Nobody is premium yet. Until billing exists, `plan` stays 'free' for
--     everyone and premium is granted by hand in the SQL editor — which is the
--     intended way to give accounts to friends.

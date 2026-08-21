-- Season Vault self-serve predictions — run this once in the Supabase SQL
-- editor after creating the project, before pasting predictions-seed.sql.
--
-- lock_at is a normal column (not hardcoded into the policy) so the cutoff
-- can be changed later with a single UPDATE, no migration needed. Seeded to
-- the 2026/27 GW2 deadline (bootstrap-static.json events[1].deadline_time)
-- rather than GW1, so newcomers get a real window to submit.

create table if not exists config (
    id int primary key default 1,
    lock_at timestamptz not null,
    check (id = 1)
);

insert into config (id, lock_at) values (1, '2026-08-28T17:30:00Z')
    on conflict (id) do nothing;

create table if not exists predictions (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(trim(name)) > 0),
    name_key text generated always as (lower(trim(name))) stored,
    predictions text[] not null check (array_length(predictions, 1) = 20),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (name_key)
);

alter table config enable row level security;
alter table predictions enable row level security;

-- Anyone can read the lock timestamp and everyone's predictions (this is a
-- private-by-obscurity friend-group page, not a secrets store).
create policy "public read config" on config for select to anon using (true);
create policy "public read predictions" on predictions for select to anon using (true);

-- Insert/update allowed only before the lock — this is the real enforcement,
-- not just a disabled button on the submit page. No delete policy for anon
-- at all, so a submission can never be removed via the public key.
create policy "public insert before lock" on predictions for insert to anon
    with check (now() < (select lock_at from config where id = 1));

create policy "public update before lock" on predictions for update to anon
    using (true)
    with check (now() < (select lock_at from config where id = 1));

-- Keep updated_at current on every edit (upsert-by-name resubmission).
create or replace function set_updated_at() returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger predictions_set_updated_at
    before update on predictions
    for each row execute function set_updated_at();

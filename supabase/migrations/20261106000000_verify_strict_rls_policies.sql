-- Migration: 20261106000000_verify_strict_rls_policies.sql
-- Description: Enforce strict Row Level Security (RLS) and ownership matching on all tables.
-- Every table ensures:
--   1. ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
--   2. Strict ownership matching: USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Core Cloud Snapshot Table (spend_user_data)
-- ─────────────────────────────────────────────────────────────────────────────
alter table if exists public.spend_user_data enable row level security;

drop policy if exists "Users manage their own Spend cloud data" on public.spend_user_data;
create policy "Users manage their own Spend cloud data"
  on public.spend_user_data
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Normalized Account Settings & Transactions Tables
-- ─────────────────────────────────────────────────────────────────────────────
alter table if exists public.spend_account_settings enable row level security;

drop policy if exists "Users manage their own account settings" on public.spend_account_settings;
drop policy if exists "Users read their own account settings" on public.spend_account_settings;
create policy "Users manage their own account settings"
  on public.spend_account_settings
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table if exists public.spend_account_transactions enable row level security;

drop policy if exists "Users manage their own account transactions" on public.spend_account_transactions;
drop policy if exists "Users read their own account transactions" on public.spend_account_transactions;
create policy "Users manage their own account transactions"
  on public.spend_account_transactions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table if exists public.spend_account_change_history enable row level security;

drop policy if exists "Users read their own account change history" on public.spend_account_change_history;
create policy "Users read their own account change history"
  on public.spend_account_change_history
  for select
  to authenticated
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Web Push Devices & Reminders Tables
-- ─────────────────────────────────────────────────────────────────────────────
alter table if exists public.push_devices enable row level security;

drop policy if exists "Users manage their own push devices" on public.push_devices;
create policy "Users manage their own push devices"
  on public.push_devices
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table if exists public.push_reminders enable row level security;

drop policy if exists "Users manage their own push reminders" on public.push_reminders;
create policy "Users manage their own push reminders"
  on public.push_reminders
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Individual Normalized Tables (expenses, user_accounts, recurring_schedules)
--    Created if not existing, with strict RLS policies enforced.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.expenses (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(16, 2) not null check (amount > 0),
  description text not null default '',
  category text not null default 'Other',
  date date not null,
  account text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.expenses enable row level security;

drop policy if exists "Users can only access their own expenses" on public.expenses;
drop policy if exists "Users manage their own expenses" on public.expenses;
create policy "Users can only access their own expenses"
  on public.expenses
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.user_accounts (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type text not null default 'bank',
  balance numeric(16, 2) not null default 0,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.user_accounts enable row level security;

drop policy if exists "Users can only access their own user_accounts" on public.user_accounts;
drop policy if exists "Users manage their own user_accounts" on public.user_accounts;
create policy "Users can only access their own user_accounts"
  on public.user_accounts
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.recurring_schedules (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  description text not null,
  amount numeric(16, 2) not null check (amount > 0),
  category text not null default 'Other',
  account text default '',
  interval text not null check (interval in ('weekly', 'monthly')),
  day_of_month integer check (day_of_month between 1 and 31),
  next_date date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.recurring_schedules enable row level security;

drop policy if exists "Users can only access their own recurring_schedules" on public.recurring_schedules;
drop policy if exists "Users manage their own recurring_schedules" on public.recurring_schedules;
create policy "Users can only access their own recurring_schedules"
  on public.recurring_schedules
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Automated Verification Assertion
--    Validates that every single table in the public schema has RLS enabled.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
  v_insecure_count integer := 0;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename not in ('schema_migrations')
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = r.tablename
        and c.relrowsecurity = true
    ) then
      raise warning 'Table %.% does NOT have RLS enabled!', 'public', r.tablename;
      v_insecure_count := v_insecure_count + 1;
    end if;
  end loop;

  if v_insecure_count > 0 then
    raise exception 'RLS Verification Failed: % table(s) lack Row Level Security!', v_insecure_count;
  end if;
end;
$$;

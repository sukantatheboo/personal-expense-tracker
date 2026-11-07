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
-- 4. Clean up unused legacy normalized tables if present
-- ─────────────────────────────────────────────────────────────────────────────
drop table if exists public.expenses cascade;
drop table if exists public.user_accounts cascade;
drop table if exists public.recurring_schedules cascade;

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

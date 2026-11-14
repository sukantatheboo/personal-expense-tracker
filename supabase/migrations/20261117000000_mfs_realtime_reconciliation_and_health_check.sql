-- =============================================================================
-- Spend: Master MFS Multi-Device Sync, Tombstone Reconciliation & SQL Health Check
-- Migration: 20261117000000_mfs_realtime_reconciliation_and_health_check.sql
-- Safe to run multiple times in Supabase SQL Editor (100% idempotent).
--
-- What this migration fixes & installs:
-- 1. Preserves exact client createdAt/updatedAt millisecond timestamps on
--    public.spend_account_transactions so cloud sync never overwrites a
--    transaction's timestamp with now() and accidentally resurrects deleted rows.
-- 2. Filters out deletedRecords.accountTransactions and deletedRecords.expenses
--    tombstones inside load_spend_user_snapshot() and soft-deletes tombstoned
--    rows immediately inside sync_spend_accounts_from_snapshot().
-- 3. Fixes save_spend_user_snapshot() return-type upgrade (drops old signature
--    first) and performs atomic server-side CRDT merging of deletedRecords,
--    transactions, expenses, recurringSchedules, and cards so two devices
--    never overwrite each other or get stuck in optimistic-lock conflicts.
-- 4. Automatically writes deletion tombstones during restore_spend_backup_checkpoint()
--    for any post-checkpoint records so all other connected devices immediately
--    drop rolled-back transactions.
-- 5. Installs public.verify_spend_sql_installation() and runs it at the end so
--    you immediately see a "✅ INSTALLED" checklist table in Supabase SQL Editor.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- 1. Ensure all required columns exist on spend_account_settings & spend_account_transactions
alter table public.spend_account_settings
  add column if not exists savings_balance numeric(12, 2) not null default 0,
  add column if not exists cards jsonb not null default '[]'::jsonb,
  add column if not exists balances jsonb not null default '{}'::jsonb,
  add column if not exists opening_balances jsonb not null default '{}'::jsonb,
  add column if not exists current_balances jsonb not null default '{}'::jsonb,
  add column if not exists version bigint not null default 1;

alter table public.spend_account_transactions
  add column if not exists category text,
  add column if not exists recurring_id text,
  add column if not exists balance_before numeric(16, 2),
  add column if not exists balance_after numeric(16, 2),
  add column if not exists from_balance_after numeric(16, 2),
  add column if not exists to_balance_after numeric(16, 2),
  add column if not exists created_at_ms bigint,
  add column if not exists updated_at_ms bigint,
  add column if not exists deleted_at timestamptz;

-- Ensure legacy CHECK constraints on spend_account_transactions don't block expense/savings/custom card IDs
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.spend_account_transactions'::regclass
      and c.contype = 'c'
  loop
    execute format(
      'alter table public.spend_account_transactions drop constraint if exists %I',
      r.conname
    );
  end loop;
end;
$$;

alter table public.spend_account_transactions
  add constraint spend_account_transactions_mfs_type_check
    check (type in ('expense', 'savings', 'income', 'adjustment', 'transfer')),
  add constraint spend_account_transactions_mfs_amount_check
    check (amount >= 0),
  add constraint spend_account_transactions_mfs_direction_check
    check (direction is null or direction in ('increase', 'decrease'));

-- Ensure spend_backup_checkpoints table exists
create table if not exists public.spend_backup_checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  checkpoint_type text not null default 'daily'
    check (checkpoint_type in ('daily', 'pre_restore', 'pre_overwrite', 'manual')),
  checkpoint_date date not null default (timezone('utc', now()))::date,
  label text not null default '',
  data jsonb not null default '{}'::jsonb,
  ledger_summary jsonb not null default '{}'::jsonb,
  card_count integer not null default 0,
  expense_count integer not null default 0,
  tx_count integer not null default 0,
  source_updated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists spend_backup_checkpoints_user_daily_uidx
  on public.spend_backup_checkpoints (user_id, checkpoint_date)
  where (checkpoint_type = 'daily');

create index if not exists spend_backup_checkpoints_user_created_idx
  on public.spend_backup_checkpoints (user_id, created_at desc);

alter table public.spend_backup_checkpoints enable row level security;

drop policy if exists "spend_backup_checkpoints_select_own" on public.spend_backup_checkpoints;
create policy "spend_backup_checkpoints_select_own"
  on public.spend_backup_checkpoints
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "spend_backup_checkpoints_insert_own" on public.spend_backup_checkpoints;
create policy "spend_backup_checkpoints_insert_own"
  on public.spend_backup_checkpoints
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- 2. Helper functions for safe numeric/date/timestamp parsing & JSONB record merging
-- Drop existing helper signatures first so PostgreSQL never raises 42P13 if an older
-- migration used a different parameter name (e.g. p_value vs p_val).
drop function if exists public.spend_try_parse_numeric(text);
drop function if exists public.spend_try_parse_date(text);
drop function if exists public.spend_try_parse_timestamptz(jsonb);
drop function if exists public.spend_normalize_account_id(text);
drop function if exists public.spend_json_ms(jsonb);

create or replace function public.spend_try_parse_numeric(p_value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clean text;
begin
  if p_value is null then
    return null;
  end if;
  v_clean := btrim(regexp_replace(p_value, '[৳$€£,\s]', '', 'g'));
  if v_clean = '' then
    return null;
  end if;
  return round(v_clean::numeric, 2);
exception when others then
  return null;
end;
$$;

create or replace function public.spend_try_parse_date(p_value text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  return btrim(p_value)::date;
exception when others then
  return null;
end;
$$;

create or replace function public.spend_try_parse_timestamptz(p_value jsonb)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_num numeric;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'number' then
    v_num := (p_value #>> '{}')::numeric;
    if v_num > 0 then
      return to_timestamp(v_num / 1000.0);
    end if;
    return null;
  end if;
  if jsonb_typeof(p_value) = 'string' then
    v_text := btrim(p_value #>> '{}');
    if v_text = '' then
      return null;
    end if;
    if v_text ~ '^\d+(\.\d+)?$' then
      v_num := v_text::numeric;
      if v_num > 0 then
        return to_timestamp(v_num / 1000.0);
      end if;
      return null;
    end if;
    return v_text::timestamptz;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create or replace function public.spend_normalize_account_id(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clean text;
begin
  if p_value is null then
    return null;
  end if;
  v_clean := left(btrim(p_value), 120);
  if v_clean = '' then
    return null;
  end if;
  return v_clean;
end;
$$;

create or replace function public.spend_json_ms(p_value jsonb)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_num numeric;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return 0;
  end if;
  if jsonb_typeof(p_value) = 'number' then
    v_num := (p_value #>> '{}')::numeric;
    if v_num > 0 then
      return floor(v_num)::bigint;
    end if;
    return 0;
  end if;
  if jsonb_typeof(p_value) = 'string' then
    v_text := btrim(p_value #>> '{}');
    if v_text = '' then
      return 0;
    end if;
    if v_text ~ '^\d+(\.\d+)?$' then
      return floor(v_text::numeric)::bigint;
    end if;
    return floor(extract(epoch from v_text::timestamptz) * 1000)::bigint;
  end if;
  return 0;
exception when others then
  return 0;
end;
$$;

-- Server-side CRDT merger for two Spend snapshot JSONB objects
create or replace function public.merge_spend_snapshots_jsonb(
  p_existing jsonb,
  p_incoming jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_existing jsonb := coalesce(p_existing, '{}'::jsonb);
  v_incoming jsonb := coalesce(p_incoming, '{}'::jsonb);
  v_del_cards jsonb := '{}'::jsonb;
  v_del_tx jsonb := '{}'::jsonb;
  v_del_exp jsonb := '{}'::jsonb;
  v_del_rec jsonb := '{}'::jsonb;
  v_del_bud jsonb := '{}'::jsonb;
  v_merged_deleted jsonb;
  v_merged_tx jsonb := '[]'::jsonb;
  v_merged_exp jsonb := '[]'::jsonb;
  v_merged_rec jsonb := '[]'::jsonb;
  v_merged_cards jsonb := '[]'::jsonb;
  v_ex_settings jsonb := coalesce(v_existing #> '{accountData,settings}', '{}'::jsonb);
  v_in_settings jsonb := coalesce(v_incoming #> '{accountData,settings}', '{}'::jsonb);
  v_merged_settings jsonb;
  v_result jsonb;
begin
  if v_existing = '{}'::jsonb then
    return v_incoming;
  end if;
  if v_incoming = '{}'::jsonb then
    return v_existing;
  end if;
  if v_incoming ? '_encrypted' or v_incoming ->> 'format' = 'spend-encrypted-v1' then
    return v_incoming;
  end if;

  -- Merge deletedRecords collections by keeping the entry with greatest updatedAt per key
  with collections as (
    select col_name,
           coalesce(v_existing #> array['deletedRecords', col_name], '{}'::jsonb) as ex_map,
           coalesce(v_incoming #> array['deletedRecords', col_name], '{}'::jsonb) as in_map
    from unnest(array['cards', 'accountTransactions', 'expenses', 'recurringSchedules', 'budgets']) as col_name
  ),
  entries as (
    select c.col_name, e.key, e.value, public.spend_json_ms(e.value -> 'updatedAt') as ts, 0 as src
    from collections c
    cross join lateral jsonb_each(
      case when jsonb_typeof(c.in_map) = 'object' then c.in_map else '{}'::jsonb end
    ) e
    union all
    select c.col_name, e.key, e.value, public.spend_json_ms(e.value -> 'updatedAt') as ts, 1 as src
    from collections c
    cross join lateral jsonb_each(
      case when jsonb_typeof(c.ex_map) = 'object' then c.ex_map else '{}'::jsonb end
    ) e
  ),
  winners as (
    select distinct on (col_name, key) col_name, key, value
    from entries
    where jsonb_typeof(value) = 'object'
    order by col_name, key, ts desc, src asc
  ),
  grouped as (
    select col_name, coalesce(jsonb_object_agg(key, value), '{}'::jsonb) as obj
    from winners
    group by col_name
  )
  select
    coalesce((select obj from grouped where col_name = 'cards'), '{}'::jsonb),
    coalesce((select obj from grouped where col_name = 'accountTransactions'), '{}'::jsonb),
    coalesce((select obj from grouped where col_name = 'expenses'), '{}'::jsonb),
    coalesce((select obj from grouped where col_name = 'recurringSchedules'), '{}'::jsonb),
    coalesce((select obj from grouped where col_name = 'budgets'), '{}'::jsonb)
  into v_del_cards, v_del_tx, v_del_exp, v_del_rec, v_del_bud;

  v_merged_deleted := jsonb_build_object(
    'cards', v_del_cards,
    'accountTransactions', v_del_tx,
    'expenses', v_del_exp,
    'recurringSchedules', v_del_rec,
    'budgets', v_del_bud
  );

  -- Merge accountData.transactions (prefer newer updatedAt; filter out any deleted=true tombstone)
  with all_tx as (
    select elem ->> 'id' as id,
           elem,
           greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt')) as ts,
           public.spend_json_ms(elem -> 'createdAt') as created_ms,
           0 as src
    from jsonb_array_elements(
      case when jsonb_typeof(v_incoming #> '{accountData,transactions}') = 'array'
           then v_incoming #> '{accountData,transactions}' else '[]'::jsonb end
    ) elem
    where jsonb_typeof(elem) = 'object' and coalesce(elem ->> 'id', '') <> ''
    union all
    select elem ->> 'id' as id,
           elem,
           greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt')) as ts,
           public.spend_json_ms(elem -> 'createdAt') as created_ms,
           1 as src
    from jsonb_array_elements(
      case when jsonb_typeof(v_existing #> '{accountData,transactions}') = 'array'
           then v_existing #> '{accountData,transactions}' else '[]'::jsonb end
    ) elem
    where jsonb_typeof(elem) = 'object' and coalesce(elem ->> 'id', '') <> ''
  ),
  dedup_tx as (
    select distinct on (id) id, elem, ts, created_ms
    from all_tx
    where coalesce(v_del_tx #>> array[id, 'deleted'], '') <> 'true'
    order by id, ts desc, src asc
  )
  select coalesce(jsonb_agg(elem order by coalesce(nullif(created_ms, 0), ts) asc, id asc), '[]'::jsonb)
  into v_merged_tx
  from dedup_tx;

  -- Merge expenses (prefer newer updatedAt; filter out any deleted=true tombstone)
  with all_exp as (
    select elem ->> 'id' as id,
           elem,
           greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt')) as ts,
           public.spend_json_ms(elem -> 'createdAt') as created_ms,
           0 as src
    from jsonb_array_elements(
      case when jsonb_typeof(v_incoming -> 'expenses') = 'array'
           then v_incoming -> 'expenses' else '[]'::jsonb end
    ) elem
    where jsonb_typeof(elem) = 'object' and coalesce(elem ->> 'id', '') <> ''
    union all
    select elem ->> 'id' as id,
           elem,
           greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt')) as ts,
           public.spend_json_ms(elem -> 'createdAt') as created_ms,
           1 as src
    from jsonb_array_elements(
      case when jsonb_typeof(v_existing -> 'expenses') = 'array'
           then v_existing -> 'expenses' else '[]'::jsonb end
    ) elem
    where jsonb_typeof(elem) = 'object' and coalesce(elem ->> 'id', '') <> ''
  ),
  dedup_exp as (
    select distinct on (id) id, elem, ts, created_ms
    from all_exp
    where coalesce(v_del_exp #>> array[id, 'deleted'], '') <> 'true'
      and not (
        coalesce(elem ->> 'recurringId', '') <> ''
        and coalesce(elem ->> 'date', '') <> ''
        and coalesce(
          v_del_exp #>> array['recurring:' || (elem ->> 'recurringId') || ':' || (elem ->> 'date'), 'deleted'],
          ''
        ) = 'true'
      )
    order by id, ts desc, src asc
  )
  select coalesce(jsonb_agg(elem order by coalesce(nullif(created_ms, 0), ts) asc, id asc), '[]'::jsonb)
  into v_merged_exp
  from dedup_exp;

  -- Merge recurringSchedules
  with all_rec as (
    select elem ->> 'id' as id,
           elem,
           greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt')) as ts,
           0 as src
    from jsonb_array_elements(
      case when jsonb_typeof(v_incoming -> 'recurringSchedules') = 'array'
           then v_incoming -> 'recurringSchedules' else '[]'::jsonb end
    ) elem
    where jsonb_typeof(elem) = 'object' and coalesce(elem ->> 'id', '') <> ''
    union all
    select elem ->> 'id' as id,
           elem,
           greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt')) as ts,
           1 as src
    from jsonb_array_elements(
      case when jsonb_typeof(v_existing -> 'recurringSchedules') = 'array'
           then v_existing -> 'recurringSchedules' else '[]'::jsonb end
    ) elem
    where jsonb_typeof(elem) = 'object' and coalesce(elem ->> 'id', '') <> ''
  ),
  dedup_rec as (
    select distinct on (id) id, elem, ts
    from all_rec
    where coalesce(v_del_rec #>> array[id, 'deleted'], '') <> 'true'
    order by id, ts desc, src asc
  )
  select coalesce(jsonb_agg(elem order by id asc), '[]'::jsonb)
  into v_merged_rec
  from dedup_rec;

  -- Merge cards (prefer newer updatedAt; filter out tombstoned cards)
  with all_cards as (
    select elem ->> 'id' as id,
           elem,
           greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt')) as ts,
           ord::int as sort_ord,
           0 as src
    from jsonb_array_elements(
      case when jsonb_typeof(v_in_settings -> 'cards') = 'array'
           then v_in_settings -> 'cards' else '[]'::jsonb end
    ) with ordinality as t(elem, ord)
    where jsonb_typeof(elem) = 'object' and coalesce(elem ->> 'id', '') <> ''
    union all
    select elem ->> 'id' as id,
           elem,
           greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt')) as ts,
           (1000 + ord)::int as sort_ord,
           1 as src
    from jsonb_array_elements(
      case when jsonb_typeof(v_ex_settings -> 'cards') = 'array'
           then v_ex_settings -> 'cards' else '[]'::jsonb end
    ) with ordinality as t(elem, ord)
    where jsonb_typeof(elem) = 'object' and coalesce(elem ->> 'id', '') <> ''
  ),
  dedup_cards as (
    select distinct on (id) id, elem, ts, sort_ord
    from all_cards
    where not (
      coalesce(v_del_cards #>> array[id, 'deleted'], '') = 'true'
      and coalesce(public.spend_json_ms(v_del_cards #> array[id, 'updatedAt']), 0) >= ts
    )
    order by id, ts desc, src asc
  )
  select coalesce(jsonb_agg(elem order by sort_ord asc, id asc), '[]'::jsonb)
  into v_merged_cards
  from dedup_cards;

  if public.spend_json_ms(v_in_settings -> 'updatedAt') >= public.spend_json_ms(v_ex_settings -> 'updatedAt') then
    v_merged_settings := v_ex_settings || v_in_settings;
  else
    v_merged_settings := v_in_settings || v_ex_settings;
  end if;
  v_merged_settings := jsonb_set(v_merged_settings, '{cards}', v_merged_cards, true);

  v_result := v_existing || v_incoming;
  -- Preserve per-month budgets and budgetUpdatedAt from both devices while respecting budget tombstones
  v_result := jsonb_set(
    v_result,
    '{budgets}',
    (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
      from (
        select distinct on (k) k, v
        from (
          select key as k, value as v,
                 public.spend_json_ms(coalesce(v_incoming -> 'budgetUpdatedAt', '{}'::jsonb) -> key) as ts, 0 as src
          from jsonb_each(case when jsonb_typeof(v_incoming -> 'budgets') = 'object' then v_incoming -> 'budgets' else '{}'::jsonb end)
          union all
          select key as k, value as v,
                 public.spend_json_ms(coalesce(v_existing -> 'budgetUpdatedAt', '{}'::jsonb) -> key) as ts, 1 as src
          from jsonb_each(case when jsonb_typeof(v_existing -> 'budgets') = 'object' then v_existing -> 'budgets' else '{}'::jsonb end)
        ) b
        where coalesce(v_del_bud #>> array[k, 'deleted'], '') <> 'true'
        order by k, ts desc, src asc
      ) bm
    ),
    true
  );
  v_result := jsonb_set(
    v_result,
    '{budgetUpdatedAt}',
    coalesce(v_existing -> 'budgetUpdatedAt', '{}'::jsonb) || coalesce(v_incoming -> 'budgetUpdatedAt', '{}'::jsonb),
    true
  );
  v_result := jsonb_set(v_result, '{deletedRecords}', v_merged_deleted, true);
  v_result := jsonb_set(v_result, '{expenses}', v_merged_exp, true);
  v_result := jsonb_set(v_result, '{recurringSchedules}', v_merged_rec, true);
  v_result := jsonb_set(
    v_result,
    '{accountData}',
    coalesce(v_result -> 'accountData', '{}'::jsonb) || jsonb_build_object(
      'settings', v_merged_settings,
      'transactions', v_merged_tx
    ),
    true
  );

  return v_result;
end;
$$;

-- 3. Trigger function sync_spend_accounts_from_snapshot (preserves created_at_ms & updated_at_ms)
create or replace function public.sync_spend_accounts_from_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_data     jsonb;
  v_settings         jsonb;
  v_raw_balances     jsonb;
  v_raw_cards        jsonb;
  v_cards            jsonb := '[]'::jsonb;
  v_synced_cards     jsonb := '[]'::jsonb;
  v_card             jsonb;
  v_card_id          text;
  v_card_init        numeric(12, 2);
  v_bal_val          numeric(12, 2);
  v_resolved_init    numeric(12, 2);
  v_opening_balances jsonb := '{}'::jsonb;
  v_running_balances jsonb := '{}'::jsonb;
  v_deleted_cards    jsonb;
  v_deleted_tx       jsonb;
  v_deleted_exp      jsonb;
  v_start_date       date;
  v_configured       boolean;
  v_settings_ts      timestamptz;
  v_savings_card_id  text := null;
  v_rec              record;
  v_acct_bal_before  numeric(12, 2);
  v_acct_bal_after   numeric(12, 2);
  v_from_bal_before  numeric(12, 2);
  v_from_bal_after   numeric(12, 2);
  v_to_bal_before    numeric(12, 2);
  v_to_bal_after     numeric(12, 2);
  v_bkash_live       numeric(12, 2) := 0;
  v_bank_live        numeric(12, 2) := 0;
  v_savings_live     numeric(12, 2) := 0;
begin
  if new.data is null or jsonb_typeof(new.data) <> 'object' then
    return new;
  end if;

  if new.data ? '_encrypted' or new.data ->> 'format' = 'spend-encrypted-v1' then
    return new;
  end if;

  v_account_data := case
    when jsonb_typeof(new.data -> 'accountData') = 'object' then new.data -> 'accountData'
    else '{}'::jsonb
  end;
  v_settings := case
    when jsonb_typeof(v_account_data -> 'settings') = 'object' then v_account_data -> 'settings'
    else '{}'::jsonb
  end;
  v_raw_balances := case
    when jsonb_typeof(v_settings -> 'openingBalances') = 'object'
         and (v_settings -> 'openingBalances') <> '{}'::jsonb
      then v_settings -> 'openingBalances'
    when jsonb_typeof(v_settings -> 'balances') = 'object'
      then v_settings -> 'balances'
    else '{}'::jsonb
  end;
  v_raw_cards := case
    when jsonb_typeof(v_settings -> 'cards') = 'array' then v_settings -> 'cards'
    else '[]'::jsonb
  end;

  v_deleted_cards := coalesce(new.data #> '{deletedRecords,cards}', '{}'::jsonb);
  v_deleted_tx    := coalesce(new.data #> '{deletedRecords,accountTransactions}', '{}'::jsonb);
  v_deleted_exp   := coalesce(new.data #> '{deletedRecords,expenses}', '{}'::jsonb);

  v_start_date  := public.spend_try_parse_date(v_settings ->> 'startDate');
  v_settings_ts := coalesce(
    public.spend_try_parse_timestamptz(v_settings -> 'updatedAt'),
    new.updated_at,
    timezone('utc', now())
  );

  for v_card in select value from jsonb_array_elements(v_raw_cards)
  loop
    if jsonb_typeof(v_card) = 'object' and coalesce(btrim(v_card ->> 'id'), '') <> '' then
      v_card_id := btrim(v_card ->> 'id');

      if jsonb_typeof(v_deleted_cards -> v_card_id) = 'object'
         and (v_deleted_cards -> v_card_id ->> 'deleted') = 'true'
         and public.spend_json_ms(v_deleted_cards -> v_card_id -> 'updatedAt')
             >= greatest(public.spend_json_ms(v_card -> 'updatedAt'), public.spend_json_ms(v_card -> 'createdAt'))
      then
        continue;
      end if;

      v_card := v_card - 'cvv';
      v_bal_val   := public.spend_try_parse_numeric(v_raw_balances ->> v_card_id);
      v_card_init := public.spend_try_parse_numeric(v_card ->> 'initialBalance');

      if v_bal_val is not null and v_bal_val >= 0 and v_card_init is not null and v_card_init >= 0 then
        if v_bal_val = 0 and v_card_init > 0 then
          v_resolved_init := v_card_init;
        else
          v_resolved_init := v_bal_val;
        end if;
      elsif v_bal_val is not null and v_bal_val >= 0 then
        v_resolved_init := v_bal_val;
      elsif v_card_init is not null and v_card_init >= 0 then
        v_resolved_init := v_card_init;
      else
        v_resolved_init := 0;
      end if;

      v_opening_balances := jsonb_set(v_opening_balances, array[v_card_id], to_jsonb(round(v_resolved_init, 2)), true);
      v_card := jsonb_set(v_card, '{initialBalance}', to_jsonb(round(v_resolved_init, 2)), true);
      v_cards := v_cards || jsonb_build_array(v_card);

      if v_savings_card_id is null and (
        v_card ->> 'category' = 'savings'
        or v_card ->> 'type' = 'savings'
        or v_card ->> 'provider' = 'savings'
        or v_card_id = 'savings'
        or coalesce(v_card ->> 'number', '') like 'SAV-%'
        or coalesce(v_card ->> 'number', '') like 'VAULT-%'
        or coalesce(v_card ->> 'number', '') like 'DPS-%'
      ) then
        v_savings_card_id := v_card_id;
      end if;
    end if;
  end loop;

  for v_rec in select key, value from jsonb_each_text(v_raw_balances)
  loop
    if v_rec.key <> 'date' and not (v_opening_balances ? v_rec.key) then
      if not (
        jsonb_typeof(v_deleted_cards -> v_rec.key) = 'object'
        and (v_deleted_cards -> v_rec.key ->> 'deleted') = 'true'
      ) then
        v_bal_val := coalesce(public.spend_try_parse_numeric(v_rec.value), 0);
        if v_bal_val >= 0 then
          v_opening_balances := jsonb_set(v_opening_balances, array[v_rec.key], to_jsonb(round(v_bal_val, 2)), true);
        end if;
      end if;
    end if;
  end loop;

  v_running_balances := v_opening_balances;

  create temporary table if not exists _spend_staged_ledger (
    id                 text primary key,
    source_kind        text not null,
    tx_type            text not null,
    amount             numeric(16, 2) not null,
    tx_date            date not null,
    description        text not null default '',
    category           text,
    recurring_id       text,
    account            text,
    direction          text,
    from_account       text,
    to_account         text,
    created_ms         bigint not null default 0,
    updated_ms         bigint not null default 0,
    created_at         timestamptz not null,
    updated_at         timestamptz not null,
    balance_before     numeric(16, 2),
    balance_after      numeric(16, 2),
    from_balance_after numeric(16, 2),
    to_balance_after   numeric(16, 2)
  ) on commit drop;

  truncate table _spend_staged_ledger;

  -- Stage account transactions (strictly excluding any deleted=true tombstone)
  insert into _spend_staged_ledger (
    id, source_kind, tx_type, amount, tx_date, description,
    category, recurring_id, account, direction, from_account, to_account,
    created_ms, updated_ms, created_at, updated_at
  )
  select distinct on (id)
    id,
    'tx',
    tx_type,
    amount,
    tx_date,
    left(coalesce(description, ''), 120),
    case
      when tx_type = 'income' then 'Income'
      when tx_type = 'transfer' then 'Transfer'
      else 'Adjustment'
    end,
    null,
    case when tx_type in ('income', 'adjustment') then account else null end,
    case when tx_type = 'adjustment' then direction else null end,
    case when tx_type = 'transfer' then from_account else null end,
    case when tx_type = 'transfer' then to_account else null end,
    created_ms,
    updated_ms,
    created_at,
    greatest(created_at, updated_at)
  from (
    select
      left(btrim( coalesce(item ->> 'id', '') ), 120) as id,
      case
        when item ->> 'type' in ('adjust', 'adjustment') then 'adjustment'
        else btrim(coalesce(item ->> 'type', ''))
      end as tx_type,
      public.spend_try_parse_numeric(coalesce(item ->> 'amount', item ->> 'amt')) as amount,
      public.spend_try_parse_date(coalesce(item ->> 'date', item ->> 'd')) as tx_date,
      coalesce(item ->> 'description', item ->> 'note', '') as description,
      public.spend_normalize_account_id(coalesce(item ->> 'account', item ->> 'acct')) as account,
      case
        when coalesce(item ->> 'direction', item ->> 'dir') in ('up', 'increase') then 'increase'
        when coalesce(item ->> 'direction', item ->> 'dir') in ('down', 'decrease') then 'decrease'
        else null
      end as direction,
      public.spend_normalize_account_id(coalesce(item ->> 'fromAccount', item ->> 'from_account', item ->> 'acct')) as from_account,
      public.spend_normalize_account_id(coalesce(item ->> 'toAccount', item ->> 'to_account', item ->> 'to')) as to_account,
      public.spend_json_ms(item -> 'createdAt') as created_ms,
      case when public.spend_json_ms(item -> 'updatedAt') > 0
           then public.spend_json_ms(item -> 'updatedAt')
           else public.spend_json_ms(item -> 'createdAt') end as updated_ms,
      coalesce(public.spend_try_parse_timestamptz(item -> 'createdAt'), v_settings_ts) as created_at,
      coalesce(public.spend_try_parse_timestamptz(item -> 'updatedAt'), public.spend_try_parse_timestamptz(item -> 'createdAt'), v_settings_ts) as updated_at
    from jsonb_array_elements(
      case
        when jsonb_typeof(v_account_data -> 'transactions') = 'array' then v_account_data -> 'transactions'
        else '[]'::jsonb
      end
      ||
      case
        when jsonb_typeof(new.data -> 'customAccountTransactions') = 'array' then new.data -> 'customAccountTransactions'
        else '[]'::jsonb
      end
    ) as item
    where jsonb_typeof(item) = 'object'
  ) parsed
  where id <> ''
    and amount is not null
    and amount > 0
    and tx_date is not null
    and (
      (tx_type = 'income' and account is not null)
      or (tx_type = 'adjustment' and account is not null and direction in ('increase', 'decrease'))
      or (tx_type = 'transfer' and from_account is not null and to_account is not null and from_account <> to_account)
    )
    and not (
      jsonb_typeof(v_deleted_tx -> id) = 'object'
      and (v_deleted_tx -> id ->> 'deleted') = 'true'
    )
  order by id, updated_ms desc;

  -- Stage card-linked expenses & savings transfers (strictly excluding any deleted=true tombstone)
  insert into _spend_staged_ledger (
    id, source_kind, tx_type, amount, tx_date, description,
    category, recurring_id, account, direction, from_account, to_account,
    created_ms, updated_ms, created_at, updated_at
  )
  select distinct on (id)
    id,
    'expense',
    case when is_savings_transfer then 'savings' else 'expense' end,
    amount,
    tx_date,
    left(coalesce(nullif(btrim(description), ''), category, 'Expense'), 120),
    category,
    nullif(btrim(recurring_id), ''),
    case when not is_savings_transfer then account else null end,
    null,
    case when is_savings_transfer and account is not null and account <> 'cash' then account else null end,
    case when is_savings_transfer then v_savings_card_id else null end,
    created_ms,
    updated_ms,
    created_at,
    greatest(created_at, updated_at)
  from (
    select
      left(btrim(coalesce(item ->> 'id', '')), 120) as id,
      public.spend_try_parse_numeric(coalesce(item ->> 'amount', item ->> 'amt')) as amount,
      public.spend_try_parse_date(coalesce(item ->> 'date', item ->> 'd')) as tx_date,
      coalesce(item ->> 'description', item ->> 'desc', '') as description,
      coalesce(nullif(btrim(item ->> 'category'), ''), nullif(btrim(item ->> 'cat'), ''), 'Other') as category,
      coalesce(item ->> 'recurringId', '') as recurring_id,
      public.spend_normalize_account_id(coalesce(item ->> 'account', item ->> 'acct')) as account,
      (
        coalesce(item ->> 'category', item ->> 'cat', '') = 'Savings'
        and v_savings_card_id is not null
        and coalesce(public.spend_normalize_account_id(coalesce(item ->> 'account', item ->> 'acct')), '') <> v_savings_card_id
      ) as is_savings_transfer,
      public.spend_json_ms(item -> 'createdAt') as created_ms,
      case when public.spend_json_ms(item -> 'updatedAt') > 0
           then public.spend_json_ms(item -> 'updatedAt')
           else public.spend_json_ms(item -> 'createdAt') end as updated_ms,
      coalesce(public.spend_try_parse_timestamptz(item -> 'createdAt'), v_settings_ts) as created_at,
      coalesce(public.spend_try_parse_timestamptz(item -> 'updatedAt'), public.spend_try_parse_timestamptz(item -> 'createdAt'), v_settings_ts) as updated_at
    from jsonb_array_elements(
      case
        when jsonb_typeof(new.data -> 'expenses') = 'array' then new.data -> 'expenses'
        else '[]'::jsonb
      end
    ) as item
    where jsonb_typeof(item) = 'object'
  ) parsed_exp
  where id <> ''
    and amount is not null
    and amount > 0
    and tx_date is not null
    and (
      (account is not null and account <> 'cash')
      or is_savings_transfer
    )
    and not (
      jsonb_typeof(v_deleted_exp -> id) = 'object'
      and (v_deleted_exp -> id ->> 'deleted') = 'true'
    )
  order by id, updated_ms desc
  on conflict (id) do nothing;

  -- Walk the staged ledger chronologically to compute exact running balances
  for v_rec in
    select *
    from _spend_staged_ledger
    order by tx_date asc, created_ms asc, id asc
  loop
    v_acct_bal_before := null;
    v_acct_bal_after  := null;
    v_from_bal_before := null;
    v_from_bal_after  := null;
    v_to_bal_before   := null;
    v_to_bal_after    := null;

    if v_rec.tx_type = 'expense' and v_rec.account is not null then
      v_acct_bal_before := coalesce(public.spend_try_parse_numeric(v_running_balances ->> v_rec.account), 0);
      v_acct_bal_after  := round(v_acct_bal_before - v_rec.amount, 2);
      v_running_balances := jsonb_set(v_running_balances, array[v_rec.account], to_jsonb(v_acct_bal_after), true);

    elsif v_rec.tx_type = 'income' and v_rec.account is not null then
      v_acct_bal_before := coalesce(public.spend_try_parse_numeric(v_running_balances ->> v_rec.account), 0);
      v_acct_bal_after  := round(v_acct_bal_before + v_rec.amount, 2);
      v_running_balances := jsonb_set(v_running_balances, array[v_rec.account], to_jsonb(v_acct_bal_after), true);

    elsif v_rec.tx_type = 'adjustment' and v_rec.account is not null then
      v_acct_bal_before := coalesce(public.spend_try_parse_numeric(v_running_balances ->> v_rec.account), 0);
      if v_rec.direction = 'increase' then
        v_acct_bal_after := round(v_acct_bal_before + v_rec.amount, 2);
      else
        v_acct_bal_after := round(v_acct_bal_before - v_rec.amount, 2);
      end if;
      v_running_balances := jsonb_set(v_running_balances, array[v_rec.account], to_jsonb(v_acct_bal_after), true);

    elsif v_rec.tx_type in ('transfer', 'savings') then
      if v_rec.from_account is not null and v_rec.from_account <> coalesce(v_rec.to_account, '') then
        v_from_bal_before := coalesce(public.spend_try_parse_numeric(v_running_balances ->> v_rec.from_account), 0);
        v_from_bal_after  := round(v_from_bal_before - v_rec.amount, 2);
        v_running_balances := jsonb_set(v_running_balances, array[v_rec.from_account], to_jsonb(v_from_bal_after), true);
        v_acct_bal_before := v_from_bal_before;
        v_acct_bal_after  := v_from_bal_after;
      end if;
      if v_rec.to_account is not null and v_rec.to_account <> coalesce(v_rec.from_account, '') then
        v_to_bal_before := coalesce(public.spend_try_parse_numeric(v_running_balances ->> v_rec.to_account), 0);
        v_to_bal_after  := round(v_to_bal_before + v_rec.amount, 2);
        v_running_balances := jsonb_set(v_running_balances, array[v_rec.to_account], to_jsonb(v_to_bal_after), true);
        if v_acct_bal_before is null then
          v_acct_bal_before := v_to_bal_before;
          v_acct_bal_after  := v_to_bal_after;
        end if;
      end if;
    end if;

    update _spend_staged_ledger
    set balance_before     = v_acct_bal_before,
        balance_after      = v_acct_bal_after,
        from_balance_after = v_from_bal_after,
        to_balance_after   = v_to_bal_after
    where id = v_rec.id;
  end loop;

  for v_card in select value from jsonb_array_elements(v_cards)
  loop
    if jsonb_typeof(v_card) = 'object' and coalesce(btrim(v_card ->> 'id'), '') <> '' then
      v_card_id := btrim(v_card ->> 'id');
      v_card := jsonb_set(
        v_card,
        '{initialBalance}',
        to_jsonb(coalesce(public.spend_try_parse_numeric(v_opening_balances ->> v_card_id), 0)),
        true
      );
      v_card := jsonb_set(
        v_card,
        '{currentBalance}',
        to_jsonb(coalesce(public.spend_try_parse_numeric(v_running_balances ->> v_card_id), 0)),
        true
      );
      v_synced_cards := v_synced_cards || jsonb_build_array(v_card);
    end if;
  end loop;

  v_bkash_live := coalesce(public.spend_try_parse_numeric(v_running_balances ->> 'bkash'), 0);
  v_bank_live  := coalesce(public.spend_try_parse_numeric(v_running_balances ->> 'bank'), 0);
  v_savings_live := coalesce(
    public.spend_try_parse_numeric(v_running_balances ->> v_savings_card_id),
    public.spend_try_parse_numeric(v_running_balances ->> 'savings'),
    0
  );

  v_configured :=
        (v_settings ->> 'configured') = 'true'
     or (v_settings ->> 'cardsConfigured') = 'true'
     or jsonb_array_length(v_synced_cards) > 0
     or exists (select 1 from _spend_staged_ledger);

  insert into public.spend_account_settings (
    user_id, start_date, bkash_balance, bank_balance, savings_balance,
    cards, balances, opening_balances, current_balances, configured, updated_at
  ) values (
    new.user_id,
    coalesce(v_start_date, current_date),
    greatest(0, v_bkash_live),
    greatest(0, v_bank_live),
    greatest(0, v_savings_live),
    v_synced_cards,
    v_opening_balances,
    v_opening_balances,
    v_running_balances,
    v_configured,
    v_settings_ts
  )
  on conflict (user_id) do update
  set
    start_date       = coalesce(v_start_date, public.spend_account_settings.start_date),
    bkash_balance    = excluded.bkash_balance,
    bank_balance     = excluded.bank_balance,
    savings_balance  = excluded.savings_balance,
    cards            = excluded.cards,
    balances         = excluded.balances,
    opening_balances = excluded.opening_balances,
    current_balances = excluded.current_balances,
    configured       = excluded.configured,
    version          = public.spend_account_settings.version + 1,
    updated_at       = excluded.updated_at
  where (
    public.spend_account_settings.start_date,
    public.spend_account_settings.bkash_balance,
    public.spend_account_settings.bank_balance,
    public.spend_account_settings.savings_balance,
    public.spend_account_settings.cards,
    public.spend_account_settings.balances,
    public.spend_account_settings.opening_balances,
    public.spend_account_settings.current_balances,
    public.spend_account_settings.configured
  ) is distinct from (
    coalesce(v_start_date, public.spend_account_settings.start_date),
    excluded.bkash_balance,
    excluded.bank_balance,
    excluded.savings_balance,
    excluded.cards,
    excluded.balances,
    excluded.opening_balances,
    excluded.current_balances,
    excluded.configured
  );

  -- Upsert unified ledger rows into spend_account_transactions preserving created_at_ms & updated_at_ms
  insert into public.spend_account_transactions (
    user_id, id, type, amount, transaction_date, description,
    category, recurring_id, account, direction, from_account, to_account,
    balance_before, balance_after, from_balance_after, to_balance_after,
    created_at_ms, updated_at_ms, created_at, updated_at, deleted_at
  )
  select
    new.user_id, id, tx_type, amount, tx_date, description,
    category, recurring_id, account, direction, from_account, to_account,
    balance_before, balance_after, from_balance_after, to_balance_after,
    created_ms, updated_ms, created_at, updated_at, null
  from _spend_staged_ledger
  on conflict (user_id, id) do update
  set
    type               = excluded.type,
    amount             = excluded.amount,
    transaction_date   = excluded.transaction_date,
    description        = excluded.description,
    category           = excluded.category,
    recurring_id       = excluded.recurring_id,
    account            = excluded.account,
    direction          = excluded.direction,
    from_account       = excluded.from_account,
    to_account         = excluded.to_account,
    balance_before     = excluded.balance_before,
    balance_after      = excluded.balance_after,
    from_balance_after = excluded.from_balance_after,
    to_balance_after   = excluded.to_balance_after,
    created_at_ms      = coalesce(excluded.created_at_ms, public.spend_account_transactions.created_at_ms),
    updated_at_ms      = greatest(coalesce(public.spend_account_transactions.updated_at_ms, 0), coalesce(excluded.updated_at_ms, 0)),
    updated_at         = excluded.updated_at,
    deleted_at         = null
  where (
    public.spend_account_transactions.type,
    public.spend_account_transactions.amount,
    public.spend_account_transactions.transaction_date,
    public.spend_account_transactions.description,
    public.spend_account_transactions.category,
    public.spend_account_transactions.recurring_id,
    public.spend_account_transactions.account,
    public.spend_account_transactions.direction,
    public.spend_account_transactions.from_account,
    public.spend_account_transactions.to_account,
    public.spend_account_transactions.balance_before,
    public.spend_account_transactions.balance_after,
    public.spend_account_transactions.from_balance_after,
    public.spend_account_transactions.to_balance_after,
    public.spend_account_transactions.deleted_at
  ) is distinct from (
    excluded.type,
    excluded.amount,
    excluded.transaction_date,
    excluded.description,
    excluded.category,
    excluded.recurring_id,
    excluded.account,
    excluded.direction,
    excluded.from_account,
    excluded.to_account,
    excluded.balance_before,
    excluded.balance_after,
    excluded.from_balance_after,
    excluded.to_balance_after,
    excluded.deleted_at
  );

  -- Soft-delete rows removed from the snapshot or marked deleted in deletedRecords
  update public.spend_account_transactions t
  set deleted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where t.user_id = new.user_id
    and t.deleted_at is null
    and not exists (select 1 from _spend_staged_ledger s where s.id = t.id);

  -- Enrich NEW.data with reconciled balances and cards so spend_user_data.data is always canonical
  new.data := jsonb_set(
    new.data,
    '{accountData,settings}',
    v_settings || jsonb_build_object(
      'balances', v_opening_balances,
      'openingBalances', v_opening_balances,
      'currentBalances', v_running_balances,
      'cards', v_synced_cards,
      'configured', v_configured,
      'cardsConfigured', (jsonb_array_length(v_synced_cards) > 0)
    ),
    true
  );

  return new;
end;
$$;

revoke all on function public.sync_spend_accounts_from_snapshot() from public, anon, authenticated;

drop trigger if exists sync_spend_accounts_from_snapshot on public.spend_user_data;
create trigger sync_spend_accounts_from_snapshot
  before insert or update of data on public.spend_user_data
  for each row execute function public.sync_spend_accounts_from_snapshot();

-- 4. Authoritative Snapshot Loader (public.load_spend_user_snapshot)
create or replace function public.load_spend_user_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result  jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  with raw_snapshot as (
    select data, updated_at
    from public.spend_user_data
    where user_id = v_user_id
  ),
  acct_settings as (
    select start_date, bkash_balance, bank_balance, savings_balance,
           cards, balances, opening_balances, current_balances,
           configured, updated_at
    from public.spend_account_settings
    where user_id = v_user_id
  ),
  table_tx as (
    select
      t.id as tx_id,
      t.type as tx_type,
      0 as src,
      coalesce(nullif(t.created_at_ms, 0), floor(extract(epoch from t.created_at) * 1000)::bigint) as created_ms,
      coalesce(nullif(t.updated_at_ms, 0), floor(extract(epoch from t.updated_at) * 1000)::bigint) as updated_ms,
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', t.id,
          'createdAt', coalesce(nullif(t.created_at_ms, 0), floor(extract(epoch from t.created_at) * 1000)::bigint),
          'updatedAt', coalesce(nullif(t.updated_at_ms, 0), floor(extract(epoch from t.updated_at) * 1000)::bigint),
          'type', t.type,
          'amount', t.amount,
          'date', t.transaction_date::text,
          'description', t.description,
          'category', t.category,
          'recurringId', t.recurring_id,
          'account', t.account,
          'direction', t.direction,
          'fromAccount', t.from_account,
          'toAccount', t.to_account,
          'balanceBefore', t.balance_before,
          'balanceAfter', t.balance_after,
          'fromBalanceAfter', t.from_balance_after,
          'toBalanceAfter', t.to_balance_after
        )
      ) as item
    from public.spend_account_transactions t
    left join raw_snapshot r on true
    where t.user_id = v_user_id
      and t.deleted_at is null
      and coalesce(
            r.data #>> array['deletedRecords', 'accountTransactions', t.id, 'deleted'],
            ''
          ) <> 'true'
      and coalesce(
            r.data #>> array['deletedRecords', 'expenses', t.id, 'deleted'],
            ''
          ) <> 'true'
  ),
  table_deleted as (
    select t.id as tx_id,
           floor(extract(epoch from t.deleted_at) * 1000)::bigint as deleted_ms
    from public.spend_account_transactions t
    where t.user_id = v_user_id
      and t.deleted_at is not null
  ),
  raw_tx as (
    select
      elem ->> 'id' as tx_id,
      case when elem ->> 'type' in ('adjust', 'adjustment') then 'adjustment'
           else elem ->> 'type' end as tx_type,
      1 as src,
      public.spend_json_ms(elem -> 'createdAt') as created_ms,
      case when public.spend_json_ms(elem -> 'updatedAt') > 0
           then public.spend_json_ms(elem -> 'updatedAt')
           else public.spend_json_ms(elem -> 'createdAt') end as updated_ms,
      elem as item
    from raw_snapshot r
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.data #> '{accountData,transactions}') = 'array'
           then r.data #> '{accountData,transactions}' else '[]'::jsonb end
      ||
      case when jsonb_typeof(r.data -> 'customAccountTransactions') = 'array'
           then r.data -> 'customAccountTransactions' else '[]'::jsonb end
    ) as elem
    where jsonb_typeof(elem) = 'object'
      and coalesce(elem ->> 'id', '') <> ''
      and coalesce(
            r.data #>> array['deletedRecords', 'accountTransactions', elem ->> 'id', 'deleted'],
            ''
          ) <> 'true'
  ),
  raw_live as (
    select rt.*
    from raw_tx rt
    where not exists (
      select 1 from table_deleted d
      where d.tx_id = rt.tx_id and d.deleted_ms >= rt.updated_ms
    )
  ),
  combined_acct_tx as (
    select distinct on (tx_id) tx_id, created_ms, updated_ms, item
    from (
      select tx_id, src, created_ms, updated_ms, item
      from table_tx
      where tx_type in ('income', 'adjustment', 'transfer')
      union all
      select tx_id, src, created_ms, updated_ms, item
      from raw_live
      where tx_type in ('income', 'adjustment', 'transfer')
    ) all_tx
    where tx_id is not null and tx_id <> ''
    order by tx_id, updated_ms desc, src asc
  ),
  acct_tx as (
    select coalesce(
      jsonb_agg(item order by coalesce(nullif(created_ms, 0), updated_ms) asc, tx_id asc),
      '[]'::jsonb
    ) as items
    from combined_acct_tx
  ),
  full_ledger_tx as (
    select coalesce(
      jsonb_agg(item order by coalesce(nullif(created_ms, 0), updated_ms) asc, tx_id asc),
      '[]'::jsonb
    ) as items
    from table_tx
  ),
  raw_exp as (
    select
      elem ->> 'id' as exp_id,
      0 as src,
      public.spend_json_ms(elem -> 'createdAt') as created_ms,
      case when public.spend_json_ms(elem -> 'updatedAt') > 0
           then public.spend_json_ms(elem -> 'updatedAt')
           else public.spend_json_ms(elem -> 'createdAt') end as updated_ms,
      elem as item
    from raw_snapshot r
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.data -> 'expenses') = 'array'
           then r.data -> 'expenses' else '[]'::jsonb end
    ) as elem
    where jsonb_typeof(elem) = 'object'
      and coalesce(elem ->> 'id', '') <> ''
      and coalesce(
            r.data #>> array['deletedRecords', 'expenses', elem ->> 'id', 'deleted'],
            ''
          ) <> 'true'
  ),
  table_exp as (
    select
      t.id as exp_id,
      1 as src,
      coalesce(nullif(t.created_at_ms, 0), floor(extract(epoch from t.created_at) * 1000)::bigint) as created_ms,
      coalesce(nullif(t.updated_at_ms, 0), floor(extract(epoch from t.updated_at) * 1000)::bigint) as updated_ms,
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', t.id,
          'createdAt', coalesce(nullif(t.created_at_ms, 0), floor(extract(epoch from t.created_at) * 1000)::bigint),
          'updatedAt', coalesce(nullif(t.updated_at_ms, 0), floor(extract(epoch from t.updated_at) * 1000)::bigint),
          'description', t.description,
          'amount', t.amount,
          'category', coalesce(t.category, case when t.type = 'savings' then 'Savings' else 'Other' end),
          'date', t.transaction_date::text,
          'account', coalesce(t.from_account, t.account, ''),
          'recurringId', t.recurring_id
        )
      ) as item
    from public.spend_account_transactions t
    left join raw_snapshot r on true
    where t.user_id = v_user_id
      and t.deleted_at is null
      and t.type in ('expense', 'savings')
      and coalesce(
            r.data #>> array['deletedRecords', 'expenses', t.id, 'deleted'],
            ''
          ) <> 'true'
  ),
  combined_exp as (
    select distinct on (exp_id) exp_id, created_ms, updated_ms, item
    from (
      select exp_id, src, created_ms, updated_ms, item from raw_exp
      union all
      select exp_id, src, created_ms, updated_ms, item from table_exp
    ) all_exp
    where exp_id is not null and exp_id <> ''
    order by exp_id, updated_ms desc, src asc
  ),
  merged_exp as (
    select coalesce(
      jsonb_agg(item order by coalesce(nullif(created_ms, 0), updated_ms) asc, exp_id asc),
      '[]'::jsonb
    ) as items
    from combined_exp
  )
  select
    case
      when r.data is null then
        jsonb_build_object('data', null, 'updated_at', null, 'normalizedAccountSync', true, 'schemaVersion', '2026.11.17')
      when r.data ? '_encrypted' or r.data ->> 'format' = 'spend-encrypted-v1' then
        jsonb_build_object('data', r.data, 'updated_at', r.updated_at, 'normalizedAccountSync', false, 'schemaVersion', '2026.11.17')
      else
        jsonb_build_object(
          'updated_at', r.updated_at,
          'normalizedAccountSync', true,
          'schemaVersion', '2026.11.17',
          'data',
          jsonb_set(
            jsonb_set(r.data, '{expenses}', me.items, true),
            '{accountData}',
            case when jsonb_typeof(r.data -> 'accountData') = 'object'
                 then r.data -> 'accountData' else '{}'::jsonb end
            || jsonb_build_object(
              'settings',
              coalesce(r.data #> '{accountData,settings}', '{}'::jsonb) ||
              jsonb_build_object(
                'startDate', coalesce(s.start_date::text, r.data #>> '{accountData,settings,startDate}'),
                'balances', coalesce(
                  nullif(s.opening_balances, '{}'::jsonb),
                  nullif(s.balances, '{}'::jsonb),
                  r.data #> '{accountData,settings,openingBalances}',
                  r.data #> '{accountData,settings,balances}',
                  '{}'::jsonb
                ),
                'openingBalances', coalesce(
                  nullif(s.opening_balances, '{}'::jsonb),
                  nullif(s.balances, '{}'::jsonb),
                  r.data #> '{accountData,settings,openingBalances}',
                  r.data #> '{accountData,settings,balances}',
                  '{}'::jsonb
                ),
                'currentBalances', coalesce(
                  nullif(s.current_balances, '{}'::jsonb),
                  r.data #> '{accountData,settings,currentBalances}',
                  '{}'::jsonb
                ),
                'cards', coalesce(
                  case when jsonb_typeof(s.cards) = 'array' and jsonb_array_length(s.cards) > 0
                       then s.cards end,
                  r.data #> '{accountData,settings,cards}',
                  '[]'::jsonb
                ),
                'cardsConfigured', coalesce(
                  case when (r.data #>> '{accountData,settings,cardsConfigured}') in ('true', 'false')
                       then (r.data #>> '{accountData,settings,cardsConfigured}')::boolean end,
                  case when jsonb_typeof(r.data #> '{accountData,settings,cards}') = 'array'
                       then jsonb_array_length(r.data #> '{accountData,settings,cards}') > 0
                       else false end,
                  false
                ),
                'configured', coalesce(
                  s.configured,
                  case when (r.data #>> '{accountData,settings,configured}') in ('true', 'false')
                       then (r.data #>> '{accountData,settings,configured}')::boolean end,
                  false
                ),
                'updatedAt', greatest(
                  coalesce(floor(extract(epoch from s.updated_at) * 1000)::bigint, 0),
                  public.spend_json_ms(r.data #> '{accountData,settings,updatedAt}')
                )
              ),
              'transactions', tx.items,
              'ledgerTransactions', fl.items
            ),
            true
          )
        )
    end
  into v_result
  from (select 1) as dummy
  left join raw_snapshot r on true
  left join acct_settings s on true
  cross join acct_tx tx
  cross join full_ledger_tx fl
  cross join merged_exp me;

  return v_result;
end;
$$;

revoke all on function public.load_spend_user_snapshot() from public, anon;
grant execute on function public.load_spend_user_snapshot() to authenticated;

-- 5. Snapshot summary, reconciliation & checkpoint helpers
create or replace function public.summarize_spend_snapshot(p_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_cards jsonb := coalesce(p_data #> '{accountData,settings,cards}', '[]'::jsonb);
  v_opening jsonb := coalesce(
    p_data #> '{accountData,settings,openingBalances}',
    p_data #> '{accountData,settings,balances}',
    '{}'::jsonb
  );
  v_current jsonb := coalesce(
    p_data #> '{accountData,settings,currentBalances}',
    '{}'::jsonb
  );
  v_expenses jsonb := coalesce(p_data -> 'expenses', '[]'::jsonb);
  v_txs jsonb := coalesce(
    p_data #> '{accountData,transactions}',
    p_data -> 'accountTransactions',
    '[]'::jsonb
  );
  v_card_count integer := 0;
  v_expense_count integer := 0;
  v_tx_count integer := 0;
  v_total_opening numeric := 0;
  v_total_current numeric := 0;
  v_card jsonb;
  v_cid text;
begin
  if jsonb_typeof(v_cards) = 'array' then
    v_card_count := jsonb_array_length(v_cards);
    for v_card in select value from jsonb_array_elements(v_cards) loop
      v_cid := coalesce(nullif(trim(v_card ->> 'id'), ''), '');
      if v_cid <> '' then
        v_total_opening := v_total_opening + coalesce(
          nullif(v_opening ->> v_cid, '')::numeric,
          nullif(v_card ->> 'initialBalance', '')::numeric,
          0
        );
        v_total_current := v_total_current + coalesce(
          nullif(v_current ->> v_cid, '')::numeric,
          nullif(v_card ->> 'currentBalance', '')::numeric,
          nullif(v_opening ->> v_cid, '')::numeric,
          nullif(v_card ->> 'initialBalance', '')::numeric,
          0
        );
      end if;
    end loop;
  end if;

  if jsonb_typeof(v_expenses) = 'array' then
    v_expense_count := jsonb_array_length(v_expenses);
  end if;

  if jsonb_typeof(v_txs) = 'array' then
    v_tx_count := jsonb_array_length(v_txs);
  end if;

  return jsonb_build_object(
    'cardCount', v_card_count,
    'expenseCount', v_expense_count,
    'txCount', v_tx_count,
    'totalOpeningBalance', round(v_total_opening, 2),
    'totalCurrentBalance', round(v_total_current, 2)
  );
exception
  when others then
    return jsonb_build_object(
      'cardCount', 0,
      'expenseCount', 0,
      'txCount', 0,
      'totalOpeningBalance', 0,
      'totalCurrentBalance', 0
    );
end;
$$;

create or replace function public.verify_spend_ledger_reconciliation(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_uid uuid := coalesce(p_user_id, v_caller);
  v_cards jsonb := '[]'::jsonb;
  v_opening jsonb := '{}'::jsonb;
  v_current jsonb := '{}'::jsonb;
  v_card jsonb;
  v_cid text;
  v_cname text;
  v_open_amt numeric;
  v_credits numeric;
  v_debits numeric;
  v_expected numeric;
  v_actual numeric;
  v_diff numeric;
  v_accounts jsonb := '{}'::jsonb;
  v_discrepancy_count integer := 0;
  v_account_count integer := 0;
  v_total_opening numeric := 0;
  v_total_credits numeric := 0;
  v_total_debits numeric := 0;
  v_total_expected numeric := 0;
  v_total_actual numeric := 0;
  v_total_diff numeric := 0;
  v_tx_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_caller is not null and p_user_id is not null and p_user_id <> v_caller then
    raise exception 'Cannot verify ledger for another user' using errcode = '42501';
  end if;

  select
    coalesce(cards, '[]'::jsonb),
    coalesce(opening_balances, balances, '{}'::jsonb),
    coalesce(current_balances, balances, '{}'::jsonb)
  into v_cards, v_opening, v_current
  from public.spend_account_settings
  where user_id = v_uid;

  select count(*)::integer
  into v_tx_count
  from public.spend_account_transactions t
  where t.user_id = v_uid
    and t.deleted_at is null
    and t.type in ('income', 'adjustment', 'transfer');

  if v_cards is null or jsonb_typeof(v_cards) <> 'array' then
    v_cards := '[]'::jsonb;
  end if;

  for v_card in select value from jsonb_array_elements(v_cards) loop
    v_cid := coalesce(nullif(trim(v_card ->> 'id'), ''), '');
    if v_cid = '' then
      continue;
    end if;

    v_account_count := v_account_count + 1;
    v_cname := coalesce(nullif(trim(v_card ->> 'name'), ''), v_cid);
    v_open_amt := round(coalesce(
      nullif(v_opening ->> v_cid, '')::numeric,
      nullif(v_card ->> 'initialBalance', '')::numeric,
      0
    ), 2);

    select round(coalesce(sum(
      case
        when t.type = 'income' and t.account = v_cid then t.amount
        when t.type = 'adjustment' and t.account = v_cid and coalesce(t.direction, 'increase') = 'increase' then t.amount
        when t.type = 'transfer' and t.to_account = v_cid and coalesce(t.from_account, '') <> v_cid then t.amount
        when t.type = 'savings' and t.to_account = v_cid and coalesce(t.from_account, '') <> '' and coalesce(t.from_account, '') <> 'cash' and coalesce(t.from_account, '') <> v_cid then t.amount
        else 0
      end
    ), 0), 2)
    into v_credits
    from public.spend_account_transactions t
    where t.user_id = v_uid
      and t.deleted_at is null;

    select round(coalesce(sum(
      case
        when t.type = 'expense' and t.account = v_cid then t.amount
        when t.type = 'adjustment' and t.account = v_cid and t.direction = 'decrease' then t.amount
        when t.type = 'transfer' and t.from_account = v_cid and coalesce(t.to_account, '') <> v_cid then t.amount
        when t.type = 'savings' and t.from_account = v_cid and coalesce(t.to_account, '') <> v_cid then t.amount
        else 0
      end
    ), 0), 2)
    into v_debits
    from public.spend_account_transactions t
    where t.user_id = v_uid
      and t.deleted_at is null;

    v_expected := round(v_open_amt + v_credits - v_debits, 2);
    v_actual := round(coalesce(
      nullif(v_current ->> v_cid, '')::numeric,
      nullif(v_card ->> 'currentBalance', '')::numeric,
      v_expected
    ), 2);
    v_diff := round(v_actual - v_expected, 2);

    if abs(v_diff) >= 0.01 then
      v_discrepancy_count := v_discrepancy_count + 1;
    end if;

    v_total_opening := round(v_total_opening + v_open_amt, 2);
    v_total_credits := round(v_total_credits + v_credits, 2);
    v_total_debits := round(v_total_debits + v_debits, 2);
    v_total_expected := round(v_total_expected + v_expected, 2);
    v_total_actual := round(v_total_actual + v_actual, 2);
    v_total_diff := round(v_total_diff + abs(v_diff), 2);

    v_accounts := jsonb_set(
      v_accounts,
      array[v_cid],
      jsonb_build_object(
        'id', v_cid,
        'name', v_cname,
        'opening', v_open_amt,
        'credits', v_credits,
        'debits', v_debits,
        'expectedBalance', v_expected,
        'currentBalance', v_actual,
        'discrepancy', v_diff,
        'isBalanced', (abs(v_diff) < 0.01)
      )
    );
  end loop;

  return jsonb_build_object(
    'schemaVersion', '2026.11.17',
    'isBalanced', (v_discrepancy_count = 0),
    'accountCount', v_account_count,
    'txCount', v_tx_count,
    'discrepancyCount', v_discrepancy_count,
    'totalOpening', v_total_opening,
    'totalCredits', v_total_credits,
    'totalDebits', v_total_debits,
    'totalExpectedBalance', v_total_expected,
    'totalCurrentBalance', v_total_actual,
    'totalDiscrepancy', v_total_diff,
    'checkedAt', timezone('utc', now()),
    'accounts', v_accounts
  );
end;
$$;

create or replace function public.capture_spend_backup_checkpoint_internal(
  p_user_id uuid,
  p_data jsonb,
  p_checkpoint_type text default 'daily',
  p_label text default null,
  p_source_updated_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := case
    when p_checkpoint_type in ('daily', 'pre_restore', 'pre_overwrite', 'manual') then p_checkpoint_type
    else 'daily'
  end;
  v_summary jsonb;
  v_card_count integer;
  v_expense_count integer;
  v_tx_count integer;
  v_label text;
  v_id uuid;
  v_today date := (timezone('utc', now()))::date;
begin
  if p_user_id is null or p_data is null or jsonb_typeof(p_data) <> 'object' then
    return null;
  end if;

  v_summary := public.summarize_spend_snapshot(p_data);
  v_card_count := coalesce((v_summary ->> 'cardCount')::integer, 0);
  v_expense_count := coalesce((v_summary ->> 'expenseCount')::integer, 0);
  v_tx_count := coalesce((v_summary ->> 'txCount')::integer, 0);

  if v_type <> 'manual' and v_card_count = 0 and v_expense_count = 0 and v_tx_count = 0 then
    return null;
  end if;

  v_label := coalesce(
    nullif(trim(p_label), ''),
    case v_type
      when 'daily' then 'Daily automatic snapshot'
      when 'pre_restore' then 'Safety snapshot before restore'
      when 'pre_overwrite' then 'Safety snapshot before overwrite'
      else 'Manual backup checkpoint'
    end
  );

  if v_type = 'daily' then
    insert into public.spend_backup_checkpoints (
      user_id, checkpoint_type, checkpoint_date, label, data,
      ledger_summary, card_count, expense_count, tx_count, source_updated_at
    )
    values (
      p_user_id, 'daily', v_today, v_label, p_data,
      v_summary, v_card_count, v_expense_count, v_tx_count,
      coalesce(p_source_updated_at, timezone('utc', now()))
    )
    on conflict (user_id, checkpoint_date) where (checkpoint_type = 'daily')
    do nothing
    returning id into v_id;

    if v_id is null then
      select id into v_id
      from public.spend_backup_checkpoints
      where user_id = p_user_id
        and checkpoint_type = 'daily'
        and checkpoint_date = v_today
      limit 1;
    end if;
  else
    select id into v_id
    from public.spend_backup_checkpoints
    where user_id = p_user_id
      and checkpoint_type = v_type
      and created_at >= timezone('utc', now()) - interval '3 seconds'
      and card_count = v_card_count
      and expense_count = v_expense_count
      and tx_count = v_tx_count
    order by created_at desc
    limit 1;

    if v_id is null then
      insert into public.spend_backup_checkpoints (
        user_id, checkpoint_type, checkpoint_date, label, data,
        ledger_summary, card_count, expense_count, tx_count, source_updated_at
      )
      values (
        p_user_id, v_type, v_today, v_label, p_data,
        v_summary, v_card_count, v_expense_count, v_tx_count,
        coalesce(p_source_updated_at, timezone('utc', now()))
      )
      returning id into v_id;
    end if;
  end if;

  delete from public.spend_backup_checkpoints
  where id in (
    select id
    from (
      select
        id,
        row_number() over (
          partition by user_id, (case when checkpoint_type = 'daily' then 'daily' else 'event' end)
          order by created_at desc
        ) as rn,
        case when checkpoint_type = 'daily' then 60 else 30 end as max_keep
      from public.spend_backup_checkpoints
      where user_id = p_user_id
    ) ranked
    where ranked.rn > ranked.max_keep
  );

  return v_id;
end;
$$;

-- 6. Atomic CRDT-Merging save_spend_user_snapshot RPC
drop function if exists public.save_spend_user_snapshot(jsonb, text);
drop function if exists public.save_spend_user_snapshot(jsonb, text, boolean);

create or replace function public.save_spend_user_snapshot(
  p_data jsonb,
  p_expected_updated_at text default null,
  p_force_overwrite boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing_updated_at timestamptz;
  v_existing_data jsonb;
  v_effective_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_now timestamptz := timezone('utc', now());
  v_existing_has_records boolean := false;
  v_incoming_has_records boolean := false;
  v_reconciliation jsonb := null;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('spend_save:' || v_uid::text, 0));

  select updated_at, data
  into v_existing_updated_at, v_existing_data
  from public.spend_user_data
  where user_id = v_uid
  for update;

  if v_effective_data ->> 'profileAvatar' = '__KEEP_EXISTING_AVATAR__' then
    if v_existing_data is not null and v_existing_data ? 'profileAvatar' then
      v_effective_data := jsonb_set(v_effective_data, '{profileAvatar}', v_existing_data -> 'profileAvatar');
    else
      v_effective_data := v_effective_data - 'profileAvatar';
    end if;
  end if;

  if v_existing_data is not null then
    v_existing_has_records :=
      jsonb_typeof(v_existing_data -> 'expenses') = 'array' and jsonb_array_length(v_existing_data -> 'expenses') > 0
      or jsonb_typeof(v_existing_data #> '{accountData,settings,cards}') = 'array' and jsonb_array_length(v_existing_data #> '{accountData,settings,cards}') > 0
      or jsonb_typeof(v_existing_data #> '{accountData,transactions}') = 'array' and jsonb_array_length(v_existing_data #> '{accountData,transactions}') > 0;
  end if;

  if p_data is not null then
    v_incoming_has_records :=
      jsonb_typeof(v_effective_data -> 'expenses') = 'array' and jsonb_array_length(v_effective_data -> 'expenses') > 0
      or jsonb_typeof(v_effective_data #> '{accountData,settings,cards}') = 'array' and jsonb_array_length(v_effective_data #> '{accountData,settings,cards}') > 0
      or jsonb_typeof(v_effective_data #> '{accountData,transactions}') = 'array' and jsonb_array_length(v_effective_data #> '{accountData,transactions}') > 0
      or jsonb_typeof(v_effective_data #> '{deletedRecords,cards}') = 'object' and (v_effective_data #> '{deletedRecords,cards}') <> '{}'::jsonb
      or jsonb_typeof(v_effective_data #> '{deletedRecords,expenses}') = 'object' and (v_effective_data #> '{deletedRecords,expenses}') <> '{}'::jsonb
      or jsonb_typeof(v_effective_data #> '{deletedRecords,accountTransactions}') = 'object' and (v_effective_data #> '{deletedRecords,accountTransactions}') <> '{}'::jsonb;
  end if;

  if v_existing_has_records and not v_incoming_has_records and not coalesce(p_force_overwrite, false) then
    return jsonb_build_object(
      'status', 'conflict',
      'updated_at', v_existing_updated_at,
      'data', v_existing_data
    );
  end if;

  if v_existing_has_records and coalesce(p_force_overwrite, false) then
    perform public.capture_spend_backup_checkpoint_internal(
      v_uid,
      v_existing_data,
      'pre_restore',
      'Automatic snapshot before restore or overwrite',
      v_existing_updated_at
    );
  end if;

  if v_existing_has_records then
    perform public.capture_spend_backup_checkpoint_internal(
      v_uid,
      v_existing_data,
      'daily',
      'Daily automatic snapshot',
      v_existing_updated_at
    );
  end if;

  -- When not forcing a full overwrite, atomically merge existing and incoming snapshots
  -- so concurrent device edits and deletion tombstones converge on the first save.
  if not coalesce(p_force_overwrite, false) and v_existing_data is not null then
    v_effective_data := public.merge_spend_snapshots_jsonb(v_existing_data, v_effective_data);
  end if;

  insert into public.spend_user_data (user_id, data, updated_at)
  values (v_uid, v_effective_data, v_now)
  on conflict (user_id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at
  returning data, updated_at into v_effective_data, v_now;

  if v_incoming_has_records then
    perform public.capture_spend_backup_checkpoint_internal(
      v_uid,
      v_effective_data,
      'daily',
      'Daily automatic snapshot',
      v_now
    );
  end if;

  v_reconciliation := public.verify_spend_ledger_reconciliation(v_uid);

  return jsonb_build_object(
    'status', 'saved',
    'updated_at', v_now,
    'data', v_effective_data,
    'reconciliation', v_reconciliation
  );
end;
$$;

-- 7. Checkpoint list, create & rollback RPCs (with automatic rollback tombstones)
create or replace function public.list_spend_backup_checkpoints(p_limit integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100));
  v_rows jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'checkpointType', c.checkpoint_type,
      'checkpointDate', c.checkpoint_date,
      'label', c.label,
      'ledgerSummary', c.ledger_summary,
      'cardCount', c.card_count,
      'expenseCount', c.expense_count,
      'txCount', c.tx_count,
      'sourceUpdatedAt', c.source_updated_at,
      'createdAt', c.created_at
    )
    order by c.created_at desc
  ), '[]'::jsonb)
  into v_rows
  from (
    select *
    from public.spend_backup_checkpoints
    where user_id = v_uid
    order by created_at desc
    limit v_limit
  ) c;

  return jsonb_build_object(
    'status', 'ok',
    'checkpoints', v_rows
  );
end;
$$;

create or replace function public.create_spend_backup_checkpoint(
  p_checkpoint_type text default 'manual',
  p_label text default null,
  p_data jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_snapshot jsonb := p_data;
  v_source_updated_at timestamptz := timezone('utc', now());
  v_checkpoint_id uuid;
  v_row record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_snapshot is null or jsonb_typeof(v_snapshot) <> 'object' or v_snapshot = '{}'::jsonb then
    select data, updated_at
    into v_snapshot, v_source_updated_at
    from public.spend_user_data
    where user_id = v_uid;
  end if;

  if v_snapshot is null then
    return jsonb_build_object('status', 'empty', 'checkpoint', null);
  end if;

  v_checkpoint_id := public.capture_spend_backup_checkpoint_internal(
    v_uid,
    v_snapshot,
    coalesce(nullif(trim(p_checkpoint_type), ''), 'manual'),
    p_label,
    v_source_updated_at
  );

  if v_checkpoint_id is null then
    return jsonb_build_object('status', 'skipped', 'checkpoint', null);
  end if;

  select *
  into v_row
  from public.spend_backup_checkpoints
  where id = v_checkpoint_id
    and user_id = v_uid;

  return jsonb_build_object(
    'status', 'created',
    'checkpoint', jsonb_build_object(
      'id', v_row.id,
      'checkpointType', v_row.checkpoint_type,
      'checkpointDate', v_row.checkpoint_date,
      'label', v_row.label,
      'ledgerSummary', v_row.ledger_summary,
      'cardCount', v_row.card_count,
      'expenseCount', v_row.expense_count,
      'txCount', v_row.tx_count,
      'sourceUpdatedAt', v_row.source_updated_at,
      'createdAt', v_row.created_at
    )
  );
end;
$$;

create or replace function public.restore_spend_backup_checkpoint(
  p_checkpoint_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target record;
  v_existing_data jsonb;
  v_existing_updated_at timestamptz;
  v_now timestamptz := timezone('utc', now());
  v_now_ms bigint := floor(extract(epoch from v_now) * 1000)::bigint;
  v_restored_data jsonb;
  v_del_tx jsonb := '{}'::jsonb;
  v_del_exp jsonb := '{}'::jsonb;
  v_del_rec jsonb := '{}'::jsonb;
  v_reconciliation jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('spend_save:' || v_uid::text, 0));

  select *
  into v_target
  from public.spend_backup_checkpoints
  where id = p_checkpoint_id
    and user_id = v_uid;

  if not found or v_target.data is null then
    raise exception 'Backup checkpoint not found' using errcode = 'P0002';
  end if;

  select data, updated_at
  into v_existing_data, v_existing_updated_at
  from public.spend_user_data
  where user_id = v_uid
  for update;

  if v_existing_data is not null then
    perform public.capture_spend_backup_checkpoint_internal(
      v_uid,
      v_existing_data,
      'pre_restore',
      'Safety snapshot before restoring ' || to_char(v_target.created_at, 'YYYY-MM-DD HH24:MI'),
      v_existing_updated_at
    );
  end if;

  v_restored_data := v_target.data;

  -- Mark any transaction/expense/schedule present in v_existing_data but absent in v_restored_data
  -- as deleted in deletedRecords so other open devices drop rolled-back records immediately.
  if v_existing_data is not null then
    v_del_tx := coalesce(v_restored_data #> '{deletedRecords,accountTransactions}', '{}'::jsonb);
    select coalesce(
      jsonb_object_agg(
        ex_id,
        jsonb_build_object('deleted', true, 'updatedAt', v_now_ms)
      ),
      '{}'::jsonb
    )
    into v_del_tx
    from (
      select elem ->> 'id' as ex_id
      from jsonb_array_elements(
        case when jsonb_typeof(v_existing_data #> '{accountData,transactions}') = 'array'
             then v_existing_data #> '{accountData,transactions}' else '[]'::jsonb end
      ) elem
      where coalesce(elem ->> 'id', '') <> ''
        and not exists (
          select 1
          from jsonb_array_elements(
            case when jsonb_typeof(v_restored_data #> '{accountData,transactions}') = 'array'
                 then v_restored_data #> '{accountData,transactions}' else '[]'::jsonb end
          ) target_elem
          where target_elem ->> 'id' = elem ->> 'id'
        )
    ) removed_tx;

    v_restored_data := jsonb_set(
      v_restored_data,
      '{deletedRecords,accountTransactions}',
      coalesce(v_restored_data #> '{deletedRecords,accountTransactions}', '{}'::jsonb) || v_del_tx,
      true
    );

    select coalesce(
      jsonb_object_agg(
        ex_id,
        jsonb_build_object('deleted', true, 'updatedAt', v_now_ms)
      ),
      '{}'::jsonb
    )
    into v_del_exp
    from (
      select elem ->> 'id' as ex_id
      from jsonb_array_elements(
        case when jsonb_typeof(v_existing_data -> 'expenses') = 'array'
             then v_existing_data -> 'expenses' else '[]'::jsonb end
      ) elem
      where coalesce(elem ->> 'id', '') <> ''
        and not exists (
          select 1
          from jsonb_array_elements(
            case when jsonb_typeof(v_restored_data -> 'expenses') = 'array'
                 then v_restored_data -> 'expenses' else '[]'::jsonb end
          ) target_elem
          where target_elem ->> 'id' = elem ->> 'id'
        )
    ) removed_exp;

    v_restored_data := jsonb_set(
      v_restored_data,
      '{deletedRecords,expenses}',
      coalesce(v_restored_data #> '{deletedRecords,expenses}', '{}'::jsonb) || v_del_exp,
      true
    );
  end if;

  insert into public.spend_user_data (user_id, data, updated_at)
  values (v_uid, v_restored_data, v_now)
  on conflict (user_id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at
  returning data, updated_at into v_restored_data, v_now;

  v_reconciliation := public.verify_spend_ledger_reconciliation(v_uid);

  return jsonb_build_object(
    'status', 'restored',
    'checkpoint_id', v_target.id,
    'checkpoint_date', v_target.checkpoint_date,
    'checkpoint_type', v_target.checkpoint_type,
    'updated_at', v_now,
    'data', v_restored_data,
    'reconciliation', v_reconciliation
  );
end;
$$;

-- 7b. Background Push Reminder Atomic Claim RPC (required by send-due-reminders Edge Function)
do $$
begin
  if to_regclass('public.push_reminders') is not null then
    alter table public.push_reminders
      add column if not exists claim_until timestamptz;
  end if;
end;
$$;

create or replace function public.preserve_push_reminder_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tz text := coalesce(nullif(btrim(new.timezone), ''), 'UTC');
begin
  if tg_op = 'INSERT' then
    begin
      new.next_notify_at := (new.next_date + new.reminder_time::time) at time zone v_tz;
    exception when others then
      new.next_notify_at := (new.next_date + new.reminder_time::time) at time zone 'UTC';
    end;
    new.updated_at := timezone('utc', now());
    return new;
  end if;

  if new.next_date > old.next_date then
    new.pending_notification := false;
    new.claim_until := null;
    if new.next_notify_at is not distinct from old.next_notify_at then
      begin
        new.next_notify_at := (new.next_date + new.reminder_time::time) at time zone v_tz;
      exception when others then
        new.next_notify_at := (new.next_date + new.reminder_time::time) at time zone 'UTC';
      end;
    end if;
    new.updated_at := timezone('utc', now());
    return new;
  end if;

  if new.claim_until is not null and new.next_date = old.next_date then
    new.next_notify_at := old.next_notify_at;
    new.updated_at := timezone('utc', now());
    return new;
  end if;

  if old.claim_until is not null and new.claim_until is null and new.next_date = old.next_date then
    new.next_notify_at := old.next_notify_at;
    new.pending_notification := false;
    new.updated_at := timezone('utc', now());
    return new;
  end if;

  begin
    new.next_notify_at := (new.next_date + new.reminder_time::time) at time zone v_tz;
  exception when others then
    new.next_notify_at := (new.next_date + new.reminder_time::time) at time zone 'UTC';
  end;

  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop function if exists public.claim_due_push_reminders(integer, integer);
create or replace function public.claim_due_push_reminders(
  p_limit integer default 200,
  p_lease_seconds integer default 300
)
returns setof public.push_reminders
language sql
security definer
set search_path = ''
as $$
  with due as (
    select user_id, device_id, schedule_id
    from public.push_reminders
    where active
      and next_notify_at <= now()
      and (claim_until is null or claim_until <= now())
    order by next_notify_at asc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    for update skip locked
  )
  update public.push_reminders r
  set claim_until = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300))),
      pending_notification = true
  from due
  where r.user_id = due.user_id
    and r.device_id = due.device_id
    and r.schedule_id = due.schedule_id
  returning r.*;
$$;

revoke all on function public.claim_due_push_reminders(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_due_push_reminders(integer, integer) to service_role;

-- 8. SQL Installation Diagnostic Function (for both Supabase SQL Editor & In-App Health Check)
create or replace function public.verify_spend_sql_installation()
returns table (
  component text,
  category text,
  status text,
  details text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    'spend_user_data'::text,
    'Table'::text,
    case when to_regclass('public.spend_user_data') is not null then '✅ INSTALLED' else '❌ MISSING' end,
    'Primary user snapshot store'::text
  union all
  select
    'spend_account_settings'::text,
    'Table + Columns'::text,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'spend_account_settings' and column_name = 'current_balances'
    ) then '✅ INSTALLED' else '❌ MISSING' end,
    'Opening & live current balances per card/MFS account'::text
  union all
  select
    'spend_account_transactions'::text,
    'Table + Columns'::text,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'spend_account_transactions' and column_name = 'updated_at_ms'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'spend_account_transactions' and column_name = 'balance_after'
    ) then '✅ INSTALLED' else '❌ MISSING' end,
    'Unified MFS ledger with balance_before/after & client ms timestamps'::text
  union all
  select
    'spend_backup_checkpoints'::text,
    'Table'::text,
    case when to_regclass('public.spend_backup_checkpoints') is not null then '✅ INSTALLED' else '❌ MISSING' end,
    'Immutable daily & pre-restore cloud backup checkpoints'::text
  union all
  select
    'sync_spend_accounts_from_snapshot'::text,
    'Trigger'::text,
    case when exists (
      select 1 from pg_trigger
      where tgname = 'sync_spend_accounts_from_snapshot'
    ) then '✅ INSTALLED' else '❌ MISSING' end,
    'Automatic ledger computation & soft-delete sync trigger'::text
  union all
  select
    'load_spend_user_snapshot'::text,
    'RPC Function'::text,
    case when to_regprocedure('public.load_spend_user_snapshot()') is not null then '✅ INSTALLED' else '❌ MISSING' end,
    'Tombstone-filtered multi-device snapshot loader'::text
  union all
  select
    'save_spend_user_snapshot'::text,
    'RPC Function'::text,
    case when to_regprocedure('public.save_spend_user_snapshot(jsonb,text,boolean)') is not null then '✅ INSTALLED' else '❌ MISSING' end,
    'Atomic CRDT-merging snapshot save with checkpointing'::text
  union all
  select
    'verify_spend_ledger_reconciliation'::text,
    'RPC Function'::text,
    case when to_regprocedure('public.verify_spend_ledger_reconciliation(uuid)') is not null then '✅ INSTALLED' else '❌ MISSING' end,
    'Server-side Opening + Credits - Debits = Current verification'::text
  union all
  select
    'restore_spend_backup_checkpoint'::text,
    'RPC Function'::text,
    case when to_regprocedure('public.restore_spend_backup_checkpoint(uuid)') is not null then '✅ INSTALLED' else '❌ MISSING' end,
    'One-tap checkpoint rollback with cross-device tombstones'::text
  union all
  select
    'claim_due_push_reminders'::text,
    'RPC Function'::text,
    case when to_regprocedure('public.claim_due_push_reminders(integer,integer)') is not null then '✅ INSTALLED' else '❌ MISSING' end,
    'Atomic skip-locked lease RPC for send-due-reminders Edge Function'::text
  union all
  select
    'supabase_realtime'::text,
    'Realtime Publication'::text,
    case when exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'spend_user_data'
    ) then '✅ INSTALLED' else '❌ MISSING' end,
    'Live WebSocket push across signed-in devices'::text;
end;
$$;

revoke all on function public.summarize_spend_snapshot(jsonb) from public;
revoke all on function public.merge_spend_snapshots_jsonb(jsonb, jsonb) from public;
revoke all on function public.verify_spend_ledger_reconciliation(uuid) from public;
revoke all on function public.capture_spend_backup_checkpoint_internal(uuid, jsonb, text, text, timestamptz) from public;
revoke all on function public.save_spend_user_snapshot(jsonb, text, boolean) from public, anon;
revoke all on function public.list_spend_backup_checkpoints(integer) from public;
revoke all on function public.create_spend_backup_checkpoint(text, text, jsonb) from public;
revoke all on function public.restore_spend_backup_checkpoint(uuid) from public;
revoke all on function public.verify_spend_sql_installation() from public, anon;

grant execute on function public.summarize_spend_snapshot(jsonb) to authenticated;
grant execute on function public.merge_spend_snapshots_jsonb(jsonb, jsonb) to authenticated;
grant execute on function public.verify_spend_ledger_reconciliation(uuid) to authenticated;
grant execute on function public.save_spend_user_snapshot(jsonb, text, boolean) to authenticated;
grant execute on function public.list_spend_backup_checkpoints(integer) to authenticated;
grant execute on function public.create_spend_backup_checkpoint(text, text, jsonb) to authenticated;
grant execute on function public.restore_spend_backup_checkpoint(uuid) to authenticated;
grant execute on function public.verify_spend_sql_installation() to authenticated, service_role;

-- 9. Ensure Realtime publication includes all 3 tables & backfill existing rows
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'spend_user_data'
    ) then
      alter publication supabase_realtime add table public.spend_user_data;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'spend_account_settings'
    ) then
      alter publication supabase_realtime add table public.spend_account_settings;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'spend_account_transactions'
    ) then
      alter publication supabase_realtime add table public.spend_account_transactions;
    end if;
  end if;
end;
$$;

-- Touch existing spend_user_data rows so the updated trigger reconciles all rows immediately
update public.spend_user_data
set data = data,
    updated_at = timezone('utc', now())
where data is not null
  and jsonb_typeof(data) = 'object';

commit;

-- Display verification checklist immediately in Supabase SQL Editor results
select * from public.verify_spend_sql_installation();

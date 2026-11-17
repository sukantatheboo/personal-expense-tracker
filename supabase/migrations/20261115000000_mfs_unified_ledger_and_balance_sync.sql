-- =============================================================================
-- Migration: 20261115000000_mfs_unified_ledger_and_balance_sync.sql
-- Purpose  : Self-contained MFS-grade unified transaction ledger, live account
--            balance sync, atomic snapshot save RPC, and automatic backfill.
--            1. Defines safe parsing helpers (spend_try_parse_date,
--               spend_try_parse_numeric, spend_json_ms).
--            2. Expands spend_account_settings with cards, balances,
--               opening_balances, and current_balances.
--            3. Expands spend_account_transactions to record EVERY balance-
--               affecting event ('expense', 'savings', 'income', 'adjustment',
--               'transfer') with per-transaction running balance snapshots
--               (balance_before, balance_after, from_balance_after,
--               to_balance_after), dropping legacy account ID restrictions.
--            4. Upgrades sync_spend_accounts_from_snapshot(),
--               load_spend_user_snapshot(), and save_spend_user_snapshot().
--            5. Backfills all existing spend_user_data rows automatically.
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Safe Helper Functions (Self-Contained)
-- ─────────────────────────────────────────────────────────────────────────────
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

create or replace function public.spend_try_parse_numeric(p_value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_amount numeric;
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  v_amount := btrim(p_value)::numeric;
  if v_amount::text in ('NaN', 'Infinity', '-Infinity') then
    return null;
  end if;
  if abs(v_amount) >= 100000000000000 then
    return null;
  end if;
  return round(v_amount, 2);
exception when others then
  return null;
end;
$$;

create or replace function public.spend_json_ms(p_value jsonb)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_value is null then
    return 0;
  end if;
  if jsonb_typeof(p_value) not in ('number', 'string') then
    return 0;
  end if;
  v_text := p_value #>> '{}';
  if v_text ~ '^\d+(\.\d+)?$' then
    return floor(v_text::numeric)::bigint;
  end if;
  if jsonb_typeof(p_value) = 'string' then
    return floor(extract(epoch from v_text::timestamptz) * 1000)::bigint;
  end if;
  return 0;
exception when others then
  return 0;
end;
$$;

revoke all on function public.spend_try_parse_date(text) from public, anon, authenticated;
revoke all on function public.spend_try_parse_numeric(text) from public, anon, authenticated;
revoke all on function public.spend_json_ms(jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Expand spend_account_settings with cards, opening_balances & current_balances
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.spend_account_settings
  add column if not exists savings_balance numeric(16, 2) not null default 0
    check (savings_balance >= 0),
  add column if not exists cards jsonb not null default '[]'::jsonb
    check (jsonb_typeof(cards) = 'array'),
  add column if not exists balances jsonb not null default '{}'::jsonb
    check (jsonb_typeof(balances) = 'object'),
  add column if not exists opening_balances jsonb not null default '{}'::jsonb
    check (jsonb_typeof(opening_balances) = 'object'),
  add column if not exists current_balances jsonb not null default '{}'::jsonb
    check (jsonb_typeof(current_balances) = 'object');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Expand spend_account_transactions for unified MFS ledger & running balances
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.spend_account_transactions
  add column if not exists category text,
  add column if not exists recurring_id text,
  add column if not exists balance_before numeric(16, 2),
  add column if not exists balance_after numeric(16, 2),
  add column if not exists from_balance_after numeric(16, 2),
  add column if not exists to_balance_after numeric(16, 2);

-- Drop any legacy CHECK constraints on spend_account_transactions that restrict
-- type to ('income','adjustment','transfer') or account IDs to ('bkash','bank','savings')
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

create index if not exists spend_account_transactions_user_date_idx
  on public.spend_account_transactions (user_id, transaction_date desc, created_at desc)
  where deleted_at is null;

create index if not exists spend_account_transactions_user_deleted_idx
  on public.spend_account_transactions (user_id, id)
  where deleted_at is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Unified Snapshot -> Ledger & Live Balance Trigger
--    (public.sync_spend_accounts_from_snapshot)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sync_spend_accounts_from_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accounts          jsonb;
  v_settings          jsonb;
  v_raw_balances      jsonb;
  v_opening_balances  jsonb := '{}'::jsonb;
  v_running_balances  jsonb := '{}'::jsonb;
  v_cards             jsonb;
  v_synced_cards      jsonb := '[]'::jsonb;
  v_transactions      jsonb;
  v_extra             jsonb;
  v_expenses          jsonb;
  v_merged_tx         jsonb;
  v_tx_tombstones     jsonb;
  v_exp_tombstones    jsonb;
  v_start_date        date;
  v_configured        boolean;
  v_settings_ts       timestamptz;
  v_savings_card_id   text;
  v_bkash_live        numeric := 0;
  v_bank_live         numeric := 0;
  v_savings_live      numeric := 0;
  v_max_ts            timestamptz := timezone('utc', now()) + interval '5 minutes';
  v_settings_ms       bigint;
  v_card              jsonb;
  v_card_id           text;
  v_card_init         numeric;
  v_rec               record;
  v_acct_bal_before   numeric;
  v_acct_bal_after    numeric;
  v_from_bal_before   numeric;
  v_from_bal_after    numeric;
  v_to_bal_before     numeric;
  v_to_bal_after      numeric;
begin
  if new.data is null or jsonb_typeof(new.data) <> 'object' then
    return new;
  end if;

  if auth.uid() is not null and auth.uid() <> new.user_id then
    raise exception 'Unauthorized account sync for user %', new.user_id
      using errcode = '42501';
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;

  -- GUARD 1: Client-side encrypted snapshot
  if new.data ? '_encrypted' or new.data ->> 'format' = 'spend-encrypted-v1' then
    return new;
  end if;

  -- GUARD 2: Partial snapshot without accountData object
  v_accounts := new.data -> 'accountData';
  if jsonb_typeof(v_accounts) is distinct from 'object'
     or jsonb_typeof(v_accounts -> 'settings') is distinct from 'object'
     or jsonb_typeof(v_accounts -> 'transactions') is distinct from 'array' then
    return new;
  end if;

  v_settings := v_accounts -> 'settings';
  v_raw_balances := case
    when jsonb_typeof(v_settings -> 'openingBalances') = 'object'
      and v_settings -> 'openingBalances' <> '{}'::jsonb
      then v_settings -> 'openingBalances'
    when jsonb_typeof(v_settings -> 'balances') = 'object'
      then v_settings -> 'balances'
    else '{}'::jsonb
  end;
  v_cards := case when jsonb_typeof(v_settings -> 'cards') = 'array'
                  then v_settings -> 'cards' else '[]'::jsonb end;
  v_transactions := v_accounts -> 'transactions';
  v_extra := case when jsonb_typeof(new.data -> 'customAccountTransactions') = 'array'
                  then new.data -> 'customAccountTransactions' else '[]'::jsonb end;
  v_merged_tx := v_transactions || v_extra;
  v_expenses := case when jsonb_typeof(new.data -> 'expenses') = 'array'
                     then new.data -> 'expenses' else '[]'::jsonb end;

  v_tx_tombstones := case
    when jsonb_typeof(new.data #> '{deletedRecords,accountTransactions}') = 'object'
      then new.data #> '{deletedRecords,accountTransactions}'
    else '{}'::jsonb
  end;
  v_exp_tombstones := case
    when jsonb_typeof(new.data #> '{deletedRecords,expenses}') = 'object'
      then new.data #> '{deletedRecords,expenses}'
    else '{}'::jsonb
  end;

  v_start_date := public.spend_try_parse_date(v_settings ->> 'startDate');
  v_settings_ms := public.spend_json_ms(v_settings -> 'updatedAt');
  v_settings_ts := case when v_settings_ms > 0
                        then to_timestamp(v_settings_ms / 1000.0)
                        else coalesce(new.updated_at, timezone('utc', now())) end;
  v_settings_ts := least(v_settings_ts, v_max_ts);

  -- Identify singleton savings card ID if present
  select c ->> 'id'
    into v_savings_card_id
  from jsonb_array_elements(v_cards) as c
  where jsonb_typeof(c) = 'object'
    and (c ->> 'category' = 'savings'
      or c ->> 'type' = 'savings'
      or c ->> 'provider' = 'savings'
      or c ->> 'id' = 'savings')
  limit 1;

  -- Build opening balances map from cards and v_raw_balances
  v_opening_balances := v_raw_balances;
  for v_card in select value from jsonb_array_elements(v_cards)
  loop
    if jsonb_typeof(v_card) = 'object' and coalesce(btrim(v_card ->> 'id'), '') <> '' then
      v_card_id := btrim(v_card ->> 'id');
      v_card_init := round(greatest(0, coalesce(
        public.spend_try_parse_numeric(v_raw_balances ->> v_card_id),
        public.spend_try_parse_numeric(v_card ->> 'initialBalance'),
        0
      )), 2);
      v_opening_balances := jsonb_set(v_opening_balances, array[v_card_id], to_jsonb(v_card_init), true);
    end if;
  end loop;

  v_running_balances := v_opening_balances;

  -- Stage valid ledger entries from both accountData.transactions and expenses
  create temporary table if not exists _spend_staged_ledger (
    id text primary key,
    tx_type text not null,
    amount numeric(16, 2) not null,
    tx_date date not null,
    description text not null,
    category text,
    recurring_id text,
    account text,
    direction text,
    from_account text,
    to_account text,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    balance_before numeric(16, 2),
    balance_after numeric(16, 2),
    from_balance_after numeric(16, 2),
    to_balance_after numeric(16, 2)
  ) on commit drop;

  truncate table _spend_staged_ledger;

  with raw_acct_tx as (
    select
      left(btrim(coalesce(item ->> 'id', '')), 120) as id,
      case when item ->> 'type' in ('adjust', 'adjustment') then 'adjustment'
           else item ->> 'type' end as tx_type,
      round(coalesce(public.spend_try_parse_numeric(item ->> 'amount'), 0), 2) as amount,
      public.spend_try_parse_date(item ->> 'date') as tx_date,
      left(coalesce(item ->> 'description', item ->> 'note', ''), 80) as description,
      null::text as category,
      null::text as recurring_id,
      nullif(left(btrim(coalesce(item ->> 'account', item ->> 'acct', '')), 120), '') as account,
      case
        when coalesce(item ->> 'direction', item ->> 'dir') in ('up', 'increase') then 'increase'
        when coalesce(item ->> 'direction', item ->> 'dir') in ('down', 'decrease') then 'decrease'
        else null
      end as direction,
      nullif(left(btrim(coalesce(item ->> 'fromAccount', item ->> 'from_account', item ->> 'acct', '')), 120), '') as from_account,
      nullif(left(btrim(coalesce(item ->> 'toAccount', item ->> 'to_account', item ->> 'to', '')), 120), '') as to_account,
      public.spend_json_ms(item -> 'createdAt') as created_ms,
      case
        when public.spend_json_ms(item -> 'updatedAt') > 0
          then public.spend_json_ms(item -> 'updatedAt')
        else public.spend_json_ms(item -> 'createdAt')
      end as updated_ms
    from jsonb_array_elements(v_merged_tx) as item
    where jsonb_typeof(item) = 'object'
  ),
  live_acct_tx as (
    select p.*
    from raw_acct_tx p
    where char_length(p.id) between 1 and 120
      and p.tx_type in ('income', 'adjustment', 'transfer')
      and p.amount > 0
      and p.tx_date is not null
      and (
        (p.tx_type = 'income' and p.account is not null)
        or (p.tx_type = 'adjustment' and p.account is not null and p.direction in ('increase', 'decrease'))
        or (p.tx_type = 'transfer' and p.from_account is not null and p.to_account is not null and p.from_account <> p.to_account)
      )
      and not (
        coalesce(v_tx_tombstones #>> array[p.id, 'deleted'], '') = 'true'
        and public.spend_json_ms(v_tx_tombstones #> array[p.id, 'updatedAt']) >= p.updated_ms
      )
  ),
  raw_exp_tx as (
    select
      left(btrim(coalesce(item ->> 'id', '')), 120) as id,
      case
        when coalesce(item ->> 'category', '') = 'Savings' and v_savings_card_id is not null
          then 'savings'
        else 'expense'
      end as tx_type,
      round(coalesce(public.spend_try_parse_numeric(item ->> 'amount'), 0), 2) as amount,
      public.spend_try_parse_date(item ->> 'date') as tx_date,
      left(coalesce(item ->> 'description', item ->> 'category', 'Expense'), 80) as description,
      nullif(left(btrim(coalesce(item ->> 'category', 'Other')), 40), '') as category,
      nullif(left(btrim(coalesce(item ->> 'recurringId', '')), 120), '') as recurring_id,
      nullif(left(btrim(coalesce(item ->> 'account', '')), 120), '') as raw_account,
      public.spend_json_ms(item -> 'createdAt') as created_ms,
      case
        when public.spend_json_ms(item -> 'updatedAt') > 0
          then public.spend_json_ms(item -> 'updatedAt')
        else public.spend_json_ms(item -> 'createdAt')
      end as updated_ms
    from jsonb_array_elements(v_expenses) as item
    where jsonb_typeof(item) = 'object'
  ),
  live_exp_tx as (
    select
      e.id,
      e.tx_type,
      e.amount,
      e.tx_date,
      e.description,
      e.category,
      e.recurring_id,
      case
        when e.tx_type = 'expense' then e.raw_account
        when e.tx_type = 'savings' and (e.raw_account is null or e.raw_account = 'cash' or e.raw_account = v_savings_card_id)
          then v_savings_card_id
        else e.raw_account
      end as account,
      null::text as direction,
      case
        when e.tx_type = 'savings' and e.raw_account is not null and e.raw_account <> 'cash' and e.raw_account <> v_savings_card_id
          then e.raw_account
        else null
      end as from_account,
      case
        when e.tx_type = 'savings' and v_savings_card_id is not null
          then v_savings_card_id
        else null
      end as to_account,
      e.created_ms,
      e.updated_ms
    from raw_exp_tx e
    where char_length(e.id) between 1 and 120
      and e.amount > 0
      and e.tx_date is not null
      and (
        (e.tx_type = 'expense' and e.raw_account is not null and e.raw_account <> 'cash')
        or (e.tx_type = 'savings' and v_savings_card_id is not null and e.raw_account is not null and e.raw_account <> 'cash')
      )
      and not (
        coalesce(v_exp_tombstones #>> array[e.id, 'deleted'], '') = 'true'
        and public.spend_json_ms(v_exp_tombstones #> array[e.id, 'updatedAt']) >= e.updated_ms
      )
  ),
  combined_valid as (
    select distinct on (id)
      id,
      tx_type,
      amount,
      tx_date,
      description,
      category,
      recurring_id,
      account,
      direction,
      from_account,
      to_account,
      least(
        case when created_ms > 0 then to_timestamp(created_ms / 1000.0) else timezone('utc', now()) end,
        v_max_ts
      ) as created_at,
      least(
        case when updated_ms > 0 then to_timestamp(updated_ms / 1000.0)
             when created_ms > 0 then to_timestamp(created_ms / 1000.0)
             else timezone('utc', now()) end,
        v_max_ts
      ) as updated_at
    from (
      select * from live_acct_tx
      union all
      select * from live_exp_tx
    ) u
    order by id, updated_ms desc
  )
  insert into _spend_staged_ledger (
    id, tx_type, amount, tx_date, description, category, recurring_id,
    account, direction, from_account, to_account, created_at, updated_at
  )
  select
    id, tx_type, amount, tx_date, description, category, recurring_id,
    account, direction, from_account, to_account, created_at, updated_at
  from combined_valid;

  -- Replay the staged ledger in chronological order to compute MFS running balances
  for v_rec in
    select *
    from _spend_staged_ledger
    order by tx_date asc, created_at asc, id asc
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

  -- Enrich each card in v_cards with both initialBalance and live currentBalance
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

  -- Upsert unified ledger rows into spend_account_transactions
  insert into public.spend_account_transactions (
    user_id, id, type, amount, transaction_date, description,
    category, recurring_id, account, direction, from_account, to_account,
    balance_before, balance_after, from_balance_after, to_balance_after,
    created_at, updated_at, deleted_at
  )
  select
    new.user_id, id, tx_type, amount, tx_date, description,
    category, recurring_id, account, direction, from_account, to_account,
    balance_before, balance_after, from_balance_after, to_balance_after,
    created_at, updated_at, null
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
    updated_at         = greatest(public.spend_account_transactions.updated_at, excluded.updated_at),
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

  -- Soft-delete rows removed from the snapshot
  update public.spend_account_transactions t
  set deleted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where t.user_id = new.user_id
    and t.deleted_at is null
    and not exists (select 1 from _spend_staged_ledger s where s.id = t.id);

  return new;
end;
$$;

revoke all on function public.sync_spend_accounts_from_snapshot() from public, anon, authenticated;

drop trigger if exists sync_spend_accounts_from_snapshot on public.spend_user_data;
create trigger sync_spend_accounts_from_snapshot
  before insert or update of data on public.spend_user_data
  for each row execute function public.sync_spend_accounts_from_snapshot();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Authoritative Snapshot Loader (public.load_spend_user_snapshot)
--    Returns openingBalances, currentBalances, synced cards, merged expenses,
--    and accountData across devices
-- ─────────────────────────────────────────────────────────────────────────────
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
      floor(extract(epoch from t.created_at) * 1000)::bigint as created_ms,
      floor(extract(epoch from t.updated_at) * 1000)::bigint as updated_ms,
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', t.id,
          'createdAt', floor(extract(epoch from t.created_at) * 1000)::bigint,
          'updatedAt', floor(extract(epoch from t.updated_at) * 1000)::bigint,
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
      floor(extract(epoch from t.created_at) * 1000)::bigint as created_ms,
      floor(extract(epoch from t.updated_at) * 1000)::bigint as updated_ms,
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', t.id,
          'createdAt', floor(extract(epoch from t.created_at) * 1000)::bigint,
          'updatedAt', floor(extract(epoch from t.updated_at) * 1000)::bigint,
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
        jsonb_build_object('data', null, 'updated_at', null, 'normalizedAccountSync', true)
      when r.data ? '_encrypted' or r.data ->> 'format' = 'spend-encrypted-v1' then
        jsonb_build_object('data', r.data, 'updated_at', r.updated_at, 'normalizedAccountSync', false)
      else
        jsonb_build_object(
          'updated_at', r.updated_at,
          'normalizedAccountSync', true,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Strict Atomic Snapshot Save RPC (public.save_spend_user_snapshot)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.save_spend_user_snapshot(jsonb, text);
drop function if exists public.save_spend_user_snapshot(jsonb, text, boolean);

create or replace function public.save_spend_user_snapshot(
  p_data jsonb,
  p_expected_updated_at text default null,
  p_force_overwrite boolean default false
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_current_updated_at timestamptz;
  v_expected_parsed timestamptz;
  v_new_updated_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Snapshot payload must be a JSON object' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('spend_save:' || v_uid::text, 0));

  select updated_at into v_current_updated_at
  from public.spend_user_data
  where user_id = v_uid
  for update;

  if v_current_updated_at is not null and not coalesce(p_force_overwrite, false) then
    if p_expected_updated_at is null or btrim(p_expected_updated_at) = '' then
      return null;
    end if;

    begin
      v_expected_parsed := p_expected_updated_at::timestamptz;
    exception when others then
      return null;
    end;

    if abs(extract(epoch from (v_current_updated_at - v_expected_parsed))) >= 0.002 then
      return null;
    end if;
  end if;

  insert into public.spend_user_data (user_id, data, updated_at)
  values (v_uid, p_data, timezone('utc', now()))
  on conflict (user_id) do update
  set data = excluded.data,
      updated_at = timezone('utc', now())
  returning updated_at into v_new_updated_at;

  return v_new_updated_at;
end;
$$;

revoke all on function public.save_spend_user_snapshot(jsonb, text, boolean) from public, anon;
grant execute on function public.save_spend_user_snapshot(jsonb, text, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Ensure Realtime Publication Includes All 3 Tables & Backfill Existing Rows
-- ─────────────────────────────────────────────────────────────────────────────
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

-- Touch existing spend_user_data rows so the new trigger backfills cards,
-- opening_balances, current_balances, and unified ledger transactions right away.
update public.spend_user_data
set data = data
where data is not null
  and jsonb_typeof(data) = 'object';

commit;

-- =============================================================================
-- Migration: 20261125000000_p0_p1_security_occ_and_ledger_hardening.sql
-- Purpose  : P0 & P1 Backend Security, OCC, Ledger & Push Worker Hardening
--
-- Fixes included:
--   [P0-1] Revoke default Supabase `anon` / `authenticated` EXECUTE grants on
--          internal helpers & lock down SECURITY DEFINER RPCs against IDOR:
--            - verify_spend_ledger_reconciliation (no anon bypass)
--            - capture_spend_backup_checkpoint_internal (strict caller guard)
--   [P0-2] Enforce RPC-only writes on spend_user_data and
--          spend_backup_checkpoints (SELECT-only RLS for authenticated) +
--          512 KB size constraint and PAN/CVV sanitization on checkpoints.
--   [P0-3] Scrub pre-20261123 unmasked PAN/CVV remnants in
--          spend_backup_checkpoints and spend_account_change_history.
--   [P0-4] Restore NaN/Infinity/overflow guards in spend_try_parse_numeric(),
--          restore partial-snapshot/depth/auth guards in
--          sync_spend_accounts_from_snapshot(), and drop the duplicate
--          preserve_push_reminder_progress trigger on push_reminders.
--   [P1-1] Restore millisecond OCC enforcement in save_spend_user_snapshot(),
--          support encrypted snapshots cleanly, fix merge_spend_snapshots_jsonb()
--          edge cases, and stamp rolled-back records on restore so stale
--          offline edits never overwrite restored checkpoints.
--   [P1-2] Preserve explicit non-BDT currencies (e.g. USD Cash wallets), track
--          per-transaction currency on spend_account_transactions, add table-
--          level shape/amount constraints, and cover all accounts in
--          verify_spend_ledger_reconciliation().
--   [P1-3] Fix duplicate push_devices registrations for same browser endpoint,
--          add claim_due_push_reminders_with_devices() to prevent 414 URI Too
--          Long errors, and schedule 90-day audit history pruning.
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Hardened Parsing & Snapshot Sanitization Helpers
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.spend_try_parse_numeric(text);
create or replace function public.spend_try_parse_numeric(p_value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clean  text;
  v_amount numeric;
begin
  if p_value is null then
    return null;
  end if;
  v_clean := btrim(regexp_replace(p_value, '[৳$€£,\s]', '', 'g'));
  if v_clean = '' then
    return null;
  end if;
  v_amount := v_clean::numeric;
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

drop function if exists public.spend_try_parse_date(text);
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

drop function if exists public.spend_try_parse_timestamptz(jsonb);
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

drop function if exists public.spend_normalize_account_id(text);
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

drop function if exists public.spend_json_ms(jsonb);
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

drop function if exists public.spend_is_credit_card(jsonb);
create or replace function public.spend_is_credit_card(p_card jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(p_card) = 'object'
    and lower(coalesce(p_card ->> 'type', '')) = 'credit'
    and lower(coalesce(p_card ->> 'category', '')) not in ('savings', 'mfs', 'cash')
    and lower(coalesce(p_card ->> 'provider', '')) not in ('savings', 'bkash', 'nagad', 'rocket', 'upay', 'cash')
    and lower(coalesce(p_card ->> 'network', '')) <> 'mfs'
    and coalesce(p_card ->> 'id', '') not in ('savings', 'cash')
    and coalesce((p_card ->> 'isPhone')::boolean, false) = false;
$$;

drop function if exists public.spend_sanitize_card_object(jsonb);
create or replace function public.spend_sanitize_card_object(p_card jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_card       jsonb;
  v_raw_number text;
  v_raw_digits text;
  v_last4      text;
  v_is_savings boolean;
  v_is_cash    boolean;
  v_is_mfs     boolean;
  v_safe_num   text;
begin
  if p_card is null or jsonb_typeof(p_card) <> 'object' then
    return p_card;
  end if;

  v_card := p_card - 'cvv' - 'cvc' - 'securityCode' - 'security_code' - 'pin';

  v_raw_number := btrim(coalesce(v_card ->> 'number', ''));
  v_raw_digits := regexp_replace(v_raw_number, '\D', '', 'g');
  v_last4 := left(
    coalesce(
      nullif(btrim(coalesce(v_card ->> 'last4', '')), ''),
      case when length(v_raw_digits) >= 4 then right(v_raw_digits, 4) else v_raw_digits end
    ),
    8
  );

  v_is_savings := (
    lower(coalesce(v_card ->> 'category', '')) = 'savings'
    or lower(coalesce(v_card ->> 'type', '')) = 'savings'
    or lower(coalesce(v_card ->> 'provider', '')) = 'savings'
    or coalesce(v_card ->> 'id', '') = 'savings'
    or v_raw_number like 'SAV-%'
    or v_raw_number like 'VAULT-%'
    or v_raw_number like 'DPS-%'
  );

  v_is_cash := (
    coalesce(v_card ->> 'id', '') = 'cash'
    or lower(coalesce(v_card ->> 'provider', '')) = 'cash'
    or lower(coalesce(v_card ->> 'category', '')) = 'cash'
    or lower(coalesce(v_card ->> 'type', '')) = 'cash'
    or v_raw_number like 'CASH-%'
  );

  v_is_mfs := (
    coalesce((v_card ->> 'isPhone')::boolean, false) = true
    or lower(coalesce(v_card ->> 'category', '')) = 'mfs'
    or lower(coalesce(v_card ->> 'type', '')) = 'mfs'
    or lower(coalesce(v_card ->> 'network', '')) = 'mfs'
    or lower(coalesce(v_card ->> 'provider', '')) in ('bkash', 'nagad', 'rocket', 'upay')
  );

  if v_card ? 'number' then
    if length(v_raw_digits) >= 13 or (not v_is_savings and not v_is_cash and not v_is_mfs and v_raw_number <> '') then
      v_safe_num := case when v_last4 <> '' then '•••• •••• •••• ' || v_last4 else '' end;
      v_card := jsonb_set(v_card, '{number}', to_jsonb(v_safe_num), true);
      if v_last4 <> '' then
        v_card := jsonb_set(v_card, '{last4}', to_jsonb(v_last4), true);
      end if;
    else
      v_card := jsonb_set(v_card, '{number}', to_jsonb(left(v_raw_number, 32)), true);
    end if;
  end if;

  return v_card;
end;
$$;

drop function if exists public.summarize_spend_snapshot(jsonb);
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

drop function if exists public.spend_sanitize_snapshot_jsonb(jsonb);
create or replace function public.spend_sanitize_snapshot_jsonb(p_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw_cards jsonb;
  v_clean     jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    return p_data;
  end if;

  if p_data ? '_encrypted' or p_data ->> 'format' = 'spend-encrypted-v1' then
    return p_data;
  end if;

  v_raw_cards := p_data #> '{accountData,settings,cards}';
  if jsonb_typeof(v_raw_cards) = 'array' then
    select coalesce(jsonb_agg(public.spend_sanitize_card_object(elem)), '[]'::jsonb)
    into v_clean
    from jsonb_array_elements(v_raw_cards) as elem;

    return jsonb_set(p_data, '{accountData,settings,cards}', v_clean, true);
  end if;

  return p_data;
end;
$$;

create or replace function public.sanitize_spend_snapshot_cards_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.data is null or jsonb_typeof(new.data) <> 'object' then
    return new;
  end if;

  new.data := public.spend_sanitize_snapshot_jsonb(new.data);
  return new;
end;
$$;

drop trigger if exists aa_sanitize_spend_snapshot_cards on public.spend_user_data;
create trigger aa_sanitize_spend_snapshot_cards
  before insert or update on public.spend_user_data
  for each row execute function public.sanitize_spend_snapshot_cards_trigger();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Schema Constraints & Multi-Currency Ledger Column
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.spend_account_transactions
  add column if not exists currency text not null default 'BDT';

alter table public.spend_account_transactions
  drop constraint if exists spend_account_transactions_mfs_amount_check,
  drop constraint if exists spend_account_transactions_mfs_shape_check;

alter table public.spend_account_transactions
  add constraint spend_account_transactions_mfs_amount_check
    check (amount > 0) not valid,
  add constraint spend_account_transactions_mfs_shape_check
    check (
      (type = 'expense' and account is not null and from_account is null and to_account is null and direction is null)
      or (type = 'income' and account is not null and from_account is null and to_account is null and direction is null)
      or (type = 'adjustment' and account is not null and direction in ('increase', 'decrease') and from_account is null and to_account is null)
      or (type = 'transfer' and account is null and direction is null and from_account is not null and to_account is not null and from_account <> to_account)
      or (type = 'savings' and account is null and direction is null and from_account is not null and to_account is not null and from_account <> to_account)
    ) not valid;

alter table public.spend_backup_checkpoints
  drop constraint if exists spend_backup_checkpoints_data_object_check,
  drop constraint if exists spend_backup_checkpoints_max_size;

alter table public.spend_backup_checkpoints
  add constraint spend_backup_checkpoints_data_object_check
    check (jsonb_typeof(data) = 'object') not valid,
  add constraint spend_backup_checkpoints_max_size
    check (pg_column_size(data) <= 524288) not valid;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Strict RPC-Only Write RLS on spend_user_data & spend_backup_checkpoints
-- ─────────────────────────────────────────────────────────────────────────────
alter table if exists public.spend_user_data enable row level security;
drop policy if exists "Users manage their own Spend cloud data" on public.spend_user_data;
drop policy if exists "Users read their own Spend cloud data" on public.spend_user_data;
create policy "Users read their own Spend cloud data"
  on public.spend_user_data
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.spend_user_data from anon, authenticated;
grant select on public.spend_user_data to authenticated;

alter table if exists public.spend_backup_checkpoints enable row level security;
drop policy if exists "spend_backup_checkpoints_insert_own" on public.spend_backup_checkpoints;
drop policy if exists "spend_backup_checkpoints_select_own" on public.spend_backup_checkpoints;
create policy "spend_backup_checkpoints_select_own"
  on public.spend_backup_checkpoints
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.spend_backup_checkpoints from anon, authenticated;
grant select on public.spend_backup_checkpoints to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fixed Snapshot -> Normalized Ledger Trigger (Guards + Currency Preservation)
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_card_sub         text;
  v_card_curr        text;
  v_is_cash_card     boolean;
  v_has_opening_obj  boolean;
  v_card_init        numeric(16, 2);
  v_bal_val          numeric(16, 2);
  v_resolved_init    numeric(16, 2);
  v_opening_balances jsonb := '{}'::jsonb;
  v_running_balances jsonb := '{}'::jsonb;
  v_credit_cards     jsonb := '{}'::jsonb;
  v_card_currencies  jsonb := '{}'::jsonb;
  v_deleted_cards    jsonb;
  v_deleted_tx       jsonb;
  v_deleted_exp      jsonb;
  v_start_date       date;
  v_configured       boolean;
  v_settings_ts      timestamptz;
  v_savings_card_id  text := null;
  v_cash_card_id     text := 'cash';
  v_bkash_card_id    text := 'bkash';
  v_bank_card_id     text := 'bank';
  v_rec              record;
  v_acct_bal_before  numeric(16, 2);
  v_acct_bal_after   numeric(16, 2);
  v_from_bal_before  numeric(16, 2);
  v_from_bal_after   numeric(16, 2);
  v_to_bal_before    numeric(16, 2);
  v_to_bal_after     numeric(16, 2);
  v_bkash_live       numeric(16, 2) := 0;
  v_bank_live        numeric(16, 2) := 0;
  v_savings_live     numeric(16, 2) := 0;
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

  -- GUARD 2: Partial snapshot without accountData/settings object must not wipe tables
  if not (new.data ? 'accountData')
     or jsonb_typeof(new.data -> 'accountData') is distinct from 'object'
     or jsonb_typeof(new.data #> '{accountData,settings}') is distinct from 'object' then
    return new;
  end if;

  v_account_data := new.data -> 'accountData';
  v_settings     := v_account_data -> 'settings';
  v_has_opening_obj := (
    jsonb_typeof(v_settings -> 'openingBalances') = 'object'
    and (v_settings -> 'openingBalances') <> '{}'::jsonb
  );
  v_raw_balances := case
    when v_has_opening_obj then v_settings -> 'openingBalances'
    when jsonb_typeof(v_settings -> 'balances') = 'object' then v_settings -> 'balances'
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

      if coalesce(v_deleted_cards #>> array[v_card_id, 'deleted'], '') = 'true'
         and (
           public.spend_json_ms(v_deleted_cards #> array[v_card_id, 'updatedAt']) = 0
           or public.spend_json_ms(v_deleted_cards #> array[v_card_id, 'updatedAt'])
              >= greatest(public.spend_json_ms(v_card -> 'updatedAt'), public.spend_json_ms(v_card -> 'createdAt'))
         )
      then
        continue;
      end if;

      v_card := public.spend_sanitize_card_object(v_card);
      v_is_cash_card := (
        v_card_id = 'cash'
        or lower(coalesce(v_card ->> 'provider', '')) = 'cash'
        or lower(coalesce(v_card ->> 'category', '')) = 'cash'
        or lower(coalesce(v_card ->> 'type', '')) = 'cash'
      );

      if v_is_cash_card then
        v_card_curr := upper(left(coalesce(nullif(btrim(v_card ->> 'currency'), ''), 'BDT'), 8));
        v_card := jsonb_set(v_card, '{currency}', to_jsonb(v_card_curr), true);
      else
        if coalesce(v_card ->> 'subtitle', '') <> '' then
          v_card_sub := regexp_replace(v_card ->> 'subtitle', '\mUSD\M', 'BDT', 'gi');
          v_card := jsonb_set(v_card, '{subtitle}', to_jsonb(v_card_sub), true);
        end if;
        if upper(coalesce(v_card ->> 'currency', 'USD')) = 'USD' then
          v_card_curr := 'BDT';
          v_card := jsonb_set(v_card, '{currency}', '"BDT"'::jsonb, true);
        else
          v_card_curr := upper(left(coalesce(nullif(btrim(v_card ->> 'currency'), ''), 'BDT'), 8));
        end if;
      end if;
      v_card_currencies := jsonb_set(v_card_currencies, array[v_card_id], to_jsonb(v_card_curr), true);

      v_bal_val   := public.spend_try_parse_numeric(v_raw_balances ->> v_card_id);
      v_card_init := public.spend_try_parse_numeric(v_card ->> 'initialBalance');

      if v_bal_val is not null and v_bal_val >= 0 and v_card_init is not null and v_card_init >= 0 then
        if not v_has_opening_obj and v_bal_val = 0 and v_card_init > 0 then
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

      if public.spend_is_credit_card(v_card) then
        v_credit_cards := jsonb_set(v_credit_cards, array[v_card_id], 'true'::jsonb, true);
      end if;

      if v_cash_card_id = 'cash' and v_is_cash_card then
        v_cash_card_id := v_card_id;
      end if;

      if v_bkash_card_id = 'bkash' and (
        v_card_id = 'bkash' or lower(coalesce(v_card ->> 'provider', '')) = 'bkash'
      ) then
        v_bkash_card_id := v_card_id;
      end if;

      if v_bank_card_id = 'bank' and (
        v_card_id = 'bank' or lower(coalesce(v_card ->> 'category', '')) = 'bank'
      ) then
        v_bank_card_id := v_card_id;
      end if;

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
      if v_rec.key = 'cash' and v_cash_card_id <> 'cash' then
        continue;
      end if;
      if coalesce(v_deleted_cards #>> array[v_rec.key, 'deleted'], '') <> 'true' then
        v_bal_val := coalesce(public.spend_try_parse_numeric(v_rec.value), 0);
        if v_bal_val >= 0 then
          v_opening_balances := jsonb_set(v_opening_balances, array[v_rec.key], to_jsonb(round(v_bal_val, 2)), true);
        end if;
      end if;
    end if;
  end loop;

  if not (v_opening_balances ? v_cash_card_id) then
    v_opening_balances := jsonb_set(
      v_opening_balances,
      array[v_cash_card_id],
      to_jsonb(round(coalesce(public.spend_try_parse_numeric(v_raw_balances ->> 'cash'), 0), 2)),
      true
    );
  end if;

  if not (v_card_currencies ? v_cash_card_id) then
    v_card_currencies := jsonb_set(v_card_currencies, array[v_cash_card_id], '"BDT"'::jsonb, true);
  end if;

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
    currency           text not null default 'BDT',
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

  -- Stage account transactions (including 'cash' alias mapping)
  insert into _spend_staged_ledger (
    id, source_kind, tx_type, amount, tx_date, description,
    category, recurring_id, account, direction, from_account, to_account, currency,
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
    coalesce(
      nullif(v_card_currencies ->> coalesce(from_account, account, to_account, ''), ''),
      'BDT'
    ),
    created_ms,
    updated_ms,
    created_at,
    greatest(created_at, updated_at)
  from (
    select
      left(btrim(coalesce(item ->> 'id', '')), 120) as id,
      case
        when item ->> 'type' in ('adjust', 'adjustment') then 'adjustment'
        else btrim(coalesce(item ->> 'type', ''))
      end as tx_type,
      public.spend_try_parse_numeric(coalesce(item ->> 'amount', item ->> 'amt')) as amount,
      public.spend_try_parse_date(coalesce(item ->> 'date', item ->> 'd')) as tx_date,
      coalesce(item ->> 'description', item ->> 'note', '') as description,
      case
        when public.spend_normalize_account_id(coalesce(item ->> 'account', item ->> 'acct')) = 'cash' then v_cash_card_id
        else public.spend_normalize_account_id(coalesce(item ->> 'account', item ->> 'acct'))
      end as account,
      case
        when coalesce(item ->> 'direction', item ->> 'dir') in ('up', 'increase') then 'increase'
        when coalesce(item ->> 'direction', item ->> 'dir') in ('down', 'decrease') then 'decrease'
        else null
      end as direction,
      case
        when public.spend_normalize_account_id(coalesce(item ->> 'fromAccount', item ->> 'from_account', item ->> 'acct')) = 'cash' then v_cash_card_id
        else public.spend_normalize_account_id(coalesce(item ->> 'fromAccount', item ->> 'from_account', item ->> 'acct'))
      end as from_account,
      case
        when public.spend_normalize_account_id(coalesce(item ->> 'toAccount', item ->> 'to_account', item ->> 'to')) = 'cash' then v_cash_card_id
        else public.spend_normalize_account_id(coalesce(item ->> 'toAccount', item ->> 'to_account', item ->> 'to'))
      end as to_account,
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
      coalesce(v_deleted_tx #>> array[id, 'deleted'], '') = 'true'
      and (
        public.spend_json_ms(v_deleted_tx #> array[id, 'updatedAt']) = 0
        or public.spend_json_ms(v_deleted_tx #> array[id, 'updatedAt']) >= updated_ms
      )
    )
  order by id, updated_ms desc;

  -- Stage all expenses & savings transfers
  insert into _spend_staged_ledger (
    id, source_kind, tx_type, amount, tx_date, description,
    category, recurring_id, account, direction, from_account, to_account, currency,
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
    case when is_savings_transfer then account else null end,
    case when is_savings_transfer then v_savings_card_id else null end,
    coalesce(nullif(v_card_currencies ->> account, ''), 'BDT'),
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
      case
        when coalesce(public.spend_normalize_account_id(coalesce(item ->> 'account', item ->> 'acct')), 'cash') = 'cash' then v_cash_card_id
        else public.spend_normalize_account_id(coalesce(item ->> 'account', item ->> 'acct'))
      end as account,
      (
        coalesce(item ->> 'category', item ->> 'cat', '') = 'Savings'
        and v_savings_card_id is not null
        and coalesce(
          case
            when coalesce(public.spend_normalize_account_id(coalesce(item ->> 'account', item ->> 'acct')), 'cash') = 'cash' then v_cash_card_id
            else public.spend_normalize_account_id(coalesce(item ->> 'account', item ->> 'acct'))
          end,
          v_cash_card_id
        ) <> v_savings_card_id
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
    and not (
      coalesce(v_deleted_exp #>> array[id, 'deleted'], '') = 'true'
      and (
        public.spend_json_ms(v_deleted_exp #> array[id, 'updatedAt']) = 0
        or public.spend_json_ms(v_deleted_exp #> array[id, 'updatedAt']) >= updated_ms
      )
    )
    and not (
      recurring_id <> ''
      and coalesce(v_deleted_exp #>> array['recurring:' || recurring_id || ':' || tx_date::text, 'deleted'], '') = 'true'
      and (
        public.spend_json_ms(v_deleted_exp #> array['recurring:' || recurring_id || ':' || tx_date::text, 'updatedAt']) = 0
        or public.spend_json_ms(v_deleted_exp #> array['recurring:' || recurring_id || ':' || tx_date::text, 'updatedAt']) >= updated_ms
      )
    )
  order by id, updated_ms desc
  on conflict (id) do nothing;

  -- Walk staged ledger chronologically
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
      if v_credit_cards ? v_rec.account then
        v_acct_bal_after := round(v_acct_bal_before + v_rec.amount, 2);
      else
        v_acct_bal_after := round(v_acct_bal_before - v_rec.amount, 2);
      end if;
      v_running_balances := jsonb_set(v_running_balances, array[v_rec.account], to_jsonb(v_acct_bal_after), true);

    elsif v_rec.tx_type = 'income' and v_rec.account is not null then
      v_acct_bal_before := coalesce(public.spend_try_parse_numeric(v_running_balances ->> v_rec.account), 0);
      if v_credit_cards ? v_rec.account then
        v_acct_bal_after := round(v_acct_bal_before - v_rec.amount, 2);
      else
        v_acct_bal_after := round(v_acct_bal_before + v_rec.amount, 2);
      end if;
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
        if v_credit_cards ? v_rec.from_account then
          v_from_bal_after := round(v_from_bal_before + v_rec.amount, 2);
        else
          v_from_bal_after := round(v_from_bal_before - v_rec.amount, 2);
        end if;
        v_running_balances := jsonb_set(v_running_balances, array[v_rec.from_account], to_jsonb(v_from_bal_after), true);
        v_acct_bal_before := v_from_bal_before;
        v_acct_bal_after  := v_from_bal_after;
      end if;
      if v_rec.to_account is not null and v_rec.to_account <> coalesce(v_rec.from_account, '') then
        v_to_bal_before := coalesce(public.spend_try_parse_numeric(v_running_balances ->> v_rec.to_account), 0);
        if v_credit_cards ? v_rec.to_account then
          v_to_bal_after := round(v_to_bal_before - v_rec.amount, 2);
        else
          v_to_bal_after := round(v_to_bal_before + v_rec.amount, 2);
        end if;
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

  v_bkash_live := coalesce(
    public.spend_try_parse_numeric(v_running_balances ->> v_bkash_card_id),
    public.spend_try_parse_numeric(v_running_balances ->> 'bkash'),
    0
  );
  v_bank_live := coalesce(
    public.spend_try_parse_numeric(v_running_balances ->> v_bank_card_id),
    public.spend_try_parse_numeric(v_running_balances ->> 'bank'),
    0
  );
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

  insert into public.spend_account_transactions (
    user_id, id, type, amount, transaction_date, description,
    category, recurring_id, account, direction, from_account, to_account, currency,
    balance_before, balance_after, from_balance_after, to_balance_after,
    created_at_ms, updated_at_ms, created_at, updated_at, deleted_at
  )
  select
    new.user_id, id, tx_type, amount, tx_date, description,
    category, recurring_id, account, direction, from_account, to_account, currency,
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
    currency           = excluded.currency,
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
    public.spend_account_transactions.currency,
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
    excluded.currency,
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

  -- Purge soft-deleted ledger rows older than 60 days
  delete from public.spend_account_transactions t
  where t.user_id = new.user_id
    and t.deleted_at is not null
    and t.deleted_at < timezone('utc', now()) - interval '60 days';

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Hardened Snapshot Merger (Timestamps, Tombstones, Recurring Dedup, Budgets)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.merge_spend_snapshots_jsonb(jsonb, jsonb);
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
  v_merged_budgets jsonb := '{}'::jsonb;
  v_merged_budget_ts jsonb := '{}'::jsonb;
  v_ex_profile_ts bigint;
  v_in_profile_ts bigint;
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
  if v_existing ? '_encrypted' or v_existing ->> 'format' = 'spend-encrypted-v1' then
    return v_incoming;
  end if;

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

  -- Merge accountData.transactions + customAccountTransactions respecting tombstone timestamps
  with all_tx as (
    select elem ->> 'id' as id,
           elem,
           greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt')) as ts,
           public.spend_json_ms(elem -> 'createdAt') as created_ms,
           0 as src
    from jsonb_array_elements(
      (case when jsonb_typeof(v_incoming #> '{accountData,transactions}') = 'array'
            then v_incoming #> '{accountData,transactions}' else '[]'::jsonb end)
      ||
      (case when jsonb_typeof(v_incoming -> 'customAccountTransactions') = 'array'
            then v_incoming -> 'customAccountTransactions' else '[]'::jsonb end)
    ) elem
    where jsonb_typeof(elem) = 'object' and coalesce(elem ->> 'id', '') <> ''
    union all
    select elem ->> 'id' as id,
           elem,
           greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt')) as ts,
           public.spend_json_ms(elem -> 'createdAt') as created_ms,
           1 as src
    from jsonb_array_elements(
      (case when jsonb_typeof(v_existing #> '{accountData,transactions}') = 'array'
            then v_existing #> '{accountData,transactions}' else '[]'::jsonb end)
      ||
      (case when jsonb_typeof(v_existing -> 'customAccountTransactions') = 'array'
            then v_existing -> 'customAccountTransactions' else '[]'::jsonb end)
    ) elem
    where jsonb_typeof(elem) = 'object' and coalesce(elem ->> 'id', '') <> ''
  ),
  dedup_tx as (
    select distinct on (id) id, elem, ts, created_ms
    from all_tx
    where not (
      coalesce(v_del_tx #>> array[id, 'deleted'], '') = 'true'
      and (
        coalesce(public.spend_json_ms(v_del_tx #> array[id, 'updatedAt']), 0) = 0
        or coalesce(public.spend_json_ms(v_del_tx #> array[id, 'updatedAt']), 0) >= ts
      )
    )
    order by id, ts desc, src asc
  )
  select coalesce(jsonb_agg(elem order by coalesce(nullif(created_ms, 0), ts) asc, id asc), '[]'::jsonb)
  into v_merged_tx
  from dedup_tx;

  -- Merge expenses respecting tombstone timestamps AND deduplicating recurring occurrences
  with all_exp as (
    select elem ->> 'id' as id,
           case
             when coalesce(elem ->> 'recurringId', '') <> '' and coalesce(elem ->> 'date', '') <> ''
               then 'recurring:' || (elem ->> 'recurringId') || ':' || (elem ->> 'date')
             else 'expense:' || (elem ->> 'id')
           end as dedup_key,
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
           case
             when coalesce(elem ->> 'recurringId', '') <> '' and coalesce(elem ->> 'date', '') <> ''
               then 'recurring:' || (elem ->> 'recurringId') || ':' || (elem ->> 'date')
             else 'expense:' || (elem ->> 'id')
           end as dedup_key,
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
  dedup_exp_id as (
    select distinct on (id) id, dedup_key, elem, ts, created_ms, src
    from all_exp
    where not (
      coalesce(v_del_exp #>> array[id, 'deleted'], '') = 'true'
      and (
        coalesce(public.spend_json_ms(v_del_exp #> array[id, 'updatedAt']), 0) = 0
        or coalesce(public.spend_json_ms(v_del_exp #> array[id, 'updatedAt']), 0) >= ts
      )
    )
    and not (
      coalesce(elem ->> 'recurringId', '') <> ''
      and coalesce(elem ->> 'date', '') <> ''
      and coalesce(v_del_exp #>> array['recurring:' || (elem ->> 'recurringId') || ':' || (elem ->> 'date'), 'deleted'], '') = 'true'
      and (
        coalesce(public.spend_json_ms(v_del_exp #> array['recurring:' || (elem ->> 'recurringId') || ':' || (elem ->> 'date'), 'updatedAt']), 0) = 0
        or coalesce(public.spend_json_ms(v_del_exp #> array['recurring:' || (elem ->> 'recurringId') || ':' || (elem ->> 'date'), 'updatedAt']), 0) >= ts
      )
    )
    order by id, ts desc, src asc
  ),
  dedup_exp as (
    select distinct on (dedup_key) id, elem, ts, created_ms
    from dedup_exp_id
    order by dedup_key, ts desc, src asc, id asc
  )
  select coalesce(jsonb_agg(elem order by coalesce(nullif(created_ms, 0), ts) asc, id asc), '[]'::jsonb)
  into v_merged_exp
  from dedup_exp;

  -- Merge recurringSchedules respecting tombstone timestamps
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
    where not (
      coalesce(v_del_rec #>> array[id, 'deleted'], '') = 'true'
      and (
        coalesce(public.spend_json_ms(v_del_rec #> array[id, 'updatedAt']), 0) = 0
        or coalesce(public.spend_json_ms(v_del_rec #> array[id, 'updatedAt']), 0) >= ts
      )
    )
    order by id, ts desc, src asc
  )
  select coalesce(jsonb_agg(elem order by id asc), '[]'::jsonb)
  into v_merged_rec
  from dedup_rec;

  -- Merge cards respecting tombstone timestamps
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

  -- Merge budgets AND matching budgetUpdatedAt timestamps together
  with budget_candidates as (
    select key as k,
           value as v,
           public.spend_json_ms(coalesce(v_incoming -> 'budgetUpdatedAt', '{}'::jsonb) -> key) as ts,
           0 as src
    from jsonb_each(case when jsonb_typeof(v_incoming -> 'budgets') = 'object' then v_incoming -> 'budgets' else '{}'::jsonb end)
    union all
    select key as k,
           value as v,
           public.spend_json_ms(coalesce(v_existing -> 'budgetUpdatedAt', '{}'::jsonb) -> key) as ts,
           1 as src
    from jsonb_each(case when jsonb_typeof(v_existing -> 'budgets') = 'object' then v_existing -> 'budgets' else '{}'::jsonb end)
  ),
  budget_winners as (
    select distinct on (k) k, v, ts
    from budget_candidates
    where not (
      coalesce(v_del_bud #>> array[k, 'deleted'], '') = 'true'
      and (
        ts = 0
        or coalesce(public.spend_json_ms(v_del_bud #> array[k, 'updatedAt']), 0) >= ts
      )
    )
    order by k, ts desc, src asc
  )
  select
    coalesce(jsonb_object_agg(k, v), '{}'::jsonb),
    coalesce(jsonb_object_agg(k, to_jsonb(ts)), '{}'::jsonb)
  into v_merged_budgets, v_merged_budget_ts
  from budget_winners;

  -- Timestamp-ordered profile merge
  v_ex_profile_ts := public.spend_json_ms(v_existing -> 'profileUpdatedAt');
  v_in_profile_ts := public.spend_json_ms(v_incoming -> 'profileUpdatedAt');

  v_result := v_existing || v_incoming;
  if v_ex_profile_ts > v_in_profile_ts then
    if v_existing ? 'profileName' then
      v_result := jsonb_set(v_result, '{profileName}', v_existing -> 'profileName', true);
    end if;
    if v_existing ? 'profileAvatar' then
      v_result := jsonb_set(v_result, '{profileAvatar}', v_existing -> 'profileAvatar', true);
    end if;
    v_result := jsonb_set(v_result, '{profileUpdatedAt}', to_jsonb(v_ex_profile_ts), true);
  end if;

  v_result := jsonb_set(v_result, '{budgets}', v_merged_budgets, true);
  v_result := jsonb_set(v_result, '{budgetUpdatedAt}', v_merged_budget_ts, true);
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Hardened Verification & Checkpoint Internal Helpers (No Anon/IDOR Bypass)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.verify_spend_ledger_reconciliation(uuid);
create or replace function public.verify_spend_ledger_reconciliation(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), ''),
    ''
  );
  v_uid uuid;
  v_cards jsonb := '[]'::jsonb;
  v_opening jsonb := '{}'::jsonb;
  v_current jsonb := '{}'::jsonb;
  v_card jsonb;
  v_cid text;
  v_cname text;
  v_curr text;
  v_is_credit boolean;
  v_has_cash_card boolean := false;
  v_has_cash_activity boolean := false;
  v_cash_card_id text := 'cash';
  v_open_amt numeric(16, 2);
  v_credits numeric(16, 2);
  v_debits numeric(16, 2);
  v_expected numeric(16, 2);
  v_actual numeric(16, 2);
  v_diff numeric(16, 2);
  v_accounts jsonb := '{}'::jsonb;
  v_currencies jsonb := '{}'::jsonb;
  v_curr_bucket jsonb;
  v_seen_ids text[] := array[]::text[];
  v_extra_id text;
  v_discrepancy_count integer := 0;
  v_account_count integer := 0;
  v_total_opening numeric(16, 2) := 0;
  v_total_credits numeric(16, 2) := 0;
  v_total_debits numeric(16, 2) := 0;
  v_total_expected numeric(16, 2) := 0;
  v_total_actual numeric(16, 2) := 0;
  v_total_diff numeric(16, 2) := 0;
  v_tx_count integer := 0;
  v_ledger_tx_count integer := 0;
begin
  if v_caller is not null then
    if p_user_id is not null and p_user_id <> v_caller then
      raise exception 'Cannot verify ledger for another user' using errcode = '42501';
    end if;
    v_uid := v_caller;
  elsif v_jwt_role = 'service_role'
     or (v_jwt_role = '' and session_user in ('postgres', 'supabase_admin')) then
    v_uid := p_user_id;
  else
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select
    coalesce(cards, '[]'::jsonb),
    coalesce(opening_balances, balances, '{}'::jsonb),
    coalesce(current_balances, balances, '{}'::jsonb)
  into v_cards, v_opening, v_current
  from public.spend_account_settings
  where user_id = v_uid;

  select
    count(*) filter (where t.type in ('income', 'adjustment', 'transfer'))::integer,
    count(*)::integer
  into v_tx_count, v_ledger_tx_count
  from public.spend_account_transactions t
  where t.user_id = v_uid
    and t.deleted_at is null;

  if v_cards is null or jsonb_typeof(v_cards) <> 'array' then
    v_cards := '[]'::jsonb;
  end if;

  select c ->> 'id'
  into v_cash_card_id
  from jsonb_array_elements(v_cards) c
  where btrim(coalesce(c ->> 'id', '')) = 'cash'
     or lower(coalesce(c ->> 'provider', '')) = 'cash'
     or lower(coalesce(c ->> 'category', '')) = 'cash'
     or lower(coalesce(c ->> 'type', '')) = 'cash'
  limit 1;

  v_has_cash_card := (v_cash_card_id is not null);
  v_cash_card_id := coalesce(v_cash_card_id, 'cash');

  if not v_has_cash_card then
    select (
      coalesce(public.spend_try_parse_numeric(v_opening ->> 'cash'), 0) <> 0
      or coalesce(public.spend_try_parse_numeric(v_current ->> 'cash'), 0) <> 0
      or exists (
        select 1
        from public.spend_account_transactions t
        where t.user_id = v_uid
          and t.deleted_at is null
          and (t.account = 'cash' or t.from_account = 'cash' or t.to_account = 'cash')
      )
    ) into v_has_cash_activity;

    if v_has_cash_activity then
      v_cards := v_cards || jsonb_build_array(
        jsonb_build_object(
          'id', 'cash',
          'name', 'Cash',
          'type', 'cash',
          'category', 'cash',
          'currency', 'BDT',
          'initialBalance', coalesce(public.spend_try_parse_numeric(v_opening ->> 'cash'), 0),
          'currentBalance', coalesce(public.spend_try_parse_numeric(v_current ->> 'cash'), 0)
        )
      );
    end if;
  end if;

  -- Append any non-card account IDs referenced in opening/current balances or active ledger
  for v_extra_id in
    select distinct acct_id
    from (
      select key as acct_id from jsonb_object_keys(coalesce(v_opening, '{}'::jsonb)) as key
      union all
      select key as acct_id from jsonb_object_keys(coalesce(v_current, '{}'::jsonb)) as key
      union all
      select t.account as acct_id from public.spend_account_transactions t
      where t.user_id = v_uid and t.deleted_at is null and t.account is not null
      union all
      select t.from_account as acct_id from public.spend_account_transactions t
      where t.user_id = v_uid and t.deleted_at is null and t.from_account is not null
      union all
      select t.to_account as acct_id from public.spend_account_transactions t
      where t.user_id = v_uid and t.deleted_at is null and t.to_account is not null
    ) ids
    where acct_id is not null
      and acct_id <> ''
      and acct_id <> 'date'
      and not (acct_id = 'cash' and v_cash_card_id <> 'cash')
      and not exists (
        select 1 from jsonb_array_elements(v_cards) c where btrim(coalesce(c ->> 'id', '')) = acct_id
      )
  loop
    v_cards := v_cards || jsonb_build_array(
      jsonb_build_object(
        'id', v_extra_id,
        'name', case when v_extra_id = 'cash' then 'Cash' else v_extra_id end,
        'type', case when v_extra_id = 'cash' then 'cash' else 'debit' end,
        'currency', 'BDT',
        'initialBalance', coalesce(public.spend_try_parse_numeric(v_opening ->> v_extra_id), 0),
        'currentBalance', coalesce(public.spend_try_parse_numeric(v_current ->> v_extra_id), 0)
      )
    );
  end loop;

  for v_card in select value from jsonb_array_elements(v_cards) loop
    v_cid := coalesce(nullif(trim(v_card ->> 'id'), ''), '');
    if v_cid = '' or v_cid = any(v_seen_ids) then
      continue;
    end if;
    v_seen_ids := array_append(v_seen_ids, v_cid);

    v_account_count := v_account_count + 1;
    v_cname := coalesce(nullif(trim(v_card ->> 'name'), ''), v_cid);
    v_curr := upper(left(coalesce(nullif(trim(v_card ->> 'currency'), ''), 'BDT'), 8));
    v_is_credit := public.spend_is_credit_card(v_card);
    v_open_amt := round(coalesce(
      public.spend_try_parse_numeric(v_opening ->> v_cid),
      public.spend_try_parse_numeric(v_card ->> 'initialBalance'),
      0
    ), 2);

    if v_is_credit then
      select round(coalesce(sum(
        case
          when t.type = 'expense' and t.account = v_cid then t.amount
          when t.type = 'adjustment' and t.account = v_cid and coalesce(t.direction, 'increase') = 'increase' then t.amount
          when t.type = 'transfer' and t.from_account = v_cid and coalesce(t.to_account, '') <> v_cid then t.amount
          when t.type = 'savings' and t.from_account = v_cid and coalesce(t.to_account, '') <> v_cid then t.amount
          else 0
        end
      ), 0), 2)
      into v_credits
      from public.spend_account_transactions t
      where t.user_id = v_uid
        and t.deleted_at is null;

      select round(coalesce(sum(
        case
          when t.type = 'income' and t.account = v_cid then t.amount
          when t.type = 'adjustment' and t.account = v_cid and t.direction = 'decrease' then t.amount
          when t.type = 'transfer' and t.to_account = v_cid and coalesce(t.from_account, '') <> v_cid then t.amount
          else 0
        end
      ), 0), 2)
      into v_debits
      from public.spend_account_transactions t
      where t.user_id = v_uid
        and t.deleted_at is null;
    else
      select round(coalesce(sum(
        case
          when t.type = 'income' and t.account = v_cid then t.amount
          when t.type = 'adjustment' and t.account = v_cid and coalesce(t.direction, 'increase') = 'increase' then t.amount
          when t.type = 'transfer' and t.to_account = v_cid and coalesce(t.from_account, '') <> v_cid then t.amount
          when t.type = 'savings' and t.to_account = v_cid and coalesce(t.from_account, '') <> '' and coalesce(t.from_account, '') <> v_cid then t.amount
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
    end if;

    v_expected := round(v_open_amt + v_credits - v_debits, 2);
    v_actual := round(coalesce(
      public.spend_try_parse_numeric(v_current ->> v_cid),
      public.spend_try_parse_numeric(v_card ->> 'currentBalance'),
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

    v_curr_bucket := coalesce(
      v_currencies -> v_curr,
      jsonb_build_object(
        'opening', 0,
        'credits', 0,
        'debits', 0,
        'expectedBalance', 0,
        'currentBalance', 0
      )
    );
    v_currencies := jsonb_set(
      v_currencies,
      array[v_curr],
      jsonb_build_object(
        'opening', round(coalesce((v_curr_bucket ->> 'opening')::numeric, 0) + v_open_amt, 2),
        'credits', round(coalesce((v_curr_bucket ->> 'credits')::numeric, 0) + v_credits, 2),
        'debits', round(coalesce((v_curr_bucket ->> 'debits')::numeric, 0) + v_debits, 2),
        'expectedBalance', round(coalesce((v_curr_bucket ->> 'expectedBalance')::numeric, 0) + v_expected, 2),
        'currentBalance', round(coalesce((v_curr_bucket ->> 'currentBalance')::numeric, 0) + v_actual, 2)
      ),
      true
    );

    v_accounts := jsonb_set(
      v_accounts,
      array[v_cid],
      jsonb_build_object(
        'id', v_cid,
        'name', v_cname,
        'currency', v_curr,
        'type', case
          when v_is_credit then 'credit'
          when v_cid = v_cash_card_id or lower(coalesce(v_card ->> 'type', '')) = 'cash' then 'cash'
          else 'asset'
        end,
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
    'schemaVersion', '2026.11.25',
    'isBalanced', (v_discrepancy_count = 0),
    'accountCount', v_account_count,
    'txCount', v_tx_count,
    'ledgerTxCount', v_ledger_tx_count,
    'discrepancyCount', v_discrepancy_count,
    'totalOpening', v_total_opening,
    'totalCredits', v_total_credits,
    'totalDebits', v_total_debits,
    'totalExpectedBalance', v_total_expected,
    'totalCurrentBalance', v_total_actual,
    'totalDiscrepancy', v_total_diff,
    'currencies', v_currencies,
    'checkedAt', timezone('utc', now()),
    'accounts', v_accounts
  );
end;
$$;

drop function if exists public.capture_spend_backup_checkpoint_internal(uuid, jsonb, text, text, timestamptz);
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
  v_caller uuid := auth.uid();
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), ''),
    ''
  );
  v_type text := case
    when p_checkpoint_type in ('daily', 'pre_restore', 'pre_overwrite', 'manual') then p_checkpoint_type
    else 'daily'
  end;
  v_clean_data jsonb;
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

  if v_caller is not null then
    if v_caller <> p_user_id then
      raise exception 'Unauthorized checkpoint capture' using errcode = '42501';
    end if;
  elsif not (
    v_jwt_role = 'service_role'
    or (v_jwt_role = '' and session_user in ('postgres', 'supabase_admin'))
  ) then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_clean_data := public.spend_sanitize_snapshot_jsonb(p_data);
  if pg_column_size(v_clean_data) > 524288 then
    v_clean_data := v_clean_data - 'profileAvatar';
  end if;
  if pg_column_size(v_clean_data) > 524288 then
    raise exception 'Checkpoint payload exceeds maximum allowed size (512 KB)' using errcode = '22023';
  end if;

  v_summary := public.summarize_spend_snapshot(v_clean_data);
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
      p_user_id, 'daily', v_today, v_label, v_clean_data,
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
        p_user_id, v_type, v_today, v_label, v_clean_data,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Atomic OCC + CRDT Snapshot Save RPC & Timestamp-Dominant Checkpoint Restore
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_expected_parsed timestamptz;
  v_now timestamptz := date_trunc('milliseconds', timezone('utc', now()));
  v_existing_has_records boolean := false;
  v_incoming_has_records boolean := false;
  v_incoming_is_encrypted boolean := false;
  v_reconciliation jsonb := null;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Snapshot payload must be a JSON object' using errcode = '22023';
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

  v_effective_data := public.spend_sanitize_snapshot_jsonb(v_effective_data);
  v_incoming_is_encrypted := (
    v_effective_data ? '_encrypted'
    or v_effective_data ->> 'format' = 'spend-encrypted-v1'
  );

  if v_existing_data is not null then
    v_existing_has_records :=
      (v_existing_data ? '_encrypted' or v_existing_data ->> 'format' = 'spend-encrypted-v1')
      or (jsonb_typeof(v_existing_data -> 'expenses') = 'array' and jsonb_array_length(v_existing_data -> 'expenses') > 0)
      or (jsonb_typeof(v_existing_data #> '{accountData,settings,cards}') = 'array' and jsonb_array_length(v_existing_data #> '{accountData,settings,cards}') > 0)
      or (jsonb_typeof(v_existing_data #> '{accountData,transactions}') = 'array' and jsonb_array_length(v_existing_data #> '{accountData,transactions}') > 0)
      or (jsonb_typeof(v_existing_data -> 'budgets') = 'object' and (v_existing_data -> 'budgets') <> '{}'::jsonb)
      or (jsonb_typeof(v_existing_data -> 'recurringSchedules') = 'array' and jsonb_array_length(v_existing_data -> 'recurringSchedules') > 0);
  end if;

  v_incoming_has_records :=
    v_incoming_is_encrypted
    or (jsonb_typeof(v_effective_data -> 'expenses') = 'array' and jsonb_array_length(v_effective_data -> 'expenses') > 0)
    or (jsonb_typeof(v_effective_data #> '{accountData,settings,cards}') = 'array' and jsonb_array_length(v_effective_data #> '{accountData,settings,cards}') > 0)
    or (jsonb_typeof(v_effective_data #> '{accountData,transactions}') = 'array' and jsonb_array_length(v_effective_data #> '{accountData,transactions}') > 0)
    or (jsonb_typeof(v_effective_data -> 'budgets') = 'object' and (v_effective_data -> 'budgets') <> '{}'::jsonb)
    or (jsonb_typeof(v_effective_data -> 'recurringSchedules') = 'array' and jsonb_array_length(v_effective_data -> 'recurringSchedules') > 0)
    or (jsonb_typeof(v_effective_data #> '{deletedRecords,cards}') = 'object' and (v_effective_data #> '{deletedRecords,cards}') <> '{}'::jsonb)
    or (jsonb_typeof(v_effective_data #> '{deletedRecords,expenses}') = 'object' and (v_effective_data #> '{deletedRecords,expenses}') <> '{}'::jsonb)
    or (jsonb_typeof(v_effective_data #> '{deletedRecords,accountTransactions}') = 'object' and (v_effective_data #> '{deletedRecords,accountTransactions}') <> '{}'::jsonb)
    or (jsonb_typeof(v_effective_data #> '{deletedRecords,budgets}') = 'object' and (v_effective_data #> '{deletedRecords,budgets}') <> '{}'::jsonb)
    or (jsonb_typeof(v_effective_data #> '{deletedRecords,recurringSchedules}') = 'object' and (v_effective_data #> '{deletedRecords,recurringSchedules}') <> '{}'::jsonb);

  if v_existing_has_records and not v_incoming_has_records and not coalesce(p_force_overwrite, false) then
    return jsonb_build_object(
      'status', 'conflict',
      'updated_at', v_existing_updated_at,
      'data', v_existing_data
    );
  end if;

  -- Enforce Optimistic Concurrency Control (2ms tolerance) when not force-overwriting
  if v_existing_updated_at is not null and not coalesce(p_force_overwrite, false) then
    if p_expected_updated_at is null or btrim(p_expected_updated_at) = '' then
      return jsonb_build_object(
        'status', 'conflict',
        'updated_at', v_existing_updated_at,
        'data', v_existing_data
      );
    end if;

    begin
      v_expected_parsed := p_expected_updated_at::timestamptz;
    exception when others then
      v_expected_parsed := null;
    end;

    if v_expected_parsed is null
       or abs(extract(epoch from (v_existing_updated_at - v_expected_parsed))) >= 0.002 then
      return jsonb_build_object(
        'status', 'conflict',
        'updated_at', v_existing_updated_at,
        'data', v_existing_data
      );
    end if;
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

  if not v_incoming_is_encrypted then
    v_reconciliation := public.verify_spend_ledger_reconciliation(v_uid);
  end if;

  return jsonb_build_object(
    'status', 'saved',
    'updated_at', v_now,
    'data', v_effective_data,
    'reconciliation', v_reconciliation
  );
end;
$$;

drop function if exists public.create_spend_backup_checkpoint(text, text, jsonb);
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
  v_source_updated_at timestamptz := date_trunc('milliseconds', timezone('utc', now()));
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
  else
    v_snapshot := public.spend_sanitize_snapshot_jsonb(v_snapshot);
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

drop function if exists public.restore_spend_backup_checkpoint(uuid);
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
  v_now timestamptz := date_trunc('milliseconds', timezone('utc', now()));
  v_now_ms bigint := floor(extract(epoch from v_now) * 1000)::bigint;
  v_restored_data jsonb;
  v_is_encrypted boolean := false;
  v_del_tx jsonb := '{}'::jsonb;
  v_del_exp jsonb := '{}'::jsonb;
  v_del_rec jsonb := '{}'::jsonb;
  v_del_cards jsonb := '{}'::jsonb;
  v_del_budgets jsonb := '{}'::jsonb;
  v_restored_exp jsonb := '[]'::jsonb;
  v_restored_rec jsonb := '[]'::jsonb;
  v_restored_tx jsonb := '[]'::jsonb;
  v_restored_cards jsonb := '[]'::jsonb;
  v_restored_budget_ts jsonb := '{}'::jsonb;
  v_reconciliation jsonb := null;
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

  v_restored_data := public.spend_sanitize_snapshot_jsonb(v_target.data);
  v_is_encrypted := (
    v_restored_data ? '_encrypted'
    or v_restored_data ->> 'format' = 'spend-encrypted-v1'
  );

  if not v_is_encrypted then
    -- Stamp restored entities with v_now_ms so rolled-back values win over pre-rollback stale edits
    if jsonb_typeof(v_restored_data -> 'expenses') = 'array' then
      select coalesce(jsonb_agg(
        case when jsonb_typeof(e) = 'object'
             then jsonb_set(e, '{updatedAt}', to_jsonb(v_now_ms), true)
             else e end
      ), '[]'::jsonb)
      into v_restored_exp
      from jsonb_array_elements(v_restored_data -> 'expenses') e;
      v_restored_data := jsonb_set(v_restored_data, '{expenses}', v_restored_exp, true);
    end if;

    if jsonb_typeof(v_restored_data -> 'recurringSchedules') = 'array' then
      select coalesce(jsonb_agg(
        case when jsonb_typeof(r) = 'object'
             then jsonb_set(r, '{updatedAt}', to_jsonb(v_now_ms), true)
             else r end
      ), '[]'::jsonb)
      into v_restored_rec
      from jsonb_array_elements(v_restored_data -> 'recurringSchedules') r;
      v_restored_data := jsonb_set(v_restored_data, '{recurringSchedules}', v_restored_rec, true);
    end if;

    if jsonb_typeof(v_restored_data #> '{accountData,transactions}') = 'array' then
      select coalesce(jsonb_agg(
        case when jsonb_typeof(t) = 'object'
             then jsonb_set(t, '{updatedAt}', to_jsonb(v_now_ms), true)
             else t end
      ), '[]'::jsonb)
      into v_restored_tx
      from jsonb_array_elements(v_restored_data #> '{accountData,transactions}') t;
      v_restored_data := jsonb_set(v_restored_data, '{accountData,transactions}', v_restored_tx, true);
    end if;

    if jsonb_typeof(v_restored_data #> '{accountData,settings,cards}') = 'array' then
      select coalesce(jsonb_agg(
        case when jsonb_typeof(c) = 'object'
             then jsonb_set(c, '{updatedAt}', to_jsonb(v_now_ms), true)
             else c end
      ), '[]'::jsonb)
      into v_restored_cards
      from jsonb_array_elements(v_restored_data #> '{accountData,settings,cards}') c;
      v_restored_data := jsonb_set(v_restored_data, '{accountData,settings,cards}', v_restored_cards, true);
    end if;

    if jsonb_typeof(v_restored_data #> '{accountData,settings}') = 'object' then
      v_restored_data := jsonb_set(v_restored_data, '{accountData,settings,updatedAt}', to_jsonb(v_now_ms), true);
    end if;

    if jsonb_typeof(v_restored_data -> 'budgets') = 'object' then
      select coalesce(jsonb_object_agg(key, to_jsonb(v_now_ms)), '{}'::jsonb)
      into v_restored_budget_ts
      from jsonb_object_keys(v_restored_data -> 'budgets') as key;
      v_restored_data := jsonb_set(v_restored_data, '{budgetUpdatedAt}', v_restored_budget_ts, true);
    end if;

    if v_restored_data ? 'profileUpdatedAt' then
      v_restored_data := jsonb_set(v_restored_data, '{profileUpdatedAt}', to_jsonb(v_now_ms), true);
    end if;

    if v_existing_data is not null and not (
      v_existing_data ? '_encrypted'
      or v_existing_data ->> 'format' = 'spend-encrypted-v1'
    ) then
      select coalesce(
        jsonb_object_agg(ex_id, jsonb_build_object('deleted', true, 'updatedAt', v_now_ms)),
        '{}'::jsonb
      )
      into v_del_tx
      from (
        select elem ->> 'id' as ex_id
        from jsonb_array_elements(
          (case when jsonb_typeof(v_existing_data #> '{accountData,transactions}') = 'array'
                then v_existing_data #> '{accountData,transactions}' else '[]'::jsonb end)
          ||
          (case when jsonb_typeof(v_existing_data -> 'customAccountTransactions') = 'array'
                then v_existing_data -> 'customAccountTransactions' else '[]'::jsonb end)
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
        jsonb_object_agg(ex_id, jsonb_build_object('deleted', true, 'updatedAt', v_now_ms)),
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

      select coalesce(
        jsonb_object_agg(ex_id, jsonb_build_object('deleted', true, 'updatedAt', v_now_ms)),
        '{}'::jsonb
      )
      into v_del_rec
      from (
        select elem ->> 'id' as ex_id
        from jsonb_array_elements(
          case when jsonb_typeof(v_existing_data -> 'recurringSchedules') = 'array'
               then v_existing_data -> 'recurringSchedules' else '[]'::jsonb end
        ) elem
        where coalesce(elem ->> 'id', '') <> ''
          and not exists (
            select 1
            from jsonb_array_elements(
              case when jsonb_typeof(v_restored_data -> 'recurringSchedules') = 'array'
                   then v_restored_data -> 'recurringSchedules' else '[]'::jsonb end
            ) target_elem
            where target_elem ->> 'id' = elem ->> 'id'
          )
      ) removed_rec;

      v_restored_data := jsonb_set(
        v_restored_data,
        '{deletedRecords,recurringSchedules}',
        coalesce(v_restored_data #> '{deletedRecords,recurringSchedules}', '{}'::jsonb) || v_del_rec,
        true
      );

      select coalesce(
        jsonb_object_agg(ex_id, jsonb_build_object('deleted', true, 'updatedAt', v_now_ms)),
        '{}'::jsonb
      )
      into v_del_cards
      from (
        select elem ->> 'id' as ex_id
        from jsonb_array_elements(
          case when jsonb_typeof(v_existing_data #> '{accountData,settings,cards}') = 'array'
               then v_existing_data #> '{accountData,settings,cards}' else '[]'::jsonb end
        ) elem
        where coalesce(elem ->> 'id', '') <> ''
          and not exists (
            select 1
            from jsonb_array_elements(
              case when jsonb_typeof(v_restored_data #> '{accountData,settings,cards}') = 'array'
                   then v_restored_data #> '{accountData,settings,cards}' else '[]'::jsonb end
            ) target_elem
            where target_elem ->> 'id' = elem ->> 'id'
          )
      ) removed_cards;

      v_restored_data := jsonb_set(
        v_restored_data,
        '{deletedRecords,cards}',
        coalesce(v_restored_data #> '{deletedRecords,cards}', '{}'::jsonb) || v_del_cards,
        true
      );

      select coalesce(
        jsonb_object_agg(ex_month, jsonb_build_object('deleted', true, 'updatedAt', v_now_ms)),
        '{}'::jsonb
      )
      into v_del_budgets
      from (
        select key as ex_month
        from jsonb_each(
          case when jsonb_typeof(v_existing_data -> 'budgets') = 'object'
               then v_existing_data -> 'budgets' else '{}'::jsonb end
        )
        where not (
          case when jsonb_typeof(v_restored_data -> 'budgets') = 'object'
               then v_restored_data -> 'budgets' else '{}'::jsonb end ? key
        )
      ) removed_budgets;

      v_restored_data := jsonb_set(
        v_restored_data,
        '{deletedRecords,budgets}',
        coalesce(v_restored_data #> '{deletedRecords,budgets}', '{}'::jsonb) || v_del_budgets,
        true
      );
    end if;
  end if;

  insert into public.spend_user_data (user_id, data, updated_at)
  values (v_uid, v_restored_data, v_now)
  on conflict (user_id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at
  returning data, updated_at into v_restored_data, v_now;

  if not v_is_encrypted then
    v_reconciliation := public.verify_spend_ledger_reconciliation(v_uid);
  end if;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Push Registration Dedup, Trigger Dedup & Joined Claim RPC
-- ─────────────────────────────────────────────────────────────────────────────
alter table if exists public.push_devices
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

drop function if exists public.register_spend_push_device(text, text, jsonb);
create or replace function public.register_spend_push_device(
  p_device_id text,
  p_endpoint text,
  p_subscription jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_dev_id text := btrim(coalesce(p_device_id, ''));
  v_dev_uuid uuid;
  v_ep text := btrim(coalesce(p_endpoint, ''));
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_dev_id = '' or v_ep = '' or p_subscription is null or jsonb_typeof(p_subscription) <> 'object' then
    raise exception 'Invalid push device parameters' using errcode = '22023';
  end if;

  begin
    v_dev_uuid := v_dev_id::uuid;
  exception when others then
    raise exception 'Invalid push device ID format' using errcode = '22023';
  end;

  if to_regclass('public.push_devices') is null then
    return jsonb_build_object('status', 'skipped');
  end if;

  -- Remove stale reminders & devices for the same browser endpoint across different users
  -- OR older device IDs for the same user (e.g. after clearing localStorage)
  if to_regclass('public.push_reminders') is not null then
    delete from public.push_reminders r
    using public.push_devices d
    where d.endpoint = v_ep
      and (d.user_id <> v_uid or d.device_id <> v_dev_uuid)
      and r.user_id = d.user_id
      and r.device_id = d.device_id;
  end if;

  delete from public.push_devices
  where endpoint = v_ep
    and (user_id <> v_uid or device_id <> v_dev_uuid);

  insert into public.push_devices (user_id, device_id, endpoint, subscription, updated_at)
  values (v_uid, v_dev_uuid, v_ep, p_subscription, timezone('utc', now()))
  on conflict (user_id, device_id) do update
  set endpoint = excluded.endpoint,
      subscription = excluded.subscription,
      updated_at = timezone('utc', now());

  return jsonb_build_object('status', 'registered', 'device_id', v_dev_uuid::text);
end;
$$;

-- Remove duplicate legacy trigger so preserve_push_reminder_progress() executes only once
drop trigger if exists preserve_push_reminder_progress on public.push_reminders;
drop trigger if exists preserve_push_reminder_progress_trigger on public.push_reminders;
create trigger preserve_push_reminder_progress_trigger
  before insert or update on public.push_reminders
  for each row execute function public.preserve_push_reminder_progress();

-- Joined atomic push claim RPC (prevents 414 URI Too Long on >150 due users)
drop function if exists public.claim_due_push_reminders_with_devices(integer, integer);
create or replace function public.claim_due_push_reminders_with_devices(
  p_limit integer default 200,
  p_lease_seconds integer default 300
)
returns table (
  user_id uuid,
  device_id uuid,
  schedule_id text,
  description text,
  "interval" text,
  day_of_month integer,
  next_date date,
  next_notify_at timestamptz,
  timezone text,
  reminder_time text,
  claim_until timestamptz,
  subscription jsonb
)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select r.user_id, r.device_id, r.schedule_id
    from public.push_reminders r
    where r.active
      and r.next_notify_at <= now()
      and (r.claim_until is null or r.claim_until <= now())
    order by r.next_notify_at asc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    for update of r skip locked
  ),
  claimed as (
    update public.push_reminders r
    set claim_until = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300))),
        pending_notification = true
    from due
    where r.user_id = due.user_id
      and r.device_id = due.device_id
      and r.schedule_id = due.schedule_id
    returning r.*
  )
  select
    c.user_id,
    c.device_id,
    c.schedule_id,
    c.description,
    c.interval,
    c.day_of_month,
    c.next_date,
    c.next_notify_at,
    c.timezone,
    c.reminder_time,
    c.claim_until,
    d.subscription
  from claimed c
  left join public.push_devices d
    on d.user_id = c.user_id
   and d.device_id = c.device_id;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Audit History Retention Pruning (Out-of-Band Daily Maintenance)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.prune_spend_account_change_history(integer);
create or replace function public.prune_spend_account_change_history(
  p_retention_days integer default 90
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(7, least(coalesce(p_retention_days, 90), 3650));
  v_deleted bigint := 0;
begin
  delete from public.spend_account_change_history
  where changed_at < timezone('utc', now()) - make_interval(days => v_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'spend-prune-audit-history') then
      perform cron.schedule(
        'spend-prune-audit-history',
        '15 3 * * *',
        'select public.prune_spend_account_change_history(90);'
      );
    end if;
  end if;
exception when others then
  -- Ignore if pg_cron permissions are unavailable in local environments
  null;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Scrub Pre-20261123 PAN/CVV Remnants in Checkpoints & Audit History
-- ─────────────────────────────────────────────────────────────────────────────
update public.spend_backup_checkpoints cp
set
  data = public.spend_sanitize_snapshot_jsonb(cp.data),
  ledger_summary = public.summarize_spend_snapshot(public.spend_sanitize_snapshot_jsonb(cp.data))
where cp.data is not null
  and jsonb_typeof(cp.data) = 'object'
  and not (cp.data ? '_encrypted')
  and coalesce(cp.data ->> 'format', '') <> 'spend-encrypted-v1'
  and jsonb_typeof(cp.data #> '{accountData,settings,cards}') = 'array'
  and cp.data is distinct from public.spend_sanitize_snapshot_jsonb(cp.data);

update public.spend_account_change_history h
set
  previous_data = case
    when jsonb_typeof(h.previous_data -> 'cards') = 'array' then
      jsonb_set(
        h.previous_data,
        '{cards}',
        coalesce((
          select jsonb_agg(public.spend_sanitize_card_object(elem))
          from jsonb_array_elements(h.previous_data -> 'cards') as elem
        ), '[]'::jsonb),
        true
      )
    else h.previous_data
  end,
  new_data = case
    when jsonb_typeof(h.new_data -> 'cards') = 'array' then
      jsonb_set(
        h.new_data,
        '{cards}',
        coalesce((
          select jsonb_agg(public.spend_sanitize_card_object(elem))
          from jsonb_array_elements(h.new_data -> 'cards') as elem
        ), '[]'::jsonb),
        true
      )
    else h.new_data
  end
where h.entity = 'settings'
  and (
    jsonb_typeof(h.previous_data -> 'cards') = 'array'
    or jsonb_typeof(h.new_data -> 'cards') = 'array'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Updated SQL Health Diagnostic RPC
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.verify_spend_sql_installation();
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
    'Primary user snapshot store (RPC-only write RLS)'::text
  union all
  select
    'spend_account_settings'::text,
    'Table + Columns'::text,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'spend_account_settings' and column_name = 'current_balances'
    ) then '✅ INSTALLED' else '❌ MISSING' end,
    'Opening & live current balances per card/MFS/cash account'::text
  union all
  select
    'spend_account_transactions'::text,
    'Table + Columns'::text,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'spend_account_transactions' and column_name = 'currency'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'spend_account_transactions' and column_name = 'balance_after'
    ) then '✅ INSTALLED' else '❌ MISSING' end,
    'Unified multi-currency MFS/card/cash ledger with running balances'::text
  union all
  select
    'spend_backup_checkpoints'::text,
    'Table'::text,
    case when to_regclass('public.spend_backup_checkpoints') is not null then '✅ INSTALLED' else '❌ MISSING' end,
    'Immutable daily & pre-restore cloud backup checkpoints (RPC-only writes)'::text
  union all
  select
    'aa_sanitize_spend_snapshot_cards'::text,
    'Trigger'::text,
    case when exists (
      select 1 from pg_trigger
      where tgname = 'aa_sanitize_spend_snapshot_cards' and not tgisinternal
    ) then '✅ INSTALLED' else '❌ MISSING' end,
    'Server-side CVV strip & card PAN masking trigger'::text
  union all
  select
    'sync_spend_accounts_from_snapshot'::text,
    'Trigger'::text,
    case when exists (
      select 1 from pg_trigger
      where tgname = 'sync_spend_accounts_from_snapshot' and not tgisinternal
    ) then '✅ INSTALLED' else '❌ MISSING' end,
    'Guarded ledger computation, credit card liability & currency-safe trigger'::text
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
    'Atomic OCC-verified snapshot save with automatic checkpointing'::text
  union all
  select
    'verify_spend_ledger_reconciliation'::text,
    'RPC Function'::text,
    case when to_regprocedure('public.verify_spend_ledger_reconciliation(uuid)') is not null
          and not has_function_privilege('anon', 'public.verify_spend_ledger_reconciliation(uuid)', 'EXECUTE')
         then '✅ INSTALLED' else '❌ MISSING' end,
    'Authenticated/service-role Opening + Credits - Debits = Current verification (v2026.11.25)'::text
  union all
  select
    'restore_spend_backup_checkpoint'::text,
    'RPC Function'::text,
    case when to_regprocedure('public.restore_spend_backup_checkpoint(uuid)') is not null then '✅ INSTALLED' else '❌ MISSING' end,
    'One-tap checkpoint rollback with timestamp dominance & tombstones'::text
  union all
  select
    'register_spend_push_device'::text,
    'RPC Function'::text,
    case when to_regprocedure('public.register_spend_push_device(text,text,jsonb)') is not null then '✅ INSTALLED' else '❌ MISSING' end,
    'SECURITY DEFINER push subscription endpoint detachment across accounts/re-installs'::text
  union all
  select
    'claim_due_push_reminders_with_devices'::text,
    'RPC Function'::text,
    case when to_regprocedure('public.claim_due_push_reminders_with_devices(integer,integer)') is not null then '✅ INSTALLED' else '❌ MISSING' end,
    'Joined atomic skip-locked lease RPC for send-due-reminders Edge Function'::text
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Explicit Least-Privilege Function Grants (Revoke PUBLIC, anon, authenticated)
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.spend_try_parse_date(text) from public, anon, authenticated;
revoke all on function public.spend_try_parse_numeric(text) from public, anon, authenticated;
revoke all on function public.spend_try_parse_timestamptz(jsonb) from public, anon, authenticated;
revoke all on function public.spend_normalize_account_id(text) from public, anon, authenticated;
revoke all on function public.spend_json_ms(jsonb) from public, anon, authenticated;
revoke all on function public.spend_is_credit_card(jsonb) from public, anon, authenticated;
revoke all on function public.spend_sanitize_card_object(jsonb) from public, anon, authenticated;
revoke all on function public.spend_sanitize_snapshot_jsonb(jsonb) from public, anon, authenticated;
revoke all on function public.merge_spend_snapshots_jsonb(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.capture_spend_backup_checkpoint_internal(uuid, jsonb, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.prune_spend_account_change_history(integer) from public, anon, authenticated;
revoke all on function public.claim_due_push_reminders_with_devices(integer, integer) from public, anon, authenticated;

revoke all on function public.save_spend_user_snapshot(jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.verify_spend_ledger_reconciliation(uuid) from public, anon, authenticated;
revoke all on function public.create_spend_backup_checkpoint(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.restore_spend_backup_checkpoint(uuid) from public, anon, authenticated;
revoke all on function public.register_spend_push_device(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.verify_spend_sql_installation() from public, anon, authenticated;

grant execute on function public.save_spend_user_snapshot(jsonb, text, boolean) to authenticated;
grant execute on function public.verify_spend_ledger_reconciliation(uuid) to authenticated, service_role;
grant execute on function public.create_spend_backup_checkpoint(text, text, jsonb) to authenticated;
grant execute on function public.restore_spend_backup_checkpoint(uuid) to authenticated;
grant execute on function public.register_spend_push_device(text, text, jsonb) to authenticated;
grant execute on function public.verify_spend_sql_installation() to authenticated, service_role;
grant execute on function public.claim_due_push_reminders_with_devices(integer, integer) to service_role;
grant execute on function public.prune_spend_account_change_history(integer) to service_role;

do $$
begin
  if to_regprocedure('public.summarize_spend_snapshot(jsonb)') is not null then
    execute 'revoke all on function public.summarize_spend_snapshot(jsonb) from public, anon, authenticated';
    execute 'grant execute on function public.summarize_spend_snapshot(jsonb) to authenticated';
  end if;
  if to_regprocedure('public.load_spend_user_snapshot()') is not null then
    execute 'revoke all on function public.load_spend_user_snapshot() from public, anon, authenticated';
    execute 'grant execute on function public.load_spend_user_snapshot() to authenticated';
  end if;
  if to_regprocedure('public.list_spend_backup_checkpoints(integer)') is not null then
    execute 'revoke all on function public.list_spend_backup_checkpoints(integer) from public, anon, authenticated';
    execute 'grant execute on function public.list_spend_backup_checkpoints(integer) to authenticated';
  end if;
  if to_regprocedure('public.claim_due_push_reminders(integer, integer)') is not null then
    execute 'revoke all on function public.claim_due_push_reminders(integer, integer) from public, anon, authenticated';
    execute 'grant execute on function public.claim_due_push_reminders(integer, integer) to service_role';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';

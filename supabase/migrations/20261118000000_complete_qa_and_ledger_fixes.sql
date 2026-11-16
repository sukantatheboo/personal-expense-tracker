-- =============================================================================
-- COMPLETE QA & LEDGER RECONCILIATION FIXES (2026.11.18)
-- =============================================================================
-- Fixes:
-- 1. Credit Card Liability Accounting & Legacy USD -> BDT subtitle normalization
--    in sync_spend_accounts_from_snapshot() and verify_spend_ledger_reconciliation()
-- 2. First-class Cash ('cash') ledger staging, running balances & reconciliation
-- 3. Numeric(16, 2) precision for all PL/pgSQL variables in sync_spend_accounts_from_snapshot() (BUG-06)
-- 4. Complete rollback tombstones (cards, recurringSchedules, budgets, expenses,
--    accountTransactions) in restore_spend_backup_checkpoint() (BUG-04)
-- 5. SECURITY DEFINER RPC register_spend_push_device() to detach shared browser
--    endpoints across accounts under RLS (BUG-03)
-- 6. Automatic 60-day purge of soft-deleted spend_account_transactions rows (BUG-07)
-- =============================================================================

-- 1. Helper: Identify whether a card JSON object is a Credit Card (liability account)
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

-- 2. SECURITY DEFINER RPC: register_spend_push_device (BUG-03)
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
  v_ep text := btrim(coalesce(p_endpoint, ''));
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_dev_id = '' or v_ep = '' or p_subscription is null or jsonb_typeof(p_subscription) <> 'object' then
    raise exception 'Invalid push device parameters' using errcode = '22023';
  end if;

  if to_regclass('public.push_devices') is null then
    return jsonb_build_object('status', 'skipped');
  end if;

  -- Remove any orphaned reminders & device rows tied to this browser endpoint under a previous user
  if to_regclass('public.push_reminders') is not null then
    delete from public.push_reminders r
    using public.push_devices d
    where d.endpoint = v_ep
      and d.user_id <> v_uid
      and r.user_id = d.user_id
      and r.device_id = d.device_id;
  end if;

  delete from public.push_devices
  where endpoint = v_ep
    and user_id <> v_uid;

  insert into public.push_devices (user_id, device_id, endpoint, subscription, updated_at)
  values (v_uid, v_dev_id, v_ep, p_subscription, timezone('utc', now()))
  on conflict (user_id, device_id) do update
  set endpoint = excluded.endpoint,
      subscription = excluded.subscription,
      updated_at = timezone('utc', now());

  return jsonb_build_object('status', 'registered', 'device_id', v_dev_id);
end;
$$;

revoke all on function public.register_spend_push_device(text, text, jsonb) from public, anon;
grant execute on function public.register_spend_push_device(text, text, jsonb) to authenticated;

-- 3. Trigger function sync_spend_accounts_from_snapshot (numeric(16,2), Credit Card & Cash Ledger, 60-day purge)
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
  v_card_init        numeric(16, 2);
  v_bal_val          numeric(16, 2);
  v_resolved_init    numeric(16, 2);
  v_opening_balances jsonb := '{}'::jsonb;
  v_running_balances jsonb := '{}'::jsonb;
  v_credit_cards     jsonb := '{}'::jsonb;
  v_deleted_cards    jsonb;
  v_deleted_tx       jsonb;
  v_deleted_exp      jsonb;
  v_start_date       date;
  v_configured       boolean;
  v_settings_ts      timestamptz;
  v_savings_card_id  text := null;
  v_cash_card_id     text := 'cash';
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
      if coalesce(v_card ->> 'subtitle', '') <> '' then
        v_card_sub := regexp_replace(v_card ->> 'subtitle', '\mUSD\M', 'BDT', 'gi');
        v_card := jsonb_set(v_card, '{subtitle}', to_jsonb(v_card_sub), true);
      end if;
      if upper(coalesce(v_card ->> 'currency', 'USD')) = 'USD' then
        v_card := jsonb_set(v_card, '{currency}', '"BDT"'::jsonb, true);
      end if;

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

      if public.spend_is_credit_card(v_card) then
        v_credit_cards := jsonb_set(v_credit_cards, array[v_card_id], 'true'::jsonb, true);
      end if;

      if v_cash_card_id = 'cash' and (
        v_card_id = 'cash'
        or v_card ->> 'provider' = 'cash'
        or v_card ->> 'category' = 'cash'
        or v_card ->> 'type' = 'cash'
      ) then
        v_cash_card_id := v_card_id;
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

  if not (v_opening_balances ? v_cash_card_id) then
    v_opening_balances := jsonb_set(
      v_opening_balances,
      array[v_cash_card_id],
      to_jsonb(round(coalesce(public.spend_try_parse_numeric(v_raw_balances ->> 'cash'), 0), 2)),
      true
    );
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

  -- Stage account transactions (including 'cash' transactions)
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
      jsonb_typeof(v_deleted_tx -> id) = 'object'
      and (v_deleted_tx -> id ->> 'deleted') = 'true'
    )
  order by id, updated_ms desc;

  -- Stage all expenses (including Cash expenses mapped to v_cash_card_id) & savings transfers
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
    case when is_savings_transfer then account else null end,
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
      case
        when coalesce(public.spend_normalize_account_id(coalesce(item ->> 'account', item ->> 'acct')), 'cash') = 'cash' then v_cash_card_id
        else public.spend_normalize_account_id(coalesce(item ->> 'account', item ->> 'acct'))
      end as account,
      (
        coalesce(item ->> 'category', item ->> 'cat', '') = 'Savings'
        and v_savings_card_id is not null
        and coalesce(public.spend_normalize_account_id(coalesce(item ->> 'account', item ->> 'acct')), v_cash_card_id) <> v_savings_card_id
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
      jsonb_typeof(v_deleted_exp -> id) = 'object'
      and (v_deleted_exp -> id ->> 'deleted') = 'true'
    )
  order by id, updated_ms desc
  on conflict (id) do nothing;

  -- Walk the staged ledger chronologically to compute exact running balances
  -- (applying Credit Card liability rules for credit cards and standard asset rules for debit/MFS/cash/savings)
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

  -- Purge soft-deleted ledger rows older than 60 days (BUG-07)
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

-- 4. Update verify_spend_ledger_reconciliation to support Credit Cards and Cash
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
  v_is_credit boolean;
  v_has_cash_card boolean := false;
  v_has_cash_activity boolean := false;
  v_open_amt numeric(16, 2);
  v_credits numeric(16, 2);
  v_debits numeric(16, 2);
  v_expected numeric(16, 2);
  v_actual numeric(16, 2);
  v_diff numeric(16, 2);
  v_accounts jsonb := '{}'::jsonb;
  v_discrepancy_count integer := 0;
  v_account_count integer := 0;
  v_total_opening numeric(16, 2) := 0;
  v_total_credits numeric(16, 2) := 0;
  v_total_debits numeric(16, 2) := 0;
  v_total_expected numeric(16, 2) := 0;
  v_total_actual numeric(16, 2) := 0;
  v_total_diff numeric(16, 2) := 0;
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

  -- Check if 'cash' card is already in v_cards; if not, append virtual 'cash' entry when Cash has balance or activity
  select exists (
    select 1
    from jsonb_array_elements(v_cards) c
    where btrim(coalesce(c ->> 'id', '')) = 'cash'
       or lower(coalesce(c ->> 'provider', '')) = 'cash'
       or lower(coalesce(c ->> 'category', '')) = 'cash'
       or lower(coalesce(c ->> 'type', '')) = 'cash'
  ) into v_has_cash_card;

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
          'initialBalance', coalesce(public.spend_try_parse_numeric(v_opening ->> 'cash'), 0),
          'currentBalance', coalesce(public.spend_try_parse_numeric(v_current ->> 'cash'), 0)
        )
      );
    end if;
  end if;

  for v_card in select value from jsonb_array_elements(v_cards) loop
    v_cid := coalesce(nullif(trim(v_card ->> 'id'), ''), '');
    if v_cid = '' then
      continue;
    end if;

    v_account_count := v_account_count + 1;
    v_cname := coalesce(nullif(trim(v_card ->> 'name'), ''), v_cid);
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

    v_accounts := jsonb_set(
      v_accounts,
      array[v_cid],
      jsonb_build_object(
        'id', v_cid,
        'name', v_cname,
        'type', case when v_is_credit then 'credit' when v_cid = 'cash' then 'cash' else 'asset' end,
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
    'schemaVersion', '2026.11.18',
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

-- 5. Complete rollback tombstones in restore_spend_backup_checkpoint (BUG-04)
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
  v_del_cards jsonb := '{}'::jsonb;
  v_del_budgets jsonb := '{}'::jsonb;
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

  -- Mark any transaction, expense, recurring schedule, card, or budget present in
  -- v_existing_data but absent in v_restored_data as deleted in deletedRecords
  -- so other connected devices drop rolled-back records immediately.
  if v_existing_data is not null then
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

    select coalesce(
      jsonb_object_agg(
        ex_id,
        jsonb_build_object('deleted', true, 'updatedAt', v_now_ms)
      ),
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
      jsonb_object_agg(
        ex_id,
        jsonb_build_object('deleted', true, 'updatedAt', v_now_ms)
      ),
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
      jsonb_object_agg(
        ex_month,
        jsonb_build_object('deleted', true, 'updatedAt', v_now_ms)
      ),
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

-- Re-run snapshot sync for all existing users so credit card and cash balances reconcile immediately
update public.spend_user_data
set data = data
where data is not null
  and jsonb_typeof(data) = 'object'
  and not (data ? '_encrypted')
  and coalesce(data ->> 'format', '') <> 'spend-encrypted-v1';

notify pgrst, 'reload schema';

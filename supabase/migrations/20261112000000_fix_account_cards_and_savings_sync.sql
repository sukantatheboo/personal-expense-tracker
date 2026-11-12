-- =============================================================================
-- Migration: 20261112000000_fix_account_cards_and_savings_sync.sql
-- Purpose:
--   1. Prevent load_spend_user_snapshot() from injecting legacy bkash/bank/savings
--      keys into accountData.settings.balances when custom cards are configured
--      (which previously triggered phantom "Cardholder" card creation).
--   2. Sync savings_balance in spend_account_settings with custom Savings Vault
--      cards (category/type/provider = 'savings') as well as legacy 'savings' key,
--      and keep card.initialBalance and settings.balances[card.id] consistent.
--   3. Preserve all custom card transactions from spend_user_data.data alongside
--      spend_account_transactions in load_spend_user_snapshot().
-- =============================================================================

create or replace function public.sync_spend_accounts_from_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_accounts jsonb;
  v_settings jsonb;
  v_balances jsonb;
  v_cards jsonb;
  v_transactions jsonb;
  v_extra_transactions jsonb;
  v_merged_transactions jsonb;
  v_start_date date;
  v_configured boolean;
  v_updated_at_ms numeric;
  v_updated_at timestamptz;
  v_savings_card_id text;
  v_savings_balance numeric(12, 2);
begin
  if new.data is null or jsonb_typeof(new.data) <> 'object' then
    return new;
  end if;

  if new.data->>'format' = 'spend-encrypted-v1' then
    return new;
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_accounts := coalesce(new.data->'accountData', '{}'::jsonb);
  v_settings := coalesce(v_accounts->'settings', '{}'::jsonb);
  v_balances := coalesce(v_settings->'balances', '{}'::jsonb);
  v_cards := case
    when jsonb_typeof(v_settings->'cards') = 'array' then v_settings->'cards'
    else '[]'::jsonb
  end;

  v_transactions := case
    when jsonb_typeof(v_accounts->'transactions') = 'array' then v_accounts->'transactions'
    else '[]'::jsonb
  end;
  v_extra_transactions := case
    when jsonb_typeof(new.data->'customAccountTransactions') = 'array' then new.data->'customAccountTransactions'
    else '[]'::jsonb
  end;
  v_merged_transactions := v_transactions || v_extra_transactions;

  begin
    v_start_date := coalesce((v_settings->>'startDate')::date, current_date);
  exception when others then
    v_start_date := current_date;
  end;

  if jsonb_typeof(v_settings->'updatedAt') = 'number' then
    v_updated_at_ms := (v_settings->>'updatedAt')::numeric;
    if v_updated_at_ms > 0 then
      v_updated_at := to_timestamp(v_updated_at_ms / 1000.0);
    else
      v_updated_at := coalesce(new.updated_at, timezone('utc', now()));
    end if;
  elsif jsonb_typeof(v_settings->'updatedAt') = 'string' and (v_settings->>'updatedAt') ~ '^\d+(\.\d+)?$' then
    v_updated_at_ms := (v_settings->>'updatedAt')::numeric;
    if v_updated_at_ms > 0 then
      v_updated_at := to_timestamp(v_updated_at_ms / 1000.0);
    else
      v_updated_at := coalesce(new.updated_at, timezone('utc', now()));
    end if;
  elsif jsonb_typeof(v_settings->'updatedAt') = 'string' then
    begin
      v_updated_at := (v_settings->>'updatedAt')::timestamptz;
    exception when others then
      v_updated_at := coalesce(new.updated_at, timezone('utc', now()));
    end;
  else
    v_updated_at := coalesce(new.updated_at, timezone('utc', now()));
  end if;

  v_configured := coalesce((v_settings->>'configured')::boolean, false)
    or coalesce((v_settings->>'cardsConfigured')::boolean, false)
    or jsonb_array_length(v_cards) > 0
    or coalesce(nullif(v_balances->>'bkash', '')::numeric, 0) > 0
    or coalesce(nullif(v_balances->>'bank', '')::numeric, 0) > 0
    or coalesce(nullif(v_balances->>'savings', '')::numeric, 0) > 0
    or jsonb_array_length(v_merged_transactions) > 0;

  select c->>'id'
  into v_savings_card_id
  from jsonb_array_elements(v_cards) as c
  where c->>'category' = 'savings'
     or c->>'type' = 'savings'
     or c->>'provider' = 'savings'
     or c->>'id' = 'savings'
  limit 1;

  v_savings_balance := greatest(
    0,
    coalesce(
      case
        when v_savings_card_id is not null
          and (v_balances->>v_savings_card_id) ~ '^-?\d+(\.\d+)?$'
        then (v_balances->>v_savings_card_id)::numeric(12, 2)
        else null
      end,
      case
        when (v_balances->>'savings') ~ '^-?\d+(\.\d+)?$'
        then (v_balances->>'savings')::numeric(12, 2)
        else 0
      end
    )
  );

  insert into public.spend_account_settings (
    user_id,
    start_date,
    bkash_balance,
    bank_balance,
    savings_balance,
    configured,
    updated_at
  )
  values (
    new.user_id,
    v_start_date,
    greatest(0, coalesce(
      case when (v_balances->>'bkash') ~ '^-?\d+(\.\d+)?$' then (v_balances->>'bkash')::numeric(12, 2) else 0 end,
      0
    )),
    greatest(0, coalesce(
      case when (v_balances->>'bank') ~ '^-?\d+(\.\d+)?$' then (v_balances->>'bank')::numeric(12, 2) else 0 end,
      0
    )),
    v_savings_balance,
    v_configured,
    v_updated_at
  )
  on conflict (user_id) do update
  set
    start_date = excluded.start_date,
    bkash_balance = excluded.bkash_balance,
    bank_balance = excluded.bank_balance,
    savings_balance = excluded.savings_balance,
    configured = excluded.configured,
    updated_at = excluded.updated_at;

  with parsed_tx as (
    select
      left(trim(coalesce(item->>'id', '')), 120) as id,
      case
        when item->>'type' = 'adjust' then 'adjustment'
        else item->>'type'
      end as tx_type,
      round(
        case
          when (item->>'amount') ~ '^\d+(\.\d+)?$' then (item->>'amount')::numeric
          else -1
        end,
        2
      )::numeric(12, 2) as amount,
      case
        when (item->>'date') ~ '^\d{4}-\d{2}-\d{2}$' then (item->>'date')::date
        else null
      end as tx_date,
      left(coalesce(item->>'description', item->>'note', ''), 80) as description,
      nullif(left(trim(coalesce(item->>'account', item->>'acct', '')), 120), '') as account,
      case
        when coalesce(item->>'direction', item->>'dir') in ('up', 'increase') then 'increase'
        when coalesce(item->>'direction', item->>'dir') in ('down', 'decrease') then 'decrease'
        else null
      end as direction,
      nullif(left(trim(coalesce(item->>'fromAccount', item->>'from_account', item->>'acct', '')), 120), '') as from_account,
      nullif(left(trim(coalesce(item->>'toAccount', item->>'to_account', item->>'to', '')), 120), '') as to_account,
      case
        when jsonb_typeof(item->'createdAt') = 'number' and (item->>'createdAt')::numeric > 0
          then to_timestamp(((item->>'createdAt')::numeric) / 1000.0)
        else timezone('utc', now())
      end as created_at,
      case
        when jsonb_typeof(item->'updatedAt') = 'number' and (item->>'updatedAt')::numeric > 0
          then to_timestamp(((item->>'updatedAt')::numeric) / 1000.0)
        when jsonb_typeof(item->'createdAt') = 'number' and (item->>'createdAt')::numeric > 0
          then to_timestamp(((item->>'createdAt')::numeric) / 1000.0)
        else timezone('utc', now())
      end as updated_at
    from jsonb_array_elements(v_merged_transactions) as item
    where jsonb_typeof(item) = 'object'
  ),
  valid_tx as (
    select distinct on (id)
      id,
      tx_type,
      amount,
      tx_date,
      description,
      case when tx_type in ('income', 'adjustment') then account else null end as account,
      case when tx_type = 'adjustment' then direction else null end as direction,
      case when tx_type = 'transfer' then from_account else null end as from_account,
      case when tx_type = 'transfer' then to_account else null end as to_account,
      created_at,
      updated_at
    from parsed_tx
    where id <> ''
      and tx_type in ('income', 'adjustment', 'transfer')
      and amount > 0
      and tx_date is not null
      and (
        (tx_type = 'income' and account is not null)
        or (tx_type = 'adjustment' and account is not null and direction in ('increase', 'decrease'))
        or (tx_type = 'transfer' and from_account is not null and to_account is not null and from_account <> to_account)
      )
    order by id, updated_at desc
  ),
  upserted as (
    insert into public.spend_account_transactions (
      user_id,
      id,
      type,
      amount,
      transaction_date,
      description,
      account,
      direction,
      from_account,
      to_account,
      created_at,
      updated_at,
      deleted_at
    )
    select
      new.user_id,
      id,
      tx_type,
      amount,
      tx_date,
      description,
      account,
      direction,
      from_account,
      to_account,
      created_at,
      updated_at,
      null
    from valid_tx
    on conflict (user_id, id) do update
    set
      type = excluded.type,
      amount = excluded.amount,
      transaction_date = excluded.transaction_date,
      description = excluded.description,
      account = excluded.account,
      direction = excluded.direction,
      from_account = excluded.from_account,
      to_account = excluded.to_account,
      updated_at = excluded.updated_at,
      deleted_at = null
    where public.spend_account_transactions.updated_at <= excluded.updated_at
       or public.spend_account_transactions.deleted_at is not null
    returning id
  )
  update public.spend_account_transactions t
  set
    deleted_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where t.user_id = new.user_id
    and t.deleted_at is null
    and not exists (
      select 1 from valid_tx v where v.id = t.id
    );

  return new;
end;
$$;

create or replace function public.load_spend_user_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  with raw_snapshot as (
    select data, updated_at
    from public.spend_user_data
    where user_id = v_user_id
  ),
  acct_settings as (
    select
      start_date,
      bkash_balance,
      bank_balance,
      savings_balance,
      configured,
      updated_at
    from public.spend_account_settings
    where user_id = v_user_id
  ),
  table_tx as (
    select
      t.id as tx_id,
      floor(extract(epoch from t.updated_at) * 1000)::bigint as tx_updated_ms,
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', t.id,
          'createdAt', floor(extract(epoch from t.created_at) * 1000)::bigint,
          'updatedAt', floor(extract(epoch from t.updated_at) * 1000)::bigint,
          'type', t.type,
          'amount', t.amount,
          'date', t.transaction_date::text,
          'description', t.description,
          'account', t.account,
          'direction', t.direction,
          'fromAccount', t.from_account,
          'toAccount', t.to_account
        )
      ) as item
    from public.spend_account_transactions t
    where t.user_id = v_user_id
      and t.deleted_at is null
  ),
  raw_tx as (
    select
      elem->>'id' as tx_id,
      coalesce(
        case
          when jsonb_typeof(elem->'updatedAt') = 'number' then (elem->>'updatedAt')::bigint
          when jsonb_typeof(elem->'createdAt') = 'number' then (elem->>'createdAt')::bigint
          else 0
        end,
        0
      ) as tx_updated_ms,
      elem as item
    from raw_snapshot r,
    lateral jsonb_array_elements(
      case
        when jsonb_typeof(r.data #> '{accountData,transactions}') = 'array'
          then r.data #> '{accountData,transactions}'
        else '[]'::jsonb
      end ||
      case
        when jsonb_typeof(r.data -> 'customAccountTransactions') = 'array'
          then r.data -> 'customAccountTransactions'
        else '[]'::jsonb
      end
    ) as elem
    where jsonb_typeof(elem) = 'object'
      and coalesce(elem->>'id', '') <> ''
      and not coalesce((r.data #> array['deletedRecords', 'accountTransactions', elem->>'id', 'deleted'])::boolean, false)
  ),
  combined_tx as (
    select distinct on (tx_id)
      tx_id,
      tx_updated_ms,
      item
    from (
      select tx_id, tx_updated_ms, item from raw_tx
      union all
      select tx_id, tx_updated_ms, item from table_tx
    ) all_tx
    where tx_id is not null and tx_id <> ''
    order by tx_id, tx_updated_ms desc
  ),
  acct_tx as (
    select coalesce(
      jsonb_agg(item order by coalesce((item->>'createdAt')::bigint, tx_updated_ms) asc),
      '[]'::jsonb
    ) as items
    from combined_tx
  )
  select
    case
      when r.data is null then
        jsonb_build_object(
          'data', null,
          'updated_at', null,
          'normalizedAccountSync', true
        )
      when r.data->>'format' = 'spend-encrypted-v1' then
        jsonb_build_object(
          'data', r.data,
          'updated_at', r.updated_at,
          'normalizedAccountSync', false
        )
      else
        jsonb_build_object(
          'updated_at', r.updated_at,
          'normalizedAccountSync', true,
          'data',
          jsonb_set(
            r.data,
            '{accountData}',
            jsonb_build_object(
              'settings',
              coalesce(r.data #> '{accountData,settings}', '{}'::jsonb) ||
              jsonb_build_object(
                'startDate', coalesce(s.start_date::text, r.data #>> '{accountData,settings,startDate}'),
                'balances', coalesce(r.data #> '{accountData,settings,balances}', '{}'::jsonb),
                'cards', coalesce(r.data #> '{accountData,settings,cards}', '[]'::jsonb),
                'cardsConfigured', coalesce(
                  (r.data #>> '{accountData,settings,cardsConfigured}')::boolean,
                  jsonb_typeof(r.data #> '{accountData,settings,cards}') = 'array'
                    and jsonb_array_length(r.data #> '{accountData,settings,cards}') > 0,
                  false
                ),
                'configured', coalesce(s.configured, (r.data #>> '{accountData,settings,configured}')::boolean, false),
                'updatedAt', greatest(
                  coalesce(floor(extract(epoch from s.updated_at) * 1000)::bigint, 0),
                  case
                    when jsonb_typeof(r.data #> '{accountData,settings,updatedAt}') = 'number'
                      then (r.data #>> '{accountData,settings,updatedAt}')::bigint
                    else 0
                  end
                )
              ),
              'transactions',
              tx.items
            ),
            true
          )
        )
    end
  into v_result
  from (select 1) as dummy
  left join raw_snapshot r on true
  left join acct_settings s on true
  cross join acct_tx tx;

  return v_result;
end;
$$;

-- =============================================================================
-- Migration: 20261125010000_p2_loader_currency_and_constraint_validation.sql
-- Purpose  : P2 Loader Parity (Currency + Timestamp Tombstones) & Constraint Validation
--
-- Includes:
--   1. Upgrade public.load_spend_user_snapshot() to:
--      - Emit per-transaction `currency` on normalized and raw fallback tx objects
--      - Enforce tombstone `updatedAt` dominance across `table_tx`, `raw_tx`,
--        `raw_exp`, and `table_exp` (including `recurring:<id>:<date>` keys)
--      - Respect `deletedRecords.cards` & empty-card states consistently
--      - Report `schemaVersion = '2026.11.25'`
--   2. Strip oversized `profileAvatar` on legacy checkpoints and run safe
--      `VALIDATE CONSTRAINT` on constraints introduced in `20261125000000`.
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Upgraded Authoritative Snapshot Loader (Currency + Timestamp Tombstones)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.load_spend_user_snapshot();
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
          'currency', coalesce(nullif(upper(btrim(t.currency)), ''), 'BDT'),
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
      and not (
        coalesce(r.data #>> array['deletedRecords', 'accountTransactions', t.id, 'deleted'], '') = 'true'
        and (
          public.spend_json_ms(r.data #> array['deletedRecords', 'accountTransactions', t.id, 'updatedAt']) = 0
          or public.spend_json_ms(r.data #> array['deletedRecords', 'accountTransactions', t.id, 'updatedAt'])
             >= coalesce(nullif(t.updated_at_ms, 0), floor(extract(epoch from t.updated_at) * 1000)::bigint)
        )
      )
      and not (
        coalesce(r.data #>> array['deletedRecords', 'expenses', t.id, 'deleted'], '') = 'true'
        and (
          public.spend_json_ms(r.data #> array['deletedRecords', 'expenses', t.id, 'updatedAt']) = 0
          or public.spend_json_ms(r.data #> array['deletedRecords', 'expenses', t.id, 'updatedAt'])
             >= coalesce(nullif(t.updated_at_ms, 0), floor(extract(epoch from t.updated_at) * 1000)::bigint)
        )
      )
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
      greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt')) as updated_ms,
      jsonb_set(
        elem,
        '{currency}',
        to_jsonb(coalesce(
          nullif(upper(left(btrim(elem ->> 'currency'), 8)), ''),
          mapped_currency.currency,
          'BDT'
        )),
        true
      ) as item
    from raw_snapshot r
    left join acct_settings s on true
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.data #> '{accountData,transactions}') = 'array'
           then r.data #> '{accountData,transactions}' else '[]'::jsonb end
      ||
      case when jsonb_typeof(r.data -> 'customAccountTransactions') = 'array'
           then r.data -> 'customAccountTransactions' else '[]'::jsonb end
    ) as elem
    cross join lateral (
      select coalesce(
        elem ->> 'fromAccount',
        elem ->> 'from_account',
        elem ->> 'account',
        elem ->> 'acct',
        elem ->> 'toAccount',
        elem ->> 'to_account',
        elem ->> 'to'
      ) as account_id
    ) tx_account
    left join lateral (
      select upper(left(coalesce(nullif(btrim(card ->> 'currency'), ''), 'BDT'), 8)) as currency
      from jsonb_array_elements(
        case
          when jsonb_typeof(s.cards) = 'array' then
            case when jsonb_array_length(s.cards) > 0 then s.cards
                 when jsonb_typeof(r.data #> '{accountData,settings,cards}') = 'array'
                   then r.data #> '{accountData,settings,cards}'
                 else '[]'::jsonb end
          when jsonb_typeof(r.data #> '{accountData,settings,cards}') = 'array'
            then r.data #> '{accountData,settings,cards}'
          else '[]'::jsonb
        end
      ) as card
      where card ->> 'id' = tx_account.account_id
         or (
           tx_account.account_id = 'cash'
           and (
             lower(coalesce(card ->> 'category', '')) = 'cash'
             or lower(coalesce(card ->> 'type', '')) = 'cash'
             or lower(coalesce(card ->> 'provider', '')) = 'cash'
           )
         )
      order by case when card ->> 'id' = tx_account.account_id then 0 else 1 end
      limit 1
    ) mapped_currency on true
    where jsonb_typeof(elem) = 'object'
      and coalesce(elem ->> 'id', '') <> ''
      and not (
        coalesce(r.data #>> array['deletedRecords', 'accountTransactions', elem ->> 'id', 'deleted'], '') = 'true'
        and (
          public.spend_json_ms(r.data #> array['deletedRecords', 'accountTransactions', elem ->> 'id', 'updatedAt']) = 0
          or public.spend_json_ms(r.data #> array['deletedRecords', 'accountTransactions', elem ->> 'id', 'updatedAt'])
             >= greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt'))
        )
      )
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
      case
        when coalesce(elem ->> 'recurringId', '') <> '' and coalesce(elem ->> 'date', '') <> ''
          then 'recurring:' || (elem ->> 'recurringId') || ':' || (elem ->> 'date')
        else 'expense:' || (elem ->> 'id')
      end as dedup_key,
      0 as src,
      public.spend_json_ms(elem -> 'createdAt') as created_ms,
      greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt')) as updated_ms,
      elem as item
    from raw_snapshot r
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.data -> 'expenses') = 'array'
           then r.data -> 'expenses' else '[]'::jsonb end
    ) as elem
    where jsonb_typeof(elem) = 'object'
      and coalesce(elem ->> 'id', '') <> ''
      and not (
        coalesce(r.data #>> array['deletedRecords', 'expenses', elem ->> 'id', 'deleted'], '') = 'true'
        and (
          public.spend_json_ms(r.data #> array['deletedRecords', 'expenses', elem ->> 'id', 'updatedAt']) = 0
          or public.spend_json_ms(r.data #> array['deletedRecords', 'expenses', elem ->> 'id', 'updatedAt'])
             >= greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt'))
        )
      )
      and not (
        coalesce(elem ->> 'recurringId', '') <> ''
        and coalesce(elem ->> 'date', '') <> ''
        and coalesce(r.data #>> array['deletedRecords', 'expenses', 'recurring:' || (elem ->> 'recurringId') || ':' || (elem ->> 'date'), 'deleted'], '') = 'true'
        and (
          public.spend_json_ms(r.data #> array['deletedRecords', 'expenses', 'recurring:' || (elem ->> 'recurringId') || ':' || (elem ->> 'date'), 'updatedAt']) = 0
          or public.spend_json_ms(r.data #> array['deletedRecords', 'expenses', 'recurring:' || (elem ->> 'recurringId') || ':' || (elem ->> 'date'), 'updatedAt'])
             >= greatest(public.spend_json_ms(elem -> 'updatedAt'), public.spend_json_ms(elem -> 'createdAt'))
        )
      )
  ),
  table_exp as (
    select
      t.id as exp_id,
      case
        when coalesce(t.recurring_id, '') <> ''
          then 'recurring:' || t.recurring_id || ':' || t.transaction_date::text
        else 'expense:' || t.id
      end as dedup_key,
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
      and not (
        coalesce(r.data #>> array['deletedRecords', 'expenses', t.id, 'deleted'], '') = 'true'
        and (
          public.spend_json_ms(r.data #> array['deletedRecords', 'expenses', t.id, 'updatedAt']) = 0
          or public.spend_json_ms(r.data #> array['deletedRecords', 'expenses', t.id, 'updatedAt'])
             >= coalesce(nullif(t.updated_at_ms, 0), floor(extract(epoch from t.updated_at) * 1000)::bigint)
        )
      )
      and not (
        coalesce(t.recurring_id, '') <> ''
        and coalesce(r.data #>> array['deletedRecords', 'expenses', 'recurring:' || t.recurring_id || ':' || t.transaction_date::text, 'deleted'], '') = 'true'
        and (
          public.spend_json_ms(r.data #> array['deletedRecords', 'expenses', 'recurring:' || t.recurring_id || ':' || t.transaction_date::text, 'updatedAt']) = 0
          or public.spend_json_ms(r.data #> array['deletedRecords', 'expenses', 'recurring:' || t.recurring_id || ':' || t.transaction_date::text, 'updatedAt'])
             >= coalesce(nullif(t.updated_at_ms, 0), floor(extract(epoch from t.updated_at) * 1000)::bigint)
        )
      )
  ),
  combined_exp_by_id as (
    select distinct on (exp_id) exp_id, dedup_key, created_ms, updated_ms, src, item
    from (
      select exp_id, dedup_key, src, created_ms, updated_ms, item from raw_exp
      union all
      select exp_id, dedup_key, src, created_ms, updated_ms, item from table_exp
    ) all_exp
    where exp_id is not null and exp_id <> ''
    order by exp_id, updated_ms desc, src asc
  ),
  combined_exp as (
    select distinct on (dedup_key) exp_id, created_ms, updated_ms, item
    from combined_exp_by_id
    order by dedup_key, updated_ms desc, src asc, exp_id asc
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
        jsonb_build_object('data', null, 'updated_at', null, 'normalizedAccountSync', true, 'schemaVersion', '2026.11.25')
      when r.data ? '_encrypted' or r.data ->> 'format' = 'spend-encrypted-v1' then
        jsonb_build_object('data', r.data, 'updated_at', r.updated_at, 'normalizedAccountSync', false, 'schemaVersion', '2026.11.25')
      else
        jsonb_build_object(
          'updated_at', r.updated_at,
          'normalizedAccountSync', true,
          'schemaVersion', '2026.11.25',
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
                  case when jsonb_typeof(s.cards) = 'array'
                            and (
                              jsonb_array_length(s.cards) > 0
                              or coalesce(s.configured, false)
                              or coalesce(r.data #> '{deletedRecords,cards}', '{}'::jsonb) <> '{}'::jsonb
                            )
                       then s.cards end,
                  r.data #> '{accountData,settings,cards}',
                  '[]'::jsonb
                ),
                'cardsConfigured', coalesce(
                  case when (r.data #>> '{accountData,settings,cardsConfigured}') in ('true', 'false')
                       then (r.data #>> '{accountData,settings,cardsConfigured}')::boolean end,
                  case when jsonb_typeof(s.cards) = 'array'
                       then jsonb_array_length(s.cards) > 0
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

revoke all on function public.load_spend_user_snapshot() from public, anon, authenticated;
grant execute on function public.load_spend_user_snapshot() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Strip Oversized Avatars on Legacy Checkpoints & Validate Constraints Safely
-- ─────────────────────────────────────────────────────────────────────────────
update public.spend_backup_checkpoints
set data = data - 'profileAvatar'
where data is not null
  and jsonb_typeof(data) = 'object'
  and (data ? 'profileAvatar')
  and pg_column_size(data) > 524288;

do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select unnest(array[
      'spend_account_transactions_mfs_amount_check',
      'spend_account_transactions_mfs_shape_check'
    ])
  loop
    begin
      if exists (
        select 1
        from pg_constraint c
        where c.conrelid = 'public.spend_account_transactions'::regclass
          and c.conname = v_constraint
          and not c.convalidated
      ) then
        execute format(
          'alter table public.spend_account_transactions validate constraint %I',
          v_constraint
        );
      end if;
    exception when check_violation then
      raise warning 'Skipped validating spend_account_transactions.% due to legacy rows violating check', v_constraint;
    end;
  end loop;

  for v_constraint in
    select unnest(array[
      'spend_backup_checkpoints_data_object_check',
      'spend_backup_checkpoints_max_size'
    ])
  loop
    begin
      if exists (
        select 1
        from pg_constraint c
        where c.conrelid = 'public.spend_backup_checkpoints'::regclass
          and c.conname = v_constraint
          and not c.convalidated
      ) then
        execute format(
          'alter table public.spend_backup_checkpoints validate constraint %I',
          v_constraint
        );
      end if;
    exception when check_violation then
      raise warning 'Skipped validating spend_backup_checkpoints.% due to legacy rows violating check', v_constraint;
    end;
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';

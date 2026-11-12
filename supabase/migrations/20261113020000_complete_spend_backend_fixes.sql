-- =============================================================================
-- Migration: 20261113020000_complete_spend_backend_fixes.sql
-- Purpose  : Complete backend hardening & sync integrity fixes for Spend.
--            Supersedes and combines 20261113000000_sync_safety_fixes.sql and
--            20261113010000_strict_snapshot_writes.sql with full card/balance
--            tracking, tombstone enforcement, FK integrity, and force-overwrite
--            support for backup restores.
--
-- BEFORE RUNNING:
--   1. Take a database backup in Supabase Dashboard > Database > Backups.
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Schema Enhancements: Track all custom cards & opening balances in
--    spend_account_settings so every card/balance change is audited in
--    spend_account_change_history and verifiable in SQL.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.spend_account_settings
  add column if not exists cards jsonb not null default '[]'::jsonb
    check (jsonb_typeof(cards) = 'array'),
  add column if not exists balances jsonb not null default '{}'::jsonb
    check (jsonb_typeof(balances) = 'object');

-- Add index for soft-deleted transactions used by load_spend_user_snapshot()
create index if not exists spend_account_transactions_user_deleted_idx
  on public.spend_account_transactions (user_id, id)
  where deleted_at is not null;

-- Remove any orphan push_reminders first, then enforce FK to push_devices
delete from public.push_reminders r
where not exists (
  select 1 from public.push_devices d
  where d.user_id = r.user_id
    and d.device_id = r.device_id
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'push_reminders_device_fk'
      and conrelid = 'public.push_reminders'::regclass
  ) then
    alter table public.push_reminders
      add constraint push_reminders_device_fk
      foreign key (user_id, device_id)
      references public.push_devices (user_id, device_id)
      on delete cascade;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Safe JSON timestamp helper: spend_json_ms(jsonb)
-- ─────────────────────────────────────────────────────────────────────────────
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

revoke all on function public.spend_json_ms(jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Snapshot -> Normalized Tables Trigger (sync_spend_accounts_from_snapshot)
--    - Guards against encrypted & partial snapshots
--    - Syncs custom cards & opening balances into spend_account_settings
--    - Respects deletedRecords.accountTransactions tombstones
--    - Prevents stale devices from resurrecting deleted transactions
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sync_spend_accounts_from_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accounts        jsonb;
  v_settings        jsonb;
  v_balances        jsonb;
  v_cards           jsonb;
  v_transactions    jsonb;
  v_extra           jsonb;
  v_merged          jsonb;
  v_tx_tombstones   jsonb;
  v_start_date      date;
  v_configured      boolean;
  v_settings_ts     timestamptz;
  v_savings_card_id text;
  v_savings         numeric;
  v_max_ts          timestamptz := timezone('utc', now()) + interval '5 minutes';
  v_settings_ms     bigint;
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
  v_balances := case when jsonb_typeof(v_settings -> 'balances') = 'object'
                     then v_settings -> 'balances' else '{}'::jsonb end;
  v_cards    := case when jsonb_typeof(v_settings -> 'cards') = 'array'
                     then v_settings -> 'cards' else '[]'::jsonb end;
  v_transactions := v_accounts -> 'transactions';
  v_extra    := case when jsonb_typeof(new.data -> 'customAccountTransactions') = 'array'
                     then new.data -> 'customAccountTransactions' else '[]'::jsonb end;
  v_merged   := v_transactions || v_extra;
  v_tx_tombstones := case
    when jsonb_typeof(new.data #> '{deletedRecords,accountTransactions}') = 'object'
      then new.data #> '{deletedRecords,accountTransactions}'
    else '{}'::jsonb
  end;

  v_start_date := public.spend_try_parse_date(v_settings ->> 'startDate');
  v_settings_ms := public.spend_json_ms(v_settings -> 'updatedAt');
  v_settings_ts := case when v_settings_ms > 0
                        then to_timestamp(v_settings_ms / 1000.0)
                        else coalesce(new.updated_at, timezone('utc', now())) end;
  v_settings_ts := least(v_settings_ts, v_max_ts);

  v_configured :=
        (v_settings ->> 'configured') = 'true'
     or (v_settings ->> 'cardsConfigured') = 'true'
     or jsonb_array_length(v_cards) > 0
     or coalesce(public.spend_try_parse_numeric(v_balances ->> 'bkash'), 0) > 0
     or coalesce(public.spend_try_parse_numeric(v_balances ->> 'bank'), 0) > 0
     or coalesce(public.spend_try_parse_numeric(v_balances ->> 'savings'), 0) > 0
     or jsonb_array_length(v_merged) > 0;

  select c ->> 'id'
    into v_savings_card_id
  from jsonb_array_elements(v_cards) as c
  where jsonb_typeof(c) = 'object'
    and (c ->> 'category' = 'savings'
      or c ->> 'type' = 'savings'
      or c ->> 'provider' = 'savings'
      or c ->> 'id' = 'savings')
  limit 1;

  v_savings := greatest(0, coalesce(
    public.spend_try_parse_numeric(v_balances ->> v_savings_card_id),
    public.spend_try_parse_numeric(v_balances ->> 'savings'),
    0
  ));

  insert into public.spend_account_settings (
    user_id, start_date, bkash_balance, bank_balance, savings_balance,
    cards, balances, configured, updated_at
  ) values (
    new.user_id,
    coalesce(v_start_date, current_date),
    greatest(0, coalesce(public.spend_try_parse_numeric(v_balances ->> 'bkash'), 0)),
    greatest(0, coalesce(public.spend_try_parse_numeric(v_balances ->> 'bank'), 0)),
    v_savings,
    v_cards,
    v_balances,
    v_configured,
    v_settings_ts
  )
  on conflict (user_id) do update
  set
    start_date      = coalesce(v_start_date, public.spend_account_settings.start_date),
    bkash_balance   = excluded.bkash_balance,
    bank_balance    = excluded.bank_balance,
    savings_balance = excluded.savings_balance,
    cards           = excluded.cards,
    balances        = excluded.balances,
    configured      = excluded.configured,
    version         = public.spend_account_settings.version + 1,
    updated_at      = excluded.updated_at
  where (
    public.spend_account_settings.start_date,
    public.spend_account_settings.bkash_balance,
    public.spend_account_settings.bank_balance,
    public.spend_account_settings.savings_balance,
    public.spend_account_settings.cards,
    public.spend_account_settings.balances,
    public.spend_account_settings.configured
  ) is distinct from (
    coalesce(v_start_date, public.spend_account_settings.start_date),
    excluded.bkash_balance,
    excluded.bank_balance,
    excluded.savings_balance,
    excluded.cards,
    excluded.balances,
    excluded.configured
  );

  with parsed_tx as (
    select
      left(btrim(coalesce(item ->> 'id', '')), 121) as id,
      case when item ->> 'type' in ('adjust', 'adjustment') then 'adjustment'
           else item ->> 'type' end as tx_type,
      public.spend_try_parse_numeric(item ->> 'amount') as amount,
      public.spend_try_parse_date(item ->> 'date') as tx_date,
      left(coalesce(item ->> 'description', item ->> 'note', ''), 80) as description,
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
    from jsonb_array_elements(v_merged) as item
    where jsonb_typeof(item) = 'object'
  ),
  non_tombstoned_tx as (
    select p.*
    from parsed_tx p
    where not (
      coalesce(v_tx_tombstones #>> array[p.id, 'deleted'], '') = 'true'
      and public.spend_json_ms(v_tx_tombstones #> array[p.id, 'updatedAt']) >= p.updated_ms
    )
  ),
  stamped_tx as (
    select
      p.*,
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
    from non_tombstoned_tx p
  ),
  valid_tx as (
    select distinct on (id)
      id,
      tx_type,
      amount,
      tx_date,
      description,
      case when tx_type in ('income', 'adjustment') then account end as account,
      case when tx_type = 'adjustment' then direction end as direction,
      case when tx_type = 'transfer' then from_account end as from_account,
      case when tx_type = 'transfer' then to_account end as to_account,
      created_at,
      updated_at
    from stamped_tx
    where char_length(id) between 1 and 120
      and tx_type in ('income', 'adjustment', 'transfer')
      and amount > 0
      and tx_date is not null
      and (
        (tx_type = 'income' and account is not null)
        or (tx_type = 'adjustment' and account is not null and direction in ('increase', 'decrease'))
        or (tx_type = 'transfer' and from_account is not null and to_account is not null
            and from_account <> to_account)
      )
    order by id, updated_at desc
  ),
  upserted as (
    insert into public.spend_account_transactions (
      user_id, id, type, amount, transaction_date, description,
      account, direction, from_account, to_account,
      created_at, updated_at, deleted_at
    )
    select
      new.user_id, id, tx_type, amount, tx_date, description,
      account, direction, from_account, to_account,
      created_at, updated_at, null
    from valid_tx
    on conflict (user_id, id) do update
    set
      type             = excluded.type,
      amount           = excluded.amount,
      transaction_date = excluded.transaction_date,
      description      = excluded.description,
      account          = excluded.account,
      direction        = excluded.direction,
      from_account     = excluded.from_account,
      to_account       = excluded.to_account,
      updated_at       = excluded.updated_at,
      deleted_at       = null
    where public.spend_account_transactions.updated_at <= excluded.updated_at
      and (
        public.spend_account_transactions.type,
        public.spend_account_transactions.amount,
        public.spend_account_transactions.transaction_date,
        public.spend_account_transactions.description,
        public.spend_account_transactions.account,
        public.spend_account_transactions.direction,
        public.spend_account_transactions.from_account,
        public.spend_account_transactions.to_account,
        public.spend_account_transactions.deleted_at
      ) is distinct from (
        excluded.type,
        excluded.amount,
        excluded.transaction_date,
        excluded.description,
        excluded.account,
        excluded.direction,
        excluded.from_account,
        excluded.to_account,
        excluded.deleted_at
      )
    returning 1
  )
  update public.spend_account_transactions t
  set deleted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where t.user_id = new.user_id
    and t.deleted_at is null
    and not exists (select 1 from valid_tx v where v.id = t.id)
    and (jsonb_array_length(v_merged) = 0 or exists (select 1 from valid_tx));

  return new;
end;
$$;

revoke all on function public.sync_spend_accounts_from_snapshot() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Authoritative Snapshot Loader (load_spend_user_snapshot)
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
           cards, balances, configured, updated_at
    from public.spend_account_settings
    where user_id = v_user_id
  ),
  table_tx as (
    select
      t.id as tx_id,
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
  combined_tx as (
    select distinct on (tx_id) tx_id, created_ms, updated_ms, item
    from (
      select tx_id, src, created_ms, updated_ms, item from raw_live
      union all
      select tx_id, src, created_ms, updated_ms, item from table_tx
    ) all_tx
    where tx_id is not null and tx_id <> ''
    order by tx_id, updated_ms desc, src asc
  ),
  acct_tx as (
    select coalesce(
      jsonb_agg(item order by coalesce(nullif(created_ms, 0), updated_ms) asc, tx_id asc),
      '[]'::jsonb
    ) as items
    from combined_tx
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
            r.data,
            '{accountData}',
            case when jsonb_typeof(r.data -> 'accountData') = 'object'
                 then r.data -> 'accountData' else '{}'::jsonb end
            || jsonb_build_object(
              'settings',
              coalesce(r.data #> '{accountData,settings}', '{}'::jsonb) ||
              jsonb_build_object(
                'startDate', coalesce(s.start_date::text, r.data #>> '{accountData,settings,startDate}'),
                'balances', coalesce(
                  nullif(s.balances, '{}'::jsonb),
                  r.data #> '{accountData,settings,balances}',
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

revoke all on function public.load_spend_user_snapshot() from public, anon;
grant execute on function public.load_spend_user_snapshot() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Strict Atomic Snapshot Save RPC (save_spend_user_snapshot)
--    - Serializes concurrent saves per user via pg_advisory_xact_lock
--    - Requires valid p_expected_updated_at when a row already exists
--    - Supports explicit p_force_overwrite for user-confirmed backup restores
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.save_spend_user_snapshot(jsonb, text);

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

  -- Serialize all saves for this user, even on initial sign-in when no row exists yet
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
      return null; -- conflict: another device saved after this client last loaded
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
-- 6. Clean Audit Trigger (without random() delete inside hot row trigger)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.audit_spend_account_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_entity text;
  v_entity_id text;
  v_previous jsonb;
  v_current jsonb;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    v_user_id := old.user_id;
    v_previous := to_jsonb(old);
    if tg_table_name = 'spend_account_settings' then
      v_entity := 'settings';
      v_entity_id := 'settings';
    else
      v_entity := 'transaction';
      v_entity_id := old.id;
    end if;
    insert into public.spend_account_change_history (
      user_id, entity, entity_id, operation, previous_data
    ) values (v_user_id, v_entity, v_entity_id, 'delete', v_previous);
    return old;
  end if;

  v_user_id := new.user_id;
  v_current := to_jsonb(new);
  if tg_table_name = 'spend_account_settings' then
    v_entity := 'settings';
    v_entity_id := 'settings';
  else
    v_entity := 'transaction';
    v_entity_id := new.id;
  end if;

  if tg_op = 'UPDATE' then
    v_previous := to_jsonb(old);
    if v_previous is not distinct from v_current then
      return new;
    end if;
  end if;

  insert into public.spend_account_change_history (
    user_id, entity, entity_id, operation, previous_data, new_data
  ) values (
    v_user_id,
    v_entity,
    v_entity_id,
    lower(tg_op),
    v_previous,
    v_current
  );

  return new;
end;
$$;

revoke all on function public.audit_spend_account_change() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Atomic Push Reminder Claim RPC (claim_due_push_reminders)
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Strict Select-Only RLS on Trigger-Managed Tables
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Users manage their own account settings" on public.spend_account_settings;
drop policy if exists "Users read their own account settings" on public.spend_account_settings;
create policy "Users read their own account settings"
  on public.spend_account_settings
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users manage their own account transactions" on public.spend_account_transactions;
drop policy if exists "Users read their own account transactions" on public.spend_account_transactions;
create policy "Users read their own account transactions"
  on public.spend_account_transactions
  for select to authenticated
  using (auth.uid() = user_id);

commit;

-- Spend: Immutable Cloud Backup Checkpoints (#1) & Ledger Reconciliation Check (#2)
-- Safe to run multiple times (idempotent).
-- Adds:
--   1. public.spend_backup_checkpoints table with strict RLS & daily uniqueness index
--   2. Automatic daily + pre-restore server-side snapshots inside save_spend_user_snapshot
--   3. One-click checkpoint listing, manual snapshot creation, and rollback RPCs
--   4. Deterministic SQL ledger reconciliation check (opening + credits - debits == current_balance)

create extension if not exists pgcrypto;

-- 1. Immutable Cloud Backup Checkpoints table
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

-- At most one automatic 'daily' checkpoint per user per UTC calendar day
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

-- 2. Snapshot summary & ledger reconciliation helpers
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

-- 3. Deterministic SQL Ledger Reconciliation Check (#2)
-- Verifies opening + credits - debits == current_balance across all active user accounts
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

    -- Credits: income on account, adjustment increase on account, incoming transfer, incoming savings
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

    -- Debits: expense on account, adjustment decrease on account, outgoing transfer, outgoing savings
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
    'isBalanced', (v_discrepancy_count = 0),
    'accountCount', v_account_count,
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

-- 4. Internal checkpoint capture & bounded retention helper
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

  -- Skip auto-checkpointing completely blank payloads unless explicitly manual
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
      user_id,
      checkpoint_type,
      checkpoint_date,
      label,
      data,
      ledger_summary,
      card_count,
      expense_count,
      tx_count,
      source_updated_at
    )
    values (
      p_user_id,
      'daily',
      v_today,
      v_label,
      p_data,
      v_summary,
      v_card_count,
      v_expense_count,
      v_tx_count,
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
    -- Avoid duplicate non-daily snapshots within 3 seconds of the exact same source state
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
        user_id,
        checkpoint_type,
        checkpoint_date,
        label,
        data,
        ledger_summary,
        card_count,
        expense_count,
        tx_count,
        source_updated_at
      )
      values (
        p_user_id,
        v_type,
        v_today,
        v_label,
        p_data,
        v_summary,
        v_card_count,
        v_expense_count,
        v_tx_count,
        coalesce(p_source_updated_at, timezone('utc', now()))
      )
      returning id into v_id;
    end if;
  end if;

  -- Prune oldest checkpoints beyond retention window (keep 60 daily + 30 manual/pre_restore)
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

-- 5. Upgrade save_spend_user_snapshot to automatically capture daily + pre-restore checkpoints
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

  -- Serialize concurrent saves per user to prevent lost updates
  perform pg_advisory_xact_lock(hashtextextended('spend_save:' || v_uid::text, 0));

  select updated_at, data
  into v_existing_updated_at, v_existing_data
  from public.spend_user_data
  where user_id = v_uid
  for update;

  -- Preserve existing cloud profileAvatar when keepalive payload sends sentinel token
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
      or jsonb_typeof(v_effective_data #> '{deletedRecords,expenses}') = 'object' and (v_effective_data #> '{deletedRecords,expenses}') <> '{}'::jsonb;
  end if;

  -- Guard against accidental blank wipe of populated cloud state
  if v_existing_has_records and not v_incoming_has_records and not coalesce(p_force_overwrite, false) then
    return jsonb_build_object(
      'status', 'conflict',
      'updated_at', v_existing_updated_at,
      'data', v_existing_data
    );
  end if;

  -- Optimistic concurrency check unless force_overwrite is requested
  if not coalesce(p_force_overwrite, false)
     and v_existing_updated_at is not null
     and (
       p_expected_updated_at is null
       or trim(p_expected_updated_at) = ''
       or date_trunc('milliseconds', v_existing_updated_at) <> date_trunc('milliseconds', p_expected_updated_at::timestamptz)
     ) then
    return jsonb_build_object(
      'status', 'conflict',
      'updated_at', v_existing_updated_at,
      'data', v_existing_data
    );
  end if;

  -- #1 Immutable Cloud Backup Checkpoints:
  -- (a) Before any force overwrite / restore, preserve existing state as a 'pre_restore' checkpoint
  if v_existing_has_records and coalesce(p_force_overwrite, false) then
    perform public.capture_spend_backup_checkpoint_internal(
      v_uid,
      v_existing_data,
      'pre_restore',
      'Automatic snapshot before restore or overwrite',
      v_existing_updated_at
    );
  end if;

  -- (b) Ensure today's daily checkpoint is captured (prefer existing pre-mutation state if already populated today)
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
        updated_at = excluded.updated_at;

  -- Also ensure today's daily checkpoint exists if this was the user's very first save
  if v_incoming_has_records then
    perform public.capture_spend_backup_checkpoint_internal(
      v_uid,
      v_effective_data,
      'daily',
      'Daily automatic snapshot',
      v_now
    );
  end if;

  -- Note: BEFORE INSERT OR UPDATE trigger sync_spend_accounts_from_snapshot on public.spend_user_data
  -- automatically normalizes cards, balances, and unified ledger transactions.
  v_reconciliation := public.verify_spend_ledger_reconciliation(v_uid);

  return jsonb_build_object(
    'status', 'saved',
    'updated_at', v_now,
    'reconciliation', v_reconciliation
  );
end;
$$;

-- 6. RPCs for listing, creating, and restoring immutable cloud backup checkpoints
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
    return jsonb_build_object(
      'status', 'empty',
      'checkpoint', null
    );
  end if;

  v_checkpoint_id := public.capture_spend_backup_checkpoint_internal(
    v_uid,
    v_snapshot,
    coalesce(nullif(trim(p_checkpoint_type), ''), 'manual'),
    p_label,
    v_source_updated_at
  );

  if v_checkpoint_id is null then
    return jsonb_build_object(
      'status', 'skipped',
      'checkpoint', null
    );
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

  -- Snapshot current state before restoring checkpoint so rollback itself is reversible
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

  insert into public.spend_user_data (user_id, data, updated_at)
  values (v_uid, v_target.data, v_now)
  on conflict (user_id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at;

  -- Note: BEFORE INSERT OR UPDATE trigger sync_spend_accounts_from_snapshot on public.spend_user_data
  -- automatically normalizes cards, balances, and unified ledger transactions.
  v_reconciliation := public.verify_spend_ledger_reconciliation(v_uid);

  return jsonb_build_object(
    'status', 'restored',
    'checkpoint_id', v_target.id,
    'checkpoint_date', v_target.checkpoint_date,
    'checkpoint_type', v_target.checkpoint_type,
    'updated_at', v_now,
    'data', v_target.data,
    'reconciliation', v_reconciliation
  );
end;
$$;

revoke all on function public.summarize_spend_snapshot(jsonb) from public;
revoke all on function public.verify_spend_ledger_reconciliation(uuid) from public;
revoke all on function public.capture_spend_backup_checkpoint_internal(uuid, jsonb, text, text, timestamptz) from public;
revoke all on function public.save_spend_user_snapshot(jsonb, text, boolean) from public, anon;
revoke all on function public.list_spend_backup_checkpoints(integer) from public;
revoke all on function public.create_spend_backup_checkpoint(text, text, jsonb) from public;
revoke all on function public.restore_spend_backup_checkpoint(uuid) from public;

grant execute on function public.summarize_spend_snapshot(jsonb) to authenticated;
grant execute on function public.verify_spend_ledger_reconciliation(uuid) to authenticated;
grant execute on function public.save_spend_user_snapshot(jsonb, text, boolean) to authenticated;
grant execute on function public.list_spend_backup_checkpoints(integer) to authenticated;
grant execute on function public.create_spend_backup_checkpoint(text, text, jsonb) to authenticated;
grant execute on function public.restore_spend_backup_checkpoint(uuid) to authenticated;

-- Migration: 20261111000000_backend_concurrency_and_sync_fixes.sql
-- Description:
-- 1. Atomic save_spend_user_snapshot RPC with safe OCC timestamp tolerance
-- 2. Non-destructive transaction reconciliation and balance merging in load_spend_user_snapshot
-- 3. Automatic 60-day retention pruning in audit_spend_account_change to prevent table bloat
-- 4. Safe claim_until leasing support in preserve_push_reminder_progress
-- 5. Performance index on push_reminders (active, next_notify_at)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Atomic save_spend_user_snapshot RPC with OCC Lock
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.save_spend_user_snapshot(
  p_data jsonb,
  p_expected_updated_at text default null
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

  -- Lock user snapshot row for atomic concurrency check
  select updated_at into v_current_updated_at
  from public.spend_user_data
  where user_id = v_uid
  for update;

  if v_current_updated_at is not null and p_expected_updated_at is not null and btrim(p_expected_updated_at) <> '' then
    begin
      v_expected_parsed := p_expected_updated_at::timestamptz;
    exception when others then
      v_expected_parsed := null;
    end;

    -- Compare timestamps with 1-second tolerance to prevent microsecond/millisecond string formatting discrepancies
    if v_expected_parsed is not null and abs(extract(epoch from (v_current_updated_at - v_expected_parsed))) > 1.0 then
      return null; -- OCC conflict: remote was modified concurrently
    end if;
  end if;

  insert into public.spend_user_data (user_id, data, updated_at)
  values (v_uid, p_data, timezone('utc', now()))
  on conflict (user_id) do update
  set data = excluded.data, updated_at = timezone('utc', now())
  returning updated_at into v_new_updated_at;

  return v_new_updated_at;
end;
$$;

revoke all on function public.save_spend_user_snapshot(jsonb, text) from public, anon;
grant execute on function public.save_spend_user_snapshot(jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Enhanced load_spend_user_snapshot with non-destructive union
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.load_spend_user_snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'data', null,
      'updated_at', null,
      'normalizedAccountSync', true
    );
  end if;

  with raw_snapshot as (
    select d.data, d.updated_at
    from public.spend_user_data d
    where d.user_id = auth.uid()
  ),
  account_settings as (
    select
      s.start_date,
      s.bkash_balance,
      s.bank_balance,
      s.savings_balance,
      s.configured,
      s.updated_at
    from public.spend_account_settings s
    where s.user_id = auth.uid()
  ),
  account_transactions as (
    select
      coalesce(
        jsonb_agg(
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
          )
          order by t.created_at asc, t.id asc
        ),
        '[]'::jsonb
      ) as items
    from public.spend_account_transactions t
    where t.user_id = auth.uid()
      and t.deleted_at is null
  )
  select jsonb_build_object(
    'data',
    case
      when r.data is null then null
      when r.data ? '_encrypted' or coalesce((r.data->>'_encrypted')::boolean, false) then r.data
      else jsonb_set(
        r.data,
        '{accountData}',
        jsonb_build_object(
          'settings',
          case
            when s.start_date is not null then
              coalesce(r.data #> '{accountData,settings}', '{}'::jsonb) ||
              jsonb_build_object(
                'startDate', s.start_date::text,
                'balances',
                case
                  when (r.data #> '{accountData,settings,balances}') is not null then
                    coalesce(r.data #> '{accountData,settings,balances}', '{}'::jsonb) ||
                    jsonb_strip_nulls(jsonb_build_object(
                      'bkash', case when s.bkash_balance > 0 then s.bkash_balance else null end,
                      'bank', case when s.bank_balance > 0 then s.bank_balance else null end,
                      'savings', case when s.savings_balance > 0 then s.savings_balance else null end
                    ))
                  else coalesce(r.data #> '{accountData,settings,balances}', '{}'::jsonb)
                end,
                'cards', coalesce(r.data #> '{accountData,settings,cards}', '[]'::jsonb),
                'cardsConfigured', coalesce(
                  (r.data #>> '{accountData,settings,cardsConfigured}')::boolean,
                  case when jsonb_array_length(coalesce(r.data #> '{accountData,settings,cards}', '[]'::jsonb)) > 0 then true else s.configured end
                ),
                'configured', s.configured,
                'updatedAt', greatest(
                  floor(extract(epoch from s.updated_at) * 1000)::bigint,
                  coalesce((r.data #>> '{accountData,settings,updatedAt}')::bigint, 0)
                )
              )
            else coalesce(r.data #> '{accountData,settings}', '{}'::jsonb)
          end,
          'transactions',
          case
            when s.start_date is not null then
              (
                select coalesce(
                  jsonb_agg(merged_item order by (merged_item->>'createdAt')::bigint asc, merged_item->>'id' asc),
                  '[]'::jsonb
                )
                from (
                  select value as merged_item from jsonb_array_elements(tx.items)
                  union all
                  select value as merged_item from jsonb_array_elements(coalesce(r.data #> '{accountData,transactions}', '[]'::jsonb))
                  where not exists (
                    select 1 from public.spend_account_transactions t_any
                    where t_any.user_id = auth.uid()
                      and t_any.id = value->>'id'
                  )
                ) sub
              )
            else coalesce(r.data #> '{accountData,transactions}', '[]'::jsonb)
          end
        ),
        true
      )
    end,
    'updated_at',
    r.updated_at,
    'normalizedAccountSync',
    case
      when r.data ? '_encrypted' or coalesce((r.data->>'_encrypted')::boolean, false) then false
      else true
    end
  )
  into v_result
  from raw_snapshot r
  left join account_settings s on true
  cross join account_transactions tx;

  if v_result is null then
    return jsonb_build_object(
      'data', null,
      'updated_at', null,
      'normalizedAccountSync', true
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.load_spend_user_snapshot() from public, anon;
grant execute on function public.load_spend_user_snapshot() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Automatic Audit History Retention Pruning (60 Days)
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

  -- Probabilistically prune change history older than 60 days to keep table bounded
  if random() < 0.05 then
    delete from public.spend_account_change_history
    where user_id = v_user_id
      and changed_at < timezone('utc', now()) - interval '60 days';
  end if;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lease-Safe preserve_push_reminder_progress
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Case 1: Occurrence advanced forward (after successful push or skip)
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

  -- Case 2: Claim lease acquisition or renewal (next_date unchanged)
  if new.claim_until is not null and new.next_date = old.next_date then
    new.next_notify_at := old.next_notify_at;
    new.updated_at := timezone('utc', now());
    return new;
  end if;

  -- Case 3: Releasing an expired/failed claim without advancing next_date
  if old.claim_until is not null and new.claim_until is null and new.next_date = old.next_date then
    new.next_notify_at := old.next_notify_at;
    new.pending_notification := false;
    new.updated_at := timezone('utc', now());
    return new;
  end if;

  -- Case 4: General schedule or reminder_time edits
  if new.next_date < old.next_date
     and new.reminder_time is not distinct from old.reminder_time
     and new.interval is not distinct from old.interval
     and new.day_of_month is not distinct from old.day_of_month then
    new.next_date := old.next_date;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Due Reminders Performance Index
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists push_reminders_due_idx
  on public.push_reminders (active, next_notify_at asc)
  where active = true;

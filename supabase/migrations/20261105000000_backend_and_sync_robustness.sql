-- Backend & Sync Robustness Migration
-- 1. Ensure authenticated users have execute permissions on load_spend_user_snapshot
-- 2. Make sync_spend_accounts_from_snapshot resilient against malformed rows, support direction normalization,
--    guard against stale timestamp overwrites, and cleanly handle transaction clearing
-- 3. Expand push_devices endpoint check constraint for Windows/Edge Push Services (wns.windows.com / notify.windows.com)
-- 4. Fix preserve_push_reminder_progress trigger so Edge Function next_date advances and user schedule edits are never blocked
-- 5. Return authoritative spend_user_data.updated_at in load_spend_user_snapshot for optimistic concurrency control

-- Update push_devices endpoint check constraint to support all major browser push notification services
alter table public.push_devices
  drop constraint if exists push_devices_endpoint_check;

alter table public.push_devices
  add constraint push_devices_endpoint_check check (
    endpoint ~ '^https://([a-zA-Z0-9.-]+\.)?(fcm\.googleapis\.com|web\.push\.apple\.com|services\.mozilla\.com|notify\.windows\.com|wns\.windows\.com)/'
  );

-- Clean up any orphaned push_reminders without a matching push_devices row
delete from public.push_reminders r
where not exists (
  select 1
  from public.push_devices d
  where d.user_id = r.user_id
    and d.device_id = r.device_id
);

-- Timezone-safe preserve_push_reminder_progress that properly resets pending_notification when advancing next_date
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
    new.updated_at := now();
    return new;
  end if;

  -- If the Edge Function or client explicitly advanced next_date forward, clear pending claim state
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
    new.updated_at := now();
    return new;
  end if;

  if new.claim_until is not null
     and new.claim_until > coalesce(old.claim_until, '-infinity'::timestamptz)
     and new.next_notify_at = new.claim_until then
    new.next_date := old.next_date;
    new.pending_notification := true;
  elsif old.pending_notification and new.next_date <= old.next_date and new.pending_notification then
    new.next_notify_at := old.next_notify_at;
    new.next_date := old.next_date;
    new.pending_notification := true;
  else
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
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Resilient sync_spend_accounts_from_snapshot trigger function
create or replace function public.sync_spend_accounts_from_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_data jsonb;
  v_settings jsonb;
  v_balances jsonb;
  v_transactions jsonb;
  v_tx jsonb;
  v_id text;
  v_type text;
  v_amount numeric;
  v_date date;
  v_description text;
  v_account text;
  v_direction text;
  v_from_account text;
  v_to_account text;
  v_seen_ids text[] := array[]::text[];
begin
  if auth.uid() is not null and auth.uid() <> new.user_id then
    raise exception 'Unauthorized account sync for user %', new.user_id
      using errcode = '42501';
  end if;

  -- GUARD 1: If snapshot is client-side encrypted, bypass normalization to prevent wiping accounts
  if new.data ? '_encrypted' or coalesce((new.data->>'_encrypted')::boolean, false) then
    return new;
  end if;

  -- GUARD 2: If data does not contain accountData, do not overwrite existing tables
  if not (new.data ? 'accountData') or (new.data->'accountData') is null or (new.data->'accountData') = '{}'::jsonb then
    return new;
  end if;

  v_account_data := coalesce(new.data->'accountData', '{}'::jsonb);
  v_settings := coalesce(v_account_data->'settings', '{}'::jsonb);
  v_balances := coalesce(v_settings->'balances', '{}'::jsonb);
  v_transactions := case
    when jsonb_typeof(v_account_data->'transactions') = 'array'
      then v_account_data->'transactions'
    else '[]'::jsonb
  end;

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
    coalesce(public.spend_try_parse_date(v_settings->>'startDate'), current_date),
    round(greatest(coalesce(public.spend_try_parse_numeric(v_balances->>'bkash'), 0), 0), 2),
    round(greatest(coalesce(public.spend_try_parse_numeric(v_balances->>'bank'), 0), 0), 2),
    round(greatest(coalesce(public.spend_try_parse_numeric(v_balances->>'savings'), 0), 0), 2),
    coalesce((v_settings->>'configured')::boolean, false),
    coalesce(public.spend_try_parse_timestamptz(v_settings->'updatedAt'), timezone('utc', now()))
  )
  on conflict (user_id) do update
  set
    start_date = excluded.start_date,
    bkash_balance = excluded.bkash_balance,
    bank_balance = excluded.bank_balance,
    savings_balance = excluded.savings_balance,
    configured = excluded.configured,
    updated_at = excluded.updated_at
  where (
    (
      public.spend_account_settings.start_date,
      public.spend_account_settings.bkash_balance,
      public.spend_account_settings.bank_balance,
      public.spend_account_settings.savings_balance,
      public.spend_account_settings.configured
    ) is distinct from (
      excluded.start_date,
      excluded.bkash_balance,
      excluded.bank_balance,
      excluded.savings_balance,
      excluded.configured
    )
    and (
      public.spend_account_settings.updated_at is null
      or excluded.updated_at >= public.spend_account_settings.updated_at
    )
  );

  for v_tx in select value from jsonb_array_elements(v_transactions)
  loop
    v_id := nullif(btrim(coalesce(v_tx->>'id', '')), '');
    v_type := coalesce(v_tx->>'type', '');
    if v_type in ('adjustment', 'adjust') then
      v_type := 'adjustment';
    end if;
    v_amount := round(coalesce(public.spend_try_parse_numeric(v_tx->>'amount'), 0), 2);
    v_date := public.spend_try_parse_date(v_tx->>'date');
    v_description := left(coalesce(v_tx->>'description', ''), 80);
    v_account := nullif(btrim(coalesce(v_tx->>'account', '')), '');
    v_direction := nullif(btrim(coalesce(v_tx->>'direction', '')), '');
    if v_direction in ('up', 'increase') then
      v_direction := 'increase';
    elsif v_direction in ('down', 'decrease') then
      v_direction := 'decrease';
    end if;
    v_from_account := nullif(btrim(coalesce(v_tx->>'fromAccount', '')), '');
    v_to_account := nullif(btrim(coalesce(v_tx->>'toAccount', '')), '');

    if v_id is null or char_length(v_id) > 120 or v_amount <= 0 or v_date is null then
      continue;
    end if;

    if v_type = 'income' then
      if v_account is null or char_length(v_account) > 120 then
        continue;
      end if;
      v_direction := null;
      v_from_account := null;
      v_to_account := null;
    elsif v_type = 'adjustment' then
      if v_account is null or char_length(v_account) > 120 or v_direction not in ('increase', 'decrease') then
        continue;
      end if;
      v_from_account := null;
      v_to_account := null;
    elsif v_type = 'transfer' then
      if v_from_account is null
        or v_to_account is null
        or char_length(v_from_account) > 120
        or char_length(v_to_account) > 120
        or v_from_account = v_to_account then
        continue;
      end if;
      v_account := null;
      v_direction := null;
    else
      continue;
    end if;

    v_seen_ids := array_append(v_seen_ids, v_id);

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
    values (
      new.user_id,
      v_id,
      v_type,
      v_amount,
      v_date,
      v_description,
      v_account,
      v_direction,
      v_from_account,
      v_to_account,
      coalesce(public.spend_try_parse_timestamptz(v_tx->'createdAt'), timezone('utc', now())),
      coalesce(
        public.spend_try_parse_timestamptz(v_tx->'updatedAt'),
        public.spend_try_parse_timestamptz(v_tx->'createdAt'),
        timezone('utc', now())
      ),
      null
    )
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
    where (
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
    and excluded.updated_at >= public.spend_account_transactions.updated_at;
  end loop;

  -- Soft-delete transactions present in DB but absent from the current snapshot.
  if array_length(v_seen_ids, 1) > 0 then
    update public.spend_account_transactions
    set deleted_at = timezone('utc', now()), updated_at = timezone('utc', now())
    where user_id = new.user_id
      and deleted_at is null
      and id <> all(v_seen_ids);
  end if;

  -- Process explicit client tombstones
  declare
    v_deleted jsonb := new.data #> '{deletedRecords,accountTransactions}';
    v_tombstone record;
    v_tombstone_time timestamptz;
  begin
    if jsonb_typeof(v_deleted) = 'object' then
      for v_tombstone in select key, value from jsonb_each(v_deleted)
      loop
        if char_length(v_tombstone.key) between 1 and 120 then
          v_tombstone_time := public.spend_try_parse_timestamptz(v_tombstone.value->'updatedAt');
          if v_tombstone.value ->> 'deleted' = 'true' then
            update public.spend_account_transactions
            set deleted_at = timezone('utc', now()), updated_at = timezone('utc', now())
            where user_id = new.user_id
              and id = v_tombstone.key
              and deleted_at is null
              and (v_tombstone_time is null or v_tombstone_time >= updated_at);
          elsif v_tombstone.value ->> 'deleted' = 'false' then
            update public.spend_account_transactions
            set deleted_at = null, updated_at = timezone('utc', now())
            where user_id = new.user_id
              and id = v_tombstone.key
              and deleted_at is not null
              and (v_tombstone_time is null or v_tombstone_time >= updated_at);
          end if;
        end if;
      end loop;
    end if;
  end;

  -- If client explicitly cleared all transactions (empty array), soft-delete remaining active records
  if jsonb_typeof(v_account_data->'transactions') = 'array' and jsonb_array_length(v_transactions) = 0 then
    update public.spend_account_transactions
    set deleted_at = timezone('utc', now()), updated_at = timezone('utc', now())
    where user_id = new.user_id
      and deleted_at is null;
  end if;

  return new;
end;
$$;

-- Enhanced load_spend_user_snapshot function returning authoritative r.updated_at for optimistic concurrency
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
                'balances', coalesce(r.data #> '{accountData,settings,balances}', '{}'::jsonb),
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
            when s.start_date is not null then tx.items
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

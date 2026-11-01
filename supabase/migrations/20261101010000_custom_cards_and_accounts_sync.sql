-- Support custom card IDs and preserve settings.cards & custom card balances in cloud sync snapshots

-- Create helper parsing functions that the updated trigger function depends on.
-- These replace the older spend_try_date / spend_try_money helpers with
-- consistent naming and add a new timestamptz parser.

create or replace function public.spend_try_parse_date(p_value text)
returns date
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  return p_value::date;
exception when others then
  return null;
end;
$$;

create or replace function public.spend_try_parse_numeric(p_value text)
returns numeric
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_amount numeric;
begin
  v_amount := p_value::numeric;
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

create or replace function public.spend_try_parse_timestamptz(p_value jsonb)
returns timestamptz
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_ms numeric;
begin
  -- Accepts a JSON number (epoch milliseconds) or a JSON string (ISO 8601).
  if jsonb_typeof(p_value) = 'number' then
    v_ms := p_value::text::numeric;
    return to_timestamp(v_ms / 1000.0);
  elsif jsonb_typeof(p_value) = 'string' then
    return (p_value #>> '{}')::timestamptz;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

revoke all on function public.spend_try_parse_date(text) from public, anon, authenticated;
revoke all on function public.spend_try_parse_numeric(text) from public, anon, authenticated;
revoke all on function public.spend_try_parse_timestamptz(jsonb) from public, anon, authenticated;

alter table public.spend_account_transactions
  drop constraint if exists spend_account_transactions_valid_shape;

alter table public.spend_account_transactions
  add constraint spend_account_transactions_valid_shape check (
    (
      type = 'income'
      and account is not null
      and char_length(account) between 1 and 120
      and direction is null
      and from_account is null
      and to_account is null
    )
    or (
      type = 'adjustment'
      and account is not null
      and char_length(account) between 1 and 120
      and direction in ('increase', 'decrease')
      and from_account is null
      and to_account is null
    )
    or (
      type = 'transfer'
      and account is null
      and direction is null
      and from_account is not null
      and to_account is not null
      and char_length(from_account) between 1 and 120
      and char_length(to_account) between 1 and 120
      and from_account <> to_account
    )
  );

create or replace function public.sync_spend_accounts_from_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_data jsonb := coalesce(new.data->'accountData', '{}'::jsonb);
  v_settings jsonb := coalesce(v_account_data->'settings', '{}'::jsonb);
  v_balances jsonb := coalesce(v_settings->'balances', '{}'::jsonb);
  v_transactions jsonb := case
    when jsonb_typeof(v_account_data->'transactions') = 'array'
      then v_account_data->'transactions'
    else '[]'::jsonb
  end;
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
    v_from_account := nullif(btrim(coalesce(v_tx->>'fromAccount', '')), '');
    v_to_account := nullif(btrim(coalesce(v_tx->>'toAccount', '')), '');

    if v_id is null or char_length(v_id) > 120 then
      raise exception 'Invalid spend_account_transactions.id'
        using errcode = '22023';
    end if;

    if v_amount <= 0 or v_date is null then
      raise exception 'Invalid spend_account_transactions amount/date for id %', v_id
        using errcode = '22023';
    end if;

    if v_type = 'income' then
      if v_account is null or char_length(v_account) > 120 then
        raise exception 'Invalid income account for id %', v_id
          using errcode = '22023';
      end if;
      v_direction := null;
      v_from_account := null;
      v_to_account := null;
    elsif v_type = 'adjustment' then
      if v_account is null or char_length(v_account) > 120 or v_direction not in ('increase', 'decrease') then
        raise exception 'Invalid adjustment fields for id %', v_id
          using errcode = '22023';
      end if;
      v_from_account := null;
      v_to_account := null;
    elsif v_type = 'transfer' then
      if v_from_account is null
        or v_to_account is null
        or char_length(v_from_account) > 120
        or char_length(v_to_account) > 120
        or v_from_account = v_to_account then
        raise exception 'Invalid transfer accounts for id %', v_id
          using errcode = '22023';
      end if;
      v_account := null;
      v_direction := null;
    else
      raise exception 'Invalid spend_account_transactions.type for id %', v_id
        using errcode = '22023';
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
    );
  end loop;

  -- Soft-delete transactions present in DB but absent from the current snapshot.
  -- This prevents ghost records from reappearing after client-side deletion.
  if array_length(v_seen_ids, 1) > 0 then
    update public.spend_account_transactions
    set deleted_at = timezone('utc', now()), updated_at = timezone('utc', now())
    where user_id = new.user_id
      and deleted_at is null
      and id <> all(v_seen_ids);
  end if;

  declare
    v_deleted jsonb := new.data #> '{deletedRecords,accountTransactions}';
    v_tombstone record;
  begin
    if jsonb_typeof(v_deleted) = 'object' then
      for v_tombstone in select key, value from jsonb_each(v_deleted)
      loop
        if char_length(v_tombstone.key) between 1 and 120 then
          if v_tombstone.value ->> 'deleted' = 'true' then
            update public.spend_account_transactions
            set deleted_at = timezone('utc', now()), updated_at = timezone('utc', now())
            where user_id = new.user_id and id = v_tombstone.key and deleted_at is null;
          elsif v_tombstone.value ->> 'deleted' = 'false' then
            update public.spend_account_transactions
            set deleted_at = null, updated_at = timezone('utc', now())
            where user_id = new.user_id and id = v_tombstone.key and deleted_at is not null;
          end if;
        end if;
      end loop;
    end if;
  end;

  return new;
end;
$$;

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
      ) as items,
      max(t.updated_at) as latest_updated_at
    from public.spend_account_transactions t
    where t.user_id = auth.uid()
      and t.deleted_at is null
  )
  select jsonb_build_object(
    'data',
    case
      when r.data is null then null
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
                'balances', coalesce(r.data #> '{accountData,settings,balances}', '{}'::jsonb) || jsonb_build_object(
                  'bkash', s.bkash_balance,
                  'bank', s.bank_balance,
                  'savings', coalesce(s.savings_balance, 0)
                ),
                'cards', coalesce(r.data #> '{accountData,settings,cards}', '[]'::jsonb),
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
    case
      when r.data is null then null
      else greatest(
        r.updated_at,
        coalesce(s.updated_at, r.updated_at),
        coalesce(tx.latest_updated_at, r.updated_at)
      )
    end,
    'normalizedAccountSync',
    true
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

-- Prevent unbounded JSON payloads in spend_user_data (max 512 KB).
alter table public.spend_user_data
  drop constraint if exists spend_user_data_max_size;

alter table public.spend_user_data
  add constraint spend_user_data_max_size
  check (pg_column_size(data) <= 524288);

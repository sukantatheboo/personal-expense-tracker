-- Support custom card IDs and preserve settings.cards & custom card balances in cloud sync snapshots

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
set search_path = public
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
    updated_at = excluded.updated_at;

  for v_tx in select value from jsonb_array_elements(v_transactions)
  loop
    v_id := nullif(btrim(coalesce(v_tx->>'id', '')), '');
    v_type := coalesce(v_tx->>'type', '');
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
      deleted_at = null;
  end loop;

  update public.spend_account_transactions
  set
    deleted_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where user_id = new.user_id
    and deleted_at is null
    and not (id = any(v_seen_ids));

  return new;
end;
$$;

create or replace function public.load_spend_user_snapshot()
returns jsonb
language sql
security invoker
set search_path = public
as $$
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
  from raw_snapshot r
  left join account_settings s on true
  cross join account_transactions tx;
$$;

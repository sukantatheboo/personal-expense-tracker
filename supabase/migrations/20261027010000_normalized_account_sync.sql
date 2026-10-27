create function public.spend_try_date(p_value text)
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

create function public.spend_try_money(p_value text)
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

revoke all on function public.spend_try_date(text) from public, anon, authenticated;
revoke all on function public.spend_try_money(text) from public, anon, authenticated;

create table public.spend_account_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  start_date date not null,
  bkash_balance numeric(16, 2) not null default 0 check (bkash_balance >= 0),
  bank_balance numeric(16, 2) not null default 0 check (bank_balance >= 0),
  configured boolean not null default false,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table public.spend_account_transactions (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 120),
  type text not null check (type in ('income', 'adjustment', 'transfer')),
  amount numeric(16, 2) not null check (amount > 0),
  transaction_date date not null,
  description text not null default '' check (length(description) <= 80),
  account text,
  direction text,
  from_account text,
  to_account text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint spend_account_transactions_valid_shape check (
    (
      type = 'income'
      and account is not null
      and account in ('bkash', 'bank')
      and direction is null
      and from_account is null
      and to_account is null
    ) or (
      type = 'adjustment'
      and account is not null
      and account in ('bkash', 'bank')
      and direction is not null
      and direction in ('increase', 'decrease')
      and from_account is null
      and to_account is null
    ) or (
      type = 'transfer'
      and account is null
      and direction is null
      and from_account is not null
      and from_account in ('bkash', 'bank')
      and to_account is not null
      and to_account in ('bkash', 'bank')
      and from_account <> to_account
    )
  )
);

create index spend_account_transactions_user_date_idx
  on public.spend_account_transactions (user_id, transaction_date desc, created_at desc)
  where deleted_at is null;

create table public.spend_account_change_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  entity text not null check (entity in ('settings', 'transaction')),
  entity_id text not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  previous_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now()
);

create index spend_account_change_history_user_changed_idx
  on public.spend_account_change_history (user_id, changed_at desc);

alter table public.spend_account_settings enable row level security;
alter table public.spend_account_transactions enable row level security;
alter table public.spend_account_change_history enable row level security;

create policy "Users read their own account settings"
  on public.spend_account_settings
  for select to authenticated
  using (auth.uid() = user_id);

create policy "Users read their own account transactions"
  on public.spend_account_transactions
  for select to authenticated
  using (auth.uid() = user_id);

create policy "Users read their own account change history"
  on public.spend_account_change_history
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.spend_account_settings from anon, authenticated;
revoke all on public.spend_account_transactions from anon, authenticated;
revoke all on public.spend_account_change_history from anon, authenticated;
grant select on public.spend_account_settings to authenticated;
grant select on public.spend_account_transactions to authenticated;
grant select on public.spend_account_change_history to authenticated;

create function public.load_spend_user_snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'data', null,
      'updated_at', null,
      'normalizedAccountSync', true
    );
  end if;

  select jsonb_build_object(
    'data', d.data || jsonb_build_object(
      'accountData',
      case when s.user_id is null then d.data -> 'accountData'
      else jsonb_build_object(
        'settings', jsonb_build_object(
          'startDate', s.start_date,
          'balances', jsonb_build_object(
            'bkash', s.bkash_balance,
            'bank', s.bank_balance
          ),
          'configured', s.configured
        ),
        'transactions', coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', t.id,
              'type', t.type,
              'amount', t.amount,
              'date', t.transaction_date,
              'description', t.description,
              'account', t.account,
              'direction', t.direction,
              'fromAccount', t.from_account,
              'toAccount', t.to_account
            ) order by t.created_at, t.id
          ) filter (where t.id is not null),
          '[]'::jsonb
        )
      ) end
    ),
    'updated_at', d.updated_at,
    'normalizedAccountSync', true
  )
  into v_snapshot
  from public.spend_user_data d
  left join public.spend_account_settings s on s.user_id = d.user_id
  left join public.spend_account_transactions t
    on t.user_id = d.user_id and t.deleted_at is null
  where d.user_id = auth.uid()
  group by d.user_id, d.data, d.updated_at, s.user_id, s.start_date,
    s.bkash_balance, s.bank_balance, s.configured;

  if v_snapshot is null then
    return jsonb_build_object(
      'data', null,
      'updated_at', null,
      'normalizedAccountSync', true
    );
  end if;
  return v_snapshot;
end;
$$;

revoke all on function public.load_spend_user_snapshot() from public, anon;
grant execute on function public.load_spend_user_snapshot() to authenticated;

create function public.audit_spend_account_change()
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

create trigger audit_spend_account_settings
  after insert or update or delete on public.spend_account_settings
  for each row execute function public.audit_spend_account_change();

create trigger audit_spend_account_transactions
  after insert or update or delete on public.spend_account_transactions
  for each row execute function public.audit_spend_account_change();

create function public.sync_spend_accounts_from_snapshot()
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
  v_deleted jsonb;
  v_item jsonb;
  v_tombstone record;
  v_start_date date;
  v_bkash numeric;
  v_bank numeric;
  v_configured boolean;
  v_id text;
  v_type text;
  v_amount numeric;
  v_date date;
  v_description text;
  v_account text;
  v_direction text;
  v_from_account text;
  v_to_account text;
begin
  if new.data is null or jsonb_typeof(new.data) <> 'object' then
    raise exception 'Cloud data must be a JSON object' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE'
    and old.data -> 'accountData' is not distinct from new.data -> 'accountData' then
    return new;
  end if;

  v_account_data := new.data -> 'accountData';
  if v_account_data is null then
    return new;
  end if;
  if jsonb_typeof(v_account_data) <> 'object' then
    raise exception 'Account data must be a JSON object' using errcode = '22023';
  end if;

  v_settings := v_account_data -> 'settings';
  if v_settings is null or jsonb_typeof(v_settings) <> 'object' then
    raise exception 'Account settings are required' using errcode = '22023';
  end if;
  v_balances := v_settings -> 'balances';
  if v_balances is null or jsonb_typeof(v_balances) <> 'object' then
    raise exception 'Account balances must be an object' using errcode = '22023';
  end if;

  v_start_date := public.spend_try_date(v_settings ->> 'startDate');
  v_bkash := public.spend_try_money(coalesce(v_balances ->> 'bkash', '0'));
  v_bank := public.spend_try_money(coalesce(v_balances ->> 'bank', '0'));
  if v_start_date is null or v_bkash is null or v_bkash < 0 or v_bank is null or v_bank < 0 then
    raise exception 'Account settings contain an invalid date or balance' using errcode = '22023';
  end if;
  if v_settings ? 'configured' and jsonb_typeof(v_settings -> 'configured') <> 'boolean' then
    raise exception 'Account configured flag must be boolean' using errcode = '22023';
  end if;
  v_configured := coalesce((v_settings ->> 'configured')::boolean, false);

  insert into public.spend_account_settings (
    user_id, start_date, bkash_balance, bank_balance, configured
  ) values (
    new.user_id, v_start_date, v_bkash, v_bank, v_configured
  )
  on conflict (user_id) do update set
    start_date = excluded.start_date,
    bkash_balance = excluded.bkash_balance,
    bank_balance = excluded.bank_balance,
    configured = excluded.configured,
    version = public.spend_account_settings.version + 1,
    updated_at = now()
  where (
    public.spend_account_settings.start_date,
    public.spend_account_settings.bkash_balance,
    public.spend_account_settings.bank_balance,
    public.spend_account_settings.configured
  ) is distinct from (
    excluded.start_date,
    excluded.bkash_balance,
    excluded.bank_balance,
    excluded.configured
  );

  v_transactions := v_account_data -> 'transactions';
  if v_transactions is null then
    v_transactions := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_transactions) <> 'array' then
    raise exception 'Account transactions must be an array' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(v_transactions)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each account transaction must be an object' using errcode = '22023';
    end if;
    v_id := v_item ->> 'id';
    v_type := v_item ->> 'type';
    v_amount := public.spend_try_money(v_item ->> 'amount');
    v_date := public.spend_try_date(v_item ->> 'date');
    if v_id is null or length(v_id) not between 1 and 120
      or v_amount is null or v_amount <= 0 or v_date is null then
      raise exception 'Account transaction has an invalid id, amount, or date' using errcode = '22023';
    end if;
    if v_item ? 'description' and jsonb_typeof(v_item -> 'description') not in ('string', 'null') then
      raise exception 'Account transaction description must be text' using errcode = '22023';
    end if;
    v_description := coalesce(v_item ->> 'description', '');
    if length(v_description) > 80 then
      raise exception 'Account transaction description is too long' using errcode = '22023';
    end if;

    v_account := null;
    v_direction := null;
    v_from_account := null;
    v_to_account := null;
    if v_type = 'income' then
      v_account := v_item ->> 'account';
      if v_account not in ('bkash', 'bank') then
        raise exception 'Income must use a valid account' using errcode = '22023';
      end if;
    elsif v_type = 'adjustment' then
      v_account := v_item ->> 'account';
      v_direction := v_item ->> 'direction';
      if v_account not in ('bkash', 'bank') or v_direction not in ('increase', 'decrease') then
        raise exception 'Adjustment must include a valid account and direction' using errcode = '22023';
      end if;
    elsif v_type = 'transfer' then
      v_from_account := v_item ->> 'fromAccount';
      v_to_account := v_item ->> 'toAccount';
      if v_from_account not in ('bkash', 'bank') or v_to_account not in ('bkash', 'bank')
        or v_from_account = v_to_account then
        raise exception 'Transfer must use two different valid accounts' using errcode = '22023';
      end if;
    else
      raise exception 'Account transaction type is invalid' using errcode = '22023';
    end if;

    insert into public.spend_account_transactions (
      user_id, id, type, amount, transaction_date, description,
      account, direction, from_account, to_account, deleted_at
    ) values (
      new.user_id, v_id, v_type, v_amount, v_date, v_description,
      v_account, v_direction, v_from_account, v_to_account, null
    )
    on conflict (user_id, id) do update set
      type = excluded.type,
      amount = excluded.amount,
      transaction_date = excluded.transaction_date,
      description = excluded.description,
      account = excluded.account,
      direction = excluded.direction,
      from_account = excluded.from_account,
      to_account = excluded.to_account,
      deleted_at = null,
      updated_at = now()
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

  v_deleted := new.data #> '{deletedRecords,accountTransactions}';
  if jsonb_typeof(v_deleted) = 'object' then
    for v_tombstone in select key, value from jsonb_each(v_deleted)
    loop
      if length(v_tombstone.key) not between 1 and 120 then
        continue;
      end if;
      if v_tombstone.value ->> 'deleted' = 'true' then
        update public.spend_account_transactions
        set deleted_at = now(), updated_at = now()
        where user_id = new.user_id and id = v_tombstone.key and deleted_at is null;
      elsif v_tombstone.value ->> 'deleted' = 'false' then
        update public.spend_account_transactions
        set deleted_at = null, updated_at = now()
        where user_id = new.user_id and id = v_tombstone.key and deleted_at is not null;
      end if;
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_spend_accounts_from_snapshot() from public, anon, authenticated;

-- Keep the original accountData JSON during this rollout; normalized tables
-- are read by the new app while the snapshot copy preserves rollback compatibility.
create trigger sync_spend_accounts_from_snapshot
  before insert or update of data on public.spend_user_data
  for each row execute function public.sync_spend_accounts_from_snapshot();

-- Copy existing account data into normalized tables. Invalid legacy entries
-- are skipped rather than blocking migration.
insert into public.spend_account_settings (
  user_id, start_date, bkash_balance, bank_balance, configured
)
select
  d.user_id,
  coalesce(public.spend_try_date(d.data #>> '{accountData,settings,startDate}'), current_date),
  coalesce(public.spend_try_money(d.data #>> '{accountData,settings,balances,bkash}'), 0),
  coalesce(public.spend_try_money(d.data #>> '{accountData,settings,balances,bank}'), 0),
  coalesce(d.data #> '{accountData,settings,configured}' = 'true'::jsonb, false)
from public.spend_user_data d
on conflict (user_id) do nothing;

do $$
declare
  v_row record;
  v_item jsonb;
  v_type text;
  v_id text;
  v_amount numeric;
  v_date date;
  v_description text;
  v_account text;
  v_direction text;
  v_from_account text;
  v_to_account text;
begin
  for v_row in
    select d.user_id, d.data #> '{accountData,transactions}' as transactions
    from public.spend_user_data d
  loop
    if jsonb_typeof(v_row.transactions) <> 'array' then
      continue;
    end if;
    for v_item in select value from jsonb_array_elements(v_row.transactions)
    loop
      begin
        v_id := v_item ->> 'id';
        v_type := v_item ->> 'type';
        v_amount := public.spend_try_money(v_item ->> 'amount');
        v_date := public.spend_try_date(v_item ->> 'date');
        v_description := left(coalesce(v_item ->> 'description', ''), 80);
        v_account := null;
        v_direction := null;
        v_from_account := null;
        v_to_account := null;
        if v_id is null or length(v_id) not between 1 and 120
          or v_amount is null or v_amount <= 0 or v_date is null then
          continue;
        end if;
        if v_type = 'income' and v_item ->> 'account' in ('bkash', 'bank') then
          v_account := v_item ->> 'account';
        elsif v_type = 'adjustment'
          and v_item ->> 'account' in ('bkash', 'bank')
          and v_item ->> 'direction' in ('increase', 'decrease') then
          v_account := v_item ->> 'account';
          v_direction := v_item ->> 'direction';
        elsif v_type = 'transfer'
          and v_item ->> 'fromAccount' in ('bkash', 'bank')
          and v_item ->> 'toAccount' in ('bkash', 'bank')
          and v_item ->> 'fromAccount' <> v_item ->> 'toAccount' then
          v_from_account := v_item ->> 'fromAccount';
          v_to_account := v_item ->> 'toAccount';
        else
          continue;
        end if;
        insert into public.spend_account_transactions (
          user_id, id, type, amount, transaction_date, description,
          account, direction, from_account, to_account
        ) values (
          v_row.user_id, v_id, v_type, v_amount, v_date, v_description,
          v_account, v_direction, v_from_account, v_to_account
        ) on conflict (user_id, id) do nothing;
      exception when others then
        raise warning 'Skipped invalid legacy account transaction for user %', v_row.user_id;
      end;
    end loop;
  end loop;
end;
$$;

update public.spend_account_transactions t
set deleted_at = now(), updated_at = now()
from public.spend_user_data d
cross join lateral jsonb_each(
  case
    when jsonb_typeof(d.data #> '{deletedRecords,accountTransactions}') = 'object'
      then d.data #> '{deletedRecords,accountTransactions}'
    else '{}'::jsonb
  end
) as deleted_record(id, change)
where t.user_id = d.user_id
  and t.id = deleted_record.id
  and deleted_record.change ->> 'deleted' = 'true'
  and t.deleted_at is null;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'spend_user_data'
    ) then
      alter publication supabase_realtime add table public.spend_user_data;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'spend_account_settings'
    ) then
      alter publication supabase_realtime add table public.spend_account_settings;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'spend_account_transactions'
    ) then
      alter publication supabase_realtime add table public.spend_account_transactions;
    end if;
  end if;
end;
$$;

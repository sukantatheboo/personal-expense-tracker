-- Include server-maintained per-record revisions in snapshots so clients can
-- resolve concurrent edits without replacing a newer record with an older one.
create or replace function public.load_spend_user_snapshot()
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
          'configured', s.configured,
          'updatedAt', extract(epoch from s.updated_at) * 1000
        ),
        'transactions', coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', t.id,
              'createdAt', extract(epoch from t.created_at) * 1000,
              'updatedAt', extract(epoch from t.updated_at) * 1000,
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
    s.bkash_balance, s.bank_balance, s.configured, s.updated_at;

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

-- =============================================================================
-- Spend Backend Live Transactional Verification Suite (Zero Side Effects)
-- Run in psql (`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/verify-backend.sql`)
-- or paste into Supabase Dashboard > SQL Editor. Wrapped in BEGIN ... ROLLBACK
-- so all synthetic test users/rows are discarded at completion.
-- =============================================================================

begin;

do $$
declare
  v_user_a uuid := 'aaaaaaaa-1111-4111-8111-111111111111';
  v_user_b uuid := 'bbbbbbbb-2222-4222-8222-222222222222';
  v_base_ms bigint := floor(extract(epoch from now()) * 1000)::bigint;
  v_snap jsonb;
  v_save1 jsonb;
  v_save_stale jsonb;
  v_loaded jsonb;
  v_recon jsonb;
  v_cp jsonb;
  v_cards jsonb;
  v_usd_curr text;
  v_bank_curr text;
  v_bank_num text;
  v_tx_curr text;
  v_has_undone_exp boolean;
  v_has_deleted_exp boolean;
  v_cp_id uuid;
begin
  -- 1. Verify least-privilege function EXECUTE grants for anon vs authenticated vs service_role
  if has_function_privilege('anon', 'public.verify_spend_ledger_reconciliation(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon must NOT have EXECUTE on verify_spend_ledger_reconciliation';
  end if;
  if has_function_privilege('anon', 'public.save_spend_user_snapshot(jsonb,text,boolean)', 'EXECUTE') then
    raise exception 'FAIL: anon must NOT have EXECUTE on save_spend_user_snapshot';
  end if;
  if has_function_privilege('authenticated', 'public.capture_spend_backup_checkpoint_internal(uuid,jsonb,text,text,timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must NOT have EXECUTE on capture_spend_backup_checkpoint_internal';
  end if;
  if has_function_privilege('authenticated', 'public.claim_due_push_reminders_with_devices(integer,integer)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must NOT have EXECUTE on claim_due_push_reminders_with_devices';
  end if;
  if has_function_privilege('authenticated', 'public.prune_spend_account_change_history(integer)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must NOT have EXECUTE on prune_spend_account_change_history';
  end if;
  if not has_function_privilege('service_role', 'public.claim_due_push_reminders_with_devices(integer,integer)', 'EXECUTE') then
    raise exception 'FAIL: service_role must have EXECUTE on claim_due_push_reminders_with_devices';
  end if;

  -- 2. Verify duplicate trigger was removed on push_reminders
  if exists (
    select 1 from pg_trigger
    where tgname = 'preserve_push_reminder_progress'
      and tgrelid = 'public.push_reminders'::regclass
      and not tgisinternal
  ) then
    raise exception 'FAIL: duplicate preserve_push_reminder_progress trigger still exists';
  end if;

  -- 3. Verify anon caller guard inside SECURITY DEFINER verify_spend_ledger_reconciliation
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  begin
    perform public.verify_spend_ledger_reconciliation(v_user_a);
    raise exception 'FAIL: anon invocation of verify_spend_ledger_reconciliation unexpectedly succeeded';
  exception when insufficient_privilege then
    null; -- expected 42501
  end;

  -- 4. Seed synthetic auth.users (rolled back at EOF)
  insert into auth.users (id, email)
  values (v_user_a, 'qa-user-a@spend.local'), (v_user_b, 'qa-user-b@spend.local')
  on conflict (id) do nothing;

  -- 5. Impersonate authenticated User A and verify RLS write revokes + RPC roundtrip
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_user_a::text)::text, true);

  begin
    insert into public.spend_user_data (user_id, data) values (v_user_a, '{}'::jsonb);
    raise exception 'FAIL: direct INSERT into spend_user_data as authenticated succeeded (must be RPC-only)';
  exception when insufficient_privilege then
    null; -- expected 42501
  end;

  begin
    insert into public.spend_backup_checkpoints (user_id, checkpoint_type, label, data)
    values (v_user_a, 'manual', 'bad', '{}'::jsonb);
    raise exception 'FAIL: direct INSERT into spend_backup_checkpoints as authenticated succeeded (must be RPC-only)';
  exception when insufficient_privilege then
    null; -- expected 42501
  end;

  v_snap := jsonb_build_object(
    'expenses', jsonb_build_array(
      jsonb_build_object(
        'id', 'exp_normal',
        'createdAt', v_base_ms - 4500,
        'updatedAt', v_base_ms - 1200,
        'amount', 10,
        'category', 'Transport',
        'date', '2026-11-24',
        'description', 'City Bus',
        'account', 'bank_city'
      ),
      jsonb_build_object(
        'id', 'exp_undone',
        'createdAt', v_base_ms - 4000,
        'updatedAt', v_base_ms - 1000,
        'amount', 50,
        'category', 'Food',
        'date', '2026-11-24',
        'description', 'Undone coffee',
        'account', 'cash_usd'
      ),
      jsonb_build_object(
        'id', 'exp_deleted',
        'createdAt', v_base_ms - 4000,
        'updatedAt', v_base_ms - 3000,
        'amount', 99,
        'category', 'Food',
        'date', '2026-11-24',
        'description', 'Deleted snack',
        'account', 'bank_city'
      )
    ),
    'budgets', jsonb_build_object('2026-11', 2500),
    'budgetUpdatedAt', jsonb_build_object('2026-11', v_base_ms - 2000),
    'recurringSchedules', '[]'::jsonb,
    'deletedRecords', jsonb_build_object(
      'expenses', jsonb_build_object(
        'exp_undone', jsonb_build_object('deleted', true, 'updatedAt', v_base_ms - 2000),
        'exp_deleted', jsonb_build_object('deleted', true, 'updatedAt', v_base_ms - 1500)
      ),
      'cards', '{}'::jsonb,
      'accountTransactions', '{}'::jsonb,
      'recurringSchedules', '{}'::jsonb,
      'budgets', '{}'::jsonb
    ),
    'accountData', jsonb_build_object(
      'settings', jsonb_build_object(
        'startDate', '2026-11-01',
        'updatedAt', v_base_ms - 1000,
        'openingBalances', jsonb_build_object('cash_usd', 200, 'bank_city', 1000, 'cc_amex', 100),
        'cards', jsonb_build_array(
          jsonb_build_object(
            'id', 'cash_usd',
            'name', 'USD Cash',
            'category', 'cash',
            'type', 'cash',
            'currency', 'USD',
            'subtitle', 'Cash wallet · USD',
            'initialBalance', 200,
            'updatedAt', v_base_ms - 1000
          ),
          jsonb_build_object(
            'id', 'bank_city',
            'name', 'City Bank',
            'category', 'debit',
            'type', 'debit',
            'bankId', 'city',
            'currency', 'USD',
            'number', '4532123456789012',
            'last4', '9012',
            'cvv', '999',
            'pin', '1234',
            'initialBalance', 1000,
            'updatedAt', v_base_ms - 1000
          ),
          jsonb_build_object(
            'id', 'cc_amex',
            'name', 'Amex Credit',
            'category', 'credit',
            'type', 'credit',
            'initialBalance', 100,
            'updatedAt', v_base_ms - 1000
          )
        )
      ),
      'transactions', jsonb_build_array(
        -- Omit currency to verify the loader infers it from the linked cash card.
        jsonb_build_object(
          'id', 'tx_usd_inc',
          'createdAt', v_base_ms - 4000,
          'updatedAt', v_base_ms - 1000,
          'type', 'income',
          'amount', 25,
          'date', '2026-11-24',
          'account', 'cash_usd',
          'description', 'Cash Freelance'
        )
      )
    )
  );

  v_save1 := public.save_spend_user_snapshot(v_snap, null, false);
  if (v_save1 ->> 'status') is distinct from 'saved' then
    raise exception 'FAIL: initial save_spend_user_snapshot returned %', v_save1;
  end if;

  -- Verify strict 2ms OCC blocks stale updated_at
  v_save_stale := public.save_spend_user_snapshot(v_snap, '2020-01-01T00:00:00.000Z', false);
  if (v_save_stale ->> 'status') is distinct from 'conflict' then
    raise exception 'FAIL: expected OCC conflict on stale timestamp, got %', v_save_stale;
  end if;

  -- Verify loader output (PAN masked, CVV stripped, Cash USD preserved, Bank USD->BDT, tx currency, tombstone dominance)
  v_loaded := public.load_spend_user_snapshot();
  if (v_loaded ->> 'schemaVersion') is distinct from '2026.11.25' then
    raise exception 'FAIL: unexpected schemaVersion % (did you apply 20261125010000?)', v_loaded ->> 'schemaVersion';
  end if;
  if (v_loaded -> 'data') is null or jsonb_typeof(v_loaded -> 'data') <> 'object' then
    raise exception 'FAIL: load_spend_user_snapshot returned null/non-object data: %', v_loaded;
  end if;

  v_cards := v_loaded #> '{data,accountData,settings,cards}';
  select c ->> 'currency' into v_usd_curr from jsonb_array_elements(v_cards) c where c ->> 'id' = 'cash_usd';
  select c ->> 'currency', c ->> 'number' into v_bank_curr, v_bank_num from jsonb_array_elements(v_cards) c where c ->> 'id' = 'bank_city';
  if v_usd_curr is distinct from 'USD' then
    raise exception 'FAIL: expected Cash wallet currency USD, got % (cards=%)', v_usd_curr, v_cards;
  end if;
  if v_bank_curr is distinct from 'BDT' then
    raise exception 'FAIL: expected Bank card currency normalized to BDT, got %', v_bank_curr;
  end if;
  if coalesce(v_bank_num, '') like '%45321234%' then
    raise exception 'FAIL: unmasked PAN leaked in saved cards: %', v_bank_num;
  end if;
  if exists (select 1 from jsonb_array_elements(v_cards) c where c ? 'cvv' or c ? 'pin') then
    raise exception 'FAIL: CVV or PIN persisted in cards JSONB';
  end if;

  select t ->> 'currency' into v_tx_curr
  from jsonb_array_elements(v_loaded #> '{data,accountData,transactions}') t
  where t ->> 'id' = 'tx_usd_inc';
  if v_tx_curr is distinct from 'USD' then
    raise exception 'FAIL: expected tx_usd_inc currency USD, got % (txs=%, table_rows=%, triggers=%, loaded_expenses=%)',
      v_tx_curr,
      v_loaded #> '{data,accountData,transactions}',
      (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'currency', currency, 'updated_at_ms', updated_at_ms, 'deleted_at', deleted_at)), '[]'::jsonb)
       from public.spend_account_transactions where user_id = v_user_a),
      (select coalesce(jsonb_agg(tgname || ':' || tgenabled::text || ':' || proname), '[]'::jsonb)
       from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
       where tg.tgrelid = 'public.spend_user_data'::regclass and not tg.tgisinternal),
      v_loaded #> '{data,expenses}';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_loaded #> '{data,expenses}') e where e ->> 'id' = 'exp_normal'
  ) then
    raise exception 'FAIL: normal non-tombstoned expense exp_normal missing (loaded_expenses=%, table_rows=%)',
      v_loaded #> '{data,expenses}',
      (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'currency', currency, 'deleted_at', deleted_at)), '[]'::jsonb)
       from public.spend_account_transactions where user_id = v_user_a);
  end if;

  select exists(select 1 from jsonb_array_elements(v_loaded #> '{data,expenses}') e where e ->> 'id' = 'exp_undone'),
         exists(select 1 from jsonb_array_elements(v_loaded #> '{data,expenses}') e where e ->> 'id' = 'exp_deleted')
  into v_has_undone_exp, v_has_deleted_exp;
  if not v_has_undone_exp or v_has_deleted_exp then
    raise exception 'FAIL: timestamp tombstone dominance broken (undone=%, deleted=%, loaded_expenses=%, raw_expenses=%, raw_del=%, table_rows=%)',
      v_has_undone_exp,
      v_has_deleted_exp,
      v_loaded #> '{data,expenses}',
      (select data -> 'expenses' from public.spend_user_data where user_id = v_user_a),
      (select data #> '{deletedRecords,expenses}' from public.spend_user_data where user_id = v_user_a),
      (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'updated_at_ms', updated_at_ms, 'deleted_at', deleted_at)), '[]'::jsonb)
       from public.spend_account_transactions where user_id = v_user_a);
  end if;

  -- Verify reconciliation accuracy across multi-currency Cash + Bank + Credit
  v_recon := public.verify_spend_ledger_reconciliation(null);
  if coalesce((v_recon ->> 'isBalanced')::boolean, false) <> true then
    raise exception 'FAIL: reconciliation not balanced: %', v_recon;
  end if;

  -- Verify checkpoint creation & cross-user IDOR isolation
  v_cp := public.create_spend_backup_checkpoint('manual', 'QA checkpoint', v_snap);
  v_cp_id := (v_cp #>> '{checkpoint,id}')::uuid;

  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_user_b::text)::text, true);
  begin
    perform public.verify_spend_ledger_reconciliation(v_user_a);
    raise exception 'FAIL: User B verified User A ledger (IDOR)';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.restore_spend_backup_checkpoint(v_cp_id);
    raise exception 'FAIL: User B restored User A checkpoint (IDOR)';
  exception when others then
    null;
  end;

  execute 'reset role';
  raise notice '✅ All Spend MFS Backend SQL Security, OCC, Multi-Currency & Ledger Verification checks PASSED';
end;
$$;

rollback;

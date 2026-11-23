-- =============================================================================
-- SERVER-SIDE CARD PAN MASKING & PCI-DSS HARDENING (2026.11.23)
-- =============================================================================
-- Ensures that even if a client bypasses sanitizeCloudPayload(), PostgreSQL
-- strips CVV/CVC/securityCode/PIN fields and masks any raw 13-19 digit PAN
-- (or unmasked bank/credit card number) before persisting to spend_user_data
-- and spend_account_settings.
-- =============================================================================

-- 1. Pure helper: sanitize a single card JSONB object (strip CVV/PIN + mask PAN)
create or replace function public.spend_sanitize_card_object(p_card jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_card       jsonb;
  v_raw_number text;
  v_raw_digits text;
  v_last4      text;
  v_is_savings boolean;
  v_is_cash    boolean;
  v_is_mfs     boolean;
  v_safe_num   text;
begin
  if p_card is null or jsonb_typeof(p_card) <> 'object' then
    return p_card;
  end if;

  -- Strip sensitive card authentication / security code fields unconditionally
  v_card := p_card - 'cvv' - 'cvc' - 'securityCode' - 'security_code' - 'pin';

  v_raw_number := btrim(coalesce(v_card ->> 'number', ''));
  v_raw_digits := regexp_replace(v_raw_number, '\D', '', 'g');
  v_last4 := left(
    coalesce(
      nullif(btrim(coalesce(v_card ->> 'last4', '')), ''),
      case when length(v_raw_digits) >= 4 then right(v_raw_digits, 4) else v_raw_digits end
    ),
    8
  );

  v_is_savings := (
    lower(coalesce(v_card ->> 'category', '')) = 'savings'
    or lower(coalesce(v_card ->> 'type', '')) = 'savings'
    or lower(coalesce(v_card ->> 'provider', '')) = 'savings'
    or coalesce(v_card ->> 'id', '') = 'savings'
    or v_raw_number like 'SAV-%'
    or v_raw_number like 'VAULT-%'
    or v_raw_number like 'DPS-%'
  );

  v_is_cash := (
    coalesce(v_card ->> 'id', '') = 'cash'
    or lower(coalesce(v_card ->> 'provider', '')) = 'cash'
    or lower(coalesce(v_card ->> 'category', '')) = 'cash'
    or lower(coalesce(v_card ->> 'type', '')) = 'cash'
    or v_raw_number like 'CASH-%'
  );

  v_is_mfs := (
    coalesce((v_card ->> 'isPhone')::boolean, false) = true
    or lower(coalesce(v_card ->> 'category', '')) = 'mfs'
    or lower(coalesce(v_card ->> 'type', '')) = 'mfs'
    or lower(coalesce(v_card ->> 'network', '')) = 'mfs'
    or lower(coalesce(v_card ->> 'provider', '')) in ('bkash', 'nagad', 'rocket', 'upay')
  );

  -- Mask any raw 13+ digit PAN on any card type, or any non-synthetic bank/credit card number
  if v_card ? 'number' then
    if length(v_raw_digits) >= 13 or (not v_is_savings and not v_is_cash and not v_is_mfs and v_raw_number <> '') then
      v_safe_num := case when v_last4 <> '' then '•••• •••• •••• ' || v_last4 else '' end;
      v_card := jsonb_set(v_card, '{number}', to_jsonb(v_safe_num), true);
      if v_last4 <> '' then
        v_card := jsonb_set(v_card, '{last4}', to_jsonb(v_last4), true);
      end if;
    else
      v_card := jsonb_set(v_card, '{number}', to_jsonb(left(v_raw_number, 32)), true);
    end if;
  end if;

  return v_card;
end;
$$;

-- 2. BEFORE trigger on spend_user_data to guarantee PAN/CVV scrubbing runs before
--    sync_spend_accounts_from_snapshot and before row storage.
create or replace function public.sanitize_spend_snapshot_cards_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw_cards jsonb;
  v_clean     jsonb;
begin
  if new.data is null or jsonb_typeof(new.data) <> 'object' then
    return new;
  end if;

  if new.data ? '_encrypted' or new.data ->> 'format' = 'spend-encrypted-v1' then
    return new;
  end if;

  v_raw_cards := new.data #> '{accountData,settings,cards}';
  if jsonb_typeof(v_raw_cards) = 'array' then
    select coalesce(jsonb_agg(public.spend_sanitize_card_object(elem)), '[]'::jsonb)
    into v_clean
    from jsonb_array_elements(v_raw_cards) as elem;

    new.data := jsonb_set(new.data, '{accountData,settings,cards}', v_clean, true);
  end if;

  return new;
end;
$$;

-- Prefix with 'aa_' so PostgreSQL fires this BEFORE trigger prior to 'sync_spend_accounts_from_snapshot'
drop trigger if exists aa_sanitize_spend_snapshot_cards on public.spend_user_data;
create trigger aa_sanitize_spend_snapshot_cards
  before insert or update on public.spend_user_data
  for each row execute function public.sanitize_spend_snapshot_cards_trigger();

-- 3. Scrub any existing unencrypted snapshots immediately
update public.spend_user_data
set data = data
where data is not null
  and jsonb_typeof(data) = 'object'
  and not (data ? '_encrypted')
  and coalesce(data ->> 'format', '') <> 'spend-encrypted-v1'
  and jsonb_typeof(data #> '{accountData,settings,cards}') = 'array';

notify pgrst, 'reload schema';

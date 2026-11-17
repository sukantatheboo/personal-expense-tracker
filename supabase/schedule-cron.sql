-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- 1. Ensure the push_reminders trigger allows atomic claims and schedule updates cleanly
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

  -- Case 2: Claim lease acquisition or renewal (claim_until explicitly changed, schedule unchanged)
  if new.claim_until is not null
     and new.claim_until is distinct from old.claim_until
     and new.next_date = old.next_date
     and new.reminder_time is not distinct from old.reminder_time
     and new.timezone is not distinct from old.timezone then
    new.next_notify_at := old.next_notify_at;
    new.updated_at := timezone('utc', now());
    return new;
  end if;

  -- Case 3: Releasing an expired/failed claim without advancing next_date
  if old.claim_until is not null
     and new.claim_until is null
     and new.next_date = old.next_date
     and new.reminder_time is not distinct from old.reminder_time
     and new.timezone is not distinct from old.timezone then
    new.next_notify_at := old.next_notify_at;
    new.pending_notification := false;
    new.updated_at := timezone('utc', now());
    return new;
  end if;

  -- Case 4: General schedule or reminder_time edits (clear any stale claim lease)
  new.claim_until := null;
  begin
    new.next_notify_at := (new.next_date + new.reminder_time::time) at time zone v_tz;
  exception when others then
    new.next_notify_at := (new.next_date + new.reminder_time::time) at time zone 'UTC';
  end;

  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists preserve_push_reminder_progress_trigger on public.push_reminders;
create trigger preserve_push_reminder_progress_trigger
  before insert or update on public.push_reminders
  for each row execute function public.preserve_push_reminder_progress();

-- 2. Unschedule old cron jobs
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'spend-send-due-reminders') then
    perform cron.unschedule('spend-send-due-reminders');
  end if;
  if exists (select 1 from cron.job where jobname = 'send-due-reminders') then
    perform cron.unschedule('send-due-reminders');
  end if;
end $$;

-- 3. Ensure project_url in Vault points to your real Supabase URL (not '<your-project-ref>')
delete from vault.secrets where name = 'project_url';
select vault.create_secret('https://eipexdfsblfyegycbigd.supabase.co', 'project_url');

-- Safely update cron_secret in Vault only when a real secret is provided (never overwrite with placeholder)
do $$
declare
  v_new_secret text := 'PASTE_YOUR_CRON_SECRET_HERE';
begin
  if v_new_secret is not null
     and btrim(v_new_secret) <> ''
     and v_new_secret not in (
       'PASTE_YOUR_CRON_SECRET_HERE',
       'YOUR_ACTUAL_CRON_SECRET_HERE',
       '<your-cron-secret>'
     ) then
    delete from vault.secrets where name = 'cron_secret';
    perform vault.create_secret(v_new_secret, 'cron_secret');
  end if;
end $$;

-- 4. Schedule send-due-reminders to run every 1 minute
-- IMPORTANT: In Supabase Dashboard > Edge Functions > send-due-reminders > Details/Settings,
-- make sure "Verify JWT with legacy secret" / "Enforce JWT Verification" is turned OFF.
select cron.schedule(
  'send-due-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := coalesce(
      nullif((select decrypted_secret from vault.decrypted_secrets where name = 'project_url' and decrypted_secret not like '%<your-project-ref>%' order by created_at desc limit 1), ''),
      'https://eipexdfsblfyegycbigd.supabase.co'
    ) || '/functions/v1/send-due-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(
        (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'cron_secret'
            and decrypted_secret not in ('<your-cron-secret>', 'PASTE_YOUR_CRON_SECRET_HERE', 'YOUR_ACTUAL_CRON_SECRET_HERE', '')
          order by created_at desc
          limit 1
        ),
        (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'spend_cron_secret'
            and decrypted_secret not in ('<your-cron-secret>', 'PASTE_YOUR_CRON_SECRET_HERE', 'YOUR_ACTUAL_CRON_SECRET_HERE', '')
          order by created_at desc
          limit 1
        ),
        ''
      )
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

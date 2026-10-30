-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- 1. Unschedule the old 1-minute job that was returning 401
do $$
begin
  if exists (select 1 from cron.job where jobname = 'spend-send-due-reminders') then
    perform cron.unschedule('spend-send-due-reminders');
  end if;
  if exists (select 1 from cron.job where jobname = 'send-due-reminders') then
    perform cron.unschedule('send-due-reminders');
  end if;
end $$;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Save Vault secrets
select vault.create_secret('https://eipexdfsblfyegycbigd.supabase.co', 'project_url');
select vault.create_secret('f7d31ee2709925a1c089abe0605ec1b2d66e38f1e5bdd5380afff5a170aa8069', 'cron_secret');

-- 3. Schedule the edge function to run every 5 minutes with authorization
select cron.schedule(
  'send-due-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' order by created_at desc limit 1)
           || '/functions/v1/send-due-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_82E3mCuzEZKHF6ULrOSj8w_bXPh9epE',
      'Authorization', 'Bearer sb_publishable_82E3mCuzEZKHF6ULrOSj8w_bXPh9epE',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' order by created_at desc limit 1)
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

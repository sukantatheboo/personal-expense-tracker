-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- It enables pg_cron and pg_net, creates Vault secrets, and schedules send-due-reminders every 5 minutes.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. Create or update the Vault secrets
-- Replace 'YOUR_CRON_SECRET_HERE' with the value you set via `supabase secrets set CRON_SECRET=...`
select vault.create_secret('https://eipexdfsblfyegycbigd.supabase.co', 'project_url');
select vault.create_secret('YOUR_CRON_SECRET_HERE', 'cron_secret');

-- 2. Schedule the edge function to run every 5 minutes
select cron.schedule(
  'send-due-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-due-reminders',
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

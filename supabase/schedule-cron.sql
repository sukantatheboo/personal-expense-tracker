-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- 1. Unschedule old jobs
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

-- 2. Clear old secrets to prevent duplicate key error, then create fresh
delete from vault.secrets where name in ('project_url', 'cron_secret');

select vault.create_secret('https://<your-project-ref>.supabase.co', 'project_url');
select vault.create_secret('<your-cron-secret>', 'cron_secret');

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
      'apikey', '<your-anon-key>',
      'Authorization', 'Bearer <your-anon-key>',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' order by created_at desc limit 1)
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

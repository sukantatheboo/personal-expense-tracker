-- Run the push worker every 5 minutes. The job stays idle until its Vault
-- values have been configured, supporting either 'project_url' / 'cron_secret'
-- or 'spend_supabase_url' / 'spend_cron_secret'.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $migration$
begin
  -- Unschedule previous name if it exists to avoid duplicate jobs
  if exists (select 1 from cron.job where jobname = 'spend-send-due-reminders') then
    perform cron.unschedule('spend-send-due-reminders');
  end if;

  if not exists (select 1 from cron.job where jobname = 'send-due-reminders') then
    perform cron.schedule(
      'send-due-reminders',
      '*/5 * * * *',
      $job$
        select case
          when secrets.project_url is not null
            and secrets.cron_secret is not null
          then net.http_post(
            url := rtrim(secrets.project_url, '/') || '/functions/v1/send-due-reminders',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', secrets.cron_secret
            ),
            body := '{}'::jsonb
          )
          else null::bigint
        end as request_id
        from (
          select
            coalesce(
              (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' order by created_at desc limit 1),
              (select decrypted_secret from vault.decrypted_secrets where name = 'spend_supabase_url' order by created_at desc limit 1)
            ) as project_url,
            coalesce(
              (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' order by created_at desc limit 1),
              (select decrypted_secret from vault.decrypted_secrets where name = 'spend_cron_secret' order by created_at desc limit 1)
            ) as cron_secret
        ) as secrets;
      $job$
    );
  end if;
end
$migration$;

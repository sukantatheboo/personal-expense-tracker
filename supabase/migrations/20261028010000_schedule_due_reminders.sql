-- Run the push worker every minute. The job stays idle until its Vault
-- values have been configured, so migrations can be applied before secrets.
do $migration$
begin
  if not exists (
    select 1 from cron.job where jobname = 'spend-send-due-reminders'
  ) then
    perform cron.schedule(
      'spend-send-due-reminders',
      '* * * * *',
      $job$
        select case
          when secrets.project_url is not null
            and secrets.anon_key is not null
            and secrets.cron_secret is not null
          then net.http_post(
            url := rtrim(secrets.project_url, '/') || '/functions/v1/send-due-reminders',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'apikey', secrets.anon_key,
              'x-cron-secret', secrets.cron_secret
            ),
            body := '{}'::jsonb
          )
          else null::bigint
        end as request_id
        from (
          select
            (select decrypted_secret
             from vault.decrypted_secrets
             where name = 'spend_supabase_url'
             order by created_at desc limit 1) as project_url,
            (select decrypted_secret
             from vault.decrypted_secrets
             where name = 'spend_anon_key'
             order by created_at desc limit 1) as anon_key,
            (select decrypted_secret
             from vault.decrypted_secrets
             where name = 'spend_cron_secret'
             order by created_at desc limit 1) as cron_secret
        ) as secrets;
      $job$
    );
  end if;
end
$migration$;

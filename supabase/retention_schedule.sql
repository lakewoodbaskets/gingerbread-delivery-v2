-- REVIEW/ACTIVATION TEMPLATE ONLY. Do not run before preview + backup approval.
-- Installing the migration does not install this job. The statements below
-- deliberately leave it inactive even if this file is run by mistake.
-- Enable pg_cron and pg_net in Supabase Dashboard > Database > Extensions.
-- Store a high-entropy RETENTION_JOB_SECRET in Edge Function secrets AND Vault
-- under retention_job_secret. Store the project URL in Vault as project_url.
-- Never put service keys or the job secret in VITE_* variables or Git.

begin;
do $$ begin
  if not exists (select 1 from public.delivery_retention_control where id and enabled and backup_verified_at is not null) then
    raise exception 'Preview and verified backup approval are required before scheduling';
  end if;
end $$;

select cron.schedule('gingerbread-delivery-retention', '17 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/delivery-retention',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-retention-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'retention_job_secret')),
    body := '{"action":"run"}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
select cron.alter_job((select jobid from cron.job where jobname = 'gingerbread-delivery-retention'), active := false);
commit;

-- ONLY after explicit production approval, enable the job separately:
-- select cron.alter_job((select jobid from cron.job where jobname = 'gingerbread-delivery-retention'), active := true);
-- Emergency stop: update public.delivery_retention_control set enabled = false where id;

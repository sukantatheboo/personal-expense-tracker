-- Firefox uses Mozilla-hosted Web Push endpoints. Keep the allowlist aligned
-- with the sender's host validation so valid subscriptions can be saved.
alter table public.push_devices
  drop constraint if exists push_devices_endpoint_check;

alter table public.push_devices
  add constraint push_devices_endpoint_check check (
    endpoint ~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com)/'
  );

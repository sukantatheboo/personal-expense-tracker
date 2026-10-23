create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table public.push_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null,
  endpoint text not null check (
    endpoint ~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com)/'
  ),
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  check (subscription ->> 'endpoint' = endpoint),
  check (
    subscription -> 'keys' ->> 'p256dh' is not null
    and subscription -> 'keys' ->> 'auth' is not null
  ),
  primary key (user_id, device_id)
);

alter table public.push_devices enable row level security;

create policy "Users manage their own push devices"
  on public.push_devices
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.push_reminders (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null,
  schedule_id text not null,
  description text not null check (char_length(description) <= 80),
  interval text not null check (interval in ('weekly', 'monthly')),
  day_of_month integer not null check (day_of_month between 1 and 31),
  next_date date not null,
  next_notify_at timestamptz not null,
  timezone text not null,
  active boolean not null default true,
  pending_notification boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id, schedule_id)
);

create index push_reminders_due_idx
  on public.push_reminders (next_notify_at)
  where active;

alter table public.push_reminders enable row level security;

create policy "Users manage their own push reminders"
  on public.push_reminders
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create function public.preserve_push_reminder_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.next_notify_at < old.next_notify_at then
    new.next_notify_at := old.next_notify_at;
    new.next_date := old.next_date;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger preserve_push_reminder_progress
  before update on public.push_reminders
  for each row
  execute function public.preserve_push_reminder_progress();

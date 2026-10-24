alter table public.push_reminders
  add column claim_until timestamptz;

create or replace function public.preserve_push_reminder_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.next_notify_at :=
      (new.next_date + new.reminder_time::time) at time zone new.timezone;
    new.updated_at := now();
    return new;
  end if;

  if new.claim_until is not null
     and new.claim_until > coalesce(old.claim_until, '-infinity'::timestamptz)
     and new.next_notify_at = new.claim_until then
    new.next_date := old.next_date;
    new.pending_notification := true;
  elsif old.pending_notification and new.next_date <= old.next_date then
    new.next_notify_at := old.next_notify_at;
    new.next_date := old.next_date;
    new.pending_notification := true;
  elsif new.pending_notification then
    if old.pending_notification then
      new.next_date := old.next_date;
      if new.next_notify_at <= old.next_notify_at then
        new.next_notify_at := old.next_notify_at;
      end if;
    end if;
  else
    if new.next_date < old.next_date then
      new.next_date := old.next_date;
    end if;
    new.next_notify_at :=
      (new.next_date + new.reminder_time::time) at time zone new.timezone;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

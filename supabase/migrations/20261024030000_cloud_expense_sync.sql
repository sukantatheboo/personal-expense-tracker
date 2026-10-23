create table public.spend_user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.spend_user_data enable row level security;

create policy "Users manage their own Spend cloud data"
  on public.spend_user_data
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create function public.update_spend_user_data_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger update_spend_user_data_timestamp
  before update on public.spend_user_data
  for each row
  execute function public.update_spend_user_data_timestamp();

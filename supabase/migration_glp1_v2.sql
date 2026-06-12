-- GLP-1 v2 migration: sleep_logs, mood_logs, treatment_start on profiles

alter table public.profiles
  add column if not exists treatment_start_date date,
  add column if not exists treatment_duration_months integer default 12,
  add column if not exists baseline_weight_kg numeric;

create table if not exists public.sleep_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  logged_at  timestamptz not null default now(),
  hours      numeric not null,
  quality    integer check (quality between 1 and 5),
  notes      text,
  created_at timestamptz default now()
);

create table if not exists public.mood_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  logged_at  timestamptz not null default now(),
  score      integer not null check (score between 1 and 5),
  notes      text,
  created_at timestamptz default now()
);

alter table public.sleep_logs enable row level security;
alter table public.mood_logs  enable row level security;

drop policy if exists "own_rows" on public.sleep_logs;
drop policy if exists "own_rows" on public.mood_logs;

create policy "own_rows" on public.sleep_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_rows" on public.mood_logs  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_sleep_user_time on public.sleep_logs (user_id, logged_at);
create index if not exists idx_mood_user_time  on public.mood_logs  (user_id, logged_at);

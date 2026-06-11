-- ============================================================
--  GLP-1 Health Tracker — database schema
--  Run this once in your Supabase project (SQL Editor → paste → Run).
--  Every table is private to its owner via Row-Level Security:
--  a logged-in user can only ever see and change their own rows.
-- ============================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  full_name          text,
  height_cm          numeric,
  dob                date,
  sex                text,
  baseline_weight_kg numeric,
  timezone           text default 'Asia/Kolkata',
  glp1_drug          text,
  created_at         timestamptz default now()
);

-- ---------- weight ----------
create table if not exists public.weight_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  logged_at  timestamptz not null default now(),
  weight_kg  numeric not null,
  source     text not null default 'manual',
  created_at timestamptz default now()
);

-- ---------- injections ----------
create table if not exists public.injections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  injected_at timestamptz not null default now(),
  drug        text,
  dose_mg     numeric,
  site        text,
  lot         text,
  notes       text,
  created_at  timestamptz default now()
);

-- ---------- meals ----------
create table if not exists public.meals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  eaten_at    timestamptz not null default now(),
  meal_type   text not null default 'meal',   -- breakfast / lunch / dinner / snack
  description text,
  calories    numeric,
  protein_g   numeric,
  notes       text,
  created_at  timestamptz default now()
);

-- ---------- water ----------
create table if not exists public.water_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  logged_at  timestamptz not null default now(),
  amount_ml  numeric not null,
  created_at timestamptz default now()
);

-- ---------- activities ----------
create table if not exists public.activities (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  started_at   timestamptz not null default now(),
  type         text not null default 'walk',  -- walk / cycle / strength / other
  duration_min numeric,
  distance_km  numeric,
  energy_kcal  numeric,
  steps        integer,
  source       text not null default 'manual',
  created_at   timestamptz default now()
);

-- ---------- medications + taken log ----------
create table if not exists public.medications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  dose       text,
  schedule   text,
  active     boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists public.medication_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  medication_id uuid references public.medications (id) on delete set null,
  taken_at      timestamptz not null default now(),
  created_at    timestamptz default now()
);

-- ---------- symptoms / side effects ----------
create table if not exists public.symptoms (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  type        text not null,                 -- nausea / fatigue / GI / headache / other
  severity    integer,                       -- 1..5
  notes       text,
  created_at  timestamptz default now()
);

-- ---------- appointments (the weekly Tuesday) ----------
create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  appointment_date date not null,
  clinician        text,
  notes            text,
  dose_change      text,
  created_at       timestamptz default now()
);

-- ============================================================
--  Row-Level Security: lock every table to its owner
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','weight_logs','injections','meals','water_logs',
    'activities','medications','medication_logs','symptoms','appointments'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);

    -- profiles keys on id; all others key on user_id.
    -- Each EXECUTE runs ONE statement, so drop and create are separate.
    if t = 'profiles' then
      execute format('drop policy if exists "own_profile" on public.%I;', t);
      execute format('create policy "own_profile" on public.%I for all using (auth.uid() = id) with check (auth.uid() = id);', t);
    else
      execute format('drop policy if exists "own_rows" on public.%I;', t);
      execute format('create policy "own_rows" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);', t);
    end if;
  end loop;
end $$;

-- Helpful indexes for the weekly report queries
create index if not exists idx_weight_user_time   on public.weight_logs (user_id, logged_at);
create index if not exists idx_inject_user_time    on public.injections (user_id, injected_at);
create index if not exists idx_meals_user_time     on public.meals (user_id, eaten_at);
create index if not exists idx_water_user_time     on public.water_logs (user_id, logged_at);
create index if not exists idx_act_user_time       on public.activities (user_id, started_at);
create index if not exists idx_medlog_user_time    on public.medication_logs (user_id, taken_at);
create index if not exists idx_symp_user_time      on public.symptoms (user_id, occurred_at);
create index if not exists idx_appt_user_date      on public.appointments (user_id, appointment_date);

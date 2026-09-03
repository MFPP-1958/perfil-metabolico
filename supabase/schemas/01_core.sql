create extension if not exists pgcrypto with schema extensions;

create table public.coach_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.athletes (
  id uuid primary key default extensions.gen_random_uuid(),
  created_by uuid not null references public.coach_profiles(id),
  intervals_athlete_id text unique check (intervals_athlete_id ~ '^i[0-9]+$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  date_of_birth date,
  sex text check (sex is null or sex in ('female', 'male', 'intersex', 'undisclosed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.coach_athletes (
  coach_id uuid not null references public.coach_profiles(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  role text not null default 'coach' check (role in ('coach', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (coach_id, athlete_id)
);

create index coach_athletes_athlete_idx on public.coach_athletes (athlete_id, coach_id);

create table public.test_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_by uuid not null references public.coach_profiles(id),
  protocol_code text not null,
  protocol_version text not null,
  performed_at timestamptz not null,
  status text not null check (status in ('draft', 'complete', 'invalid')),
  invalid_reason text,
  created_at timestamptz not null default now()
);

create index test_sessions_athlete_performed_idx on public.test_sessions (athlete_id, performed_at desc);

create table public.observations (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  test_session_id uuid references public.test_sessions(id) on delete restrict,
  created_by uuid not null references public.coach_profiles(id),
  metric_code text not null,
  value numeric not null check (value >= 0),
  unit text not null,
  observed_at timestamptz not null,
  origin text not null check (origin in ('manual', 'intervals_icu', 'laboratory', 'field_test', 'device', 'calculated')),
  quality text not null check (quality in ('measured', 'imported_estimate', 'calculated', 'incomplete', 'rejected')),
  protocol_name text not null,
  protocol_version text not null,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);

create index observations_athlete_observed_idx on public.observations (athlete_id, observed_at desc, metric_code);
create index observations_session_idx on public.observations (test_session_id) where test_session_id is not null;

create table public.derived_results (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  test_session_id uuid references public.test_sessions(id) on delete restrict,
  created_by uuid not null references public.coach_profiles(id),
  metric_code text not null,
  value numeric,
  unit text not null,
  quality text not null check (quality in ('calculated', 'incomplete', 'rejected')),
  algorithm_name text not null,
  algorithm_version text not null,
  input_observation_ids uuid[] not null default '{}',
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  calculated_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.coach_profiles(id)
);

create index derived_results_athlete_calculated_idx on public.derived_results (athlete_id, calculated_at desc, metric_code);
create index derived_results_session_idx on public.derived_results (test_session_id) where test_session_id is not null;

create table public.activities (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  intervals_activity_id text not null,
  sport text not null,
  started_at timestamptz not null,
  indoor boolean,
  duration_seconds integer not null check (duration_seconds >= 0),
  normalized_data jsonb not null default '{}'::jsonb check (jsonb_typeof(normalized_data) = 'object'),
  source_updated_at timestamptz,
  synchronized_at timestamptz not null default now(),
  unique (athlete_id, intervals_activity_id)
);

create index activities_athlete_start_idx on public.activities (athlete_id, started_at desc);

create table public.planned_workouts (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  intervals_event_id text not null,
  scheduled_at timestamptz not null,
  structured_blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(structured_blocks) = 'array'),
  source_updated_at timestamptz,
  synchronized_at timestamptz not null default now(),
  unique (athlete_id, intervals_event_id)
);

create index planned_workouts_athlete_scheduled_idx on public.planned_workouts (athlete_id, scheduled_at desc);

create table public.prescriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_by uuid not null references public.coach_profiles(id),
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  goal text not null,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  evidence_snapshot jsonb not null check (jsonb_typeof(evidence_snapshot) = 'object'),
  approved_by uuid references public.coach_profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'approved') = (approved_by is not null and approved_at is not null))
);

create index prescriptions_athlete_created_idx on public.prescriptions (athlete_id, created_at desc);

create table public.reports (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_by uuid not null references public.coach_profiles(id),
  audience text not null check (audience in ('coach', 'cyclist', 'family')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  generated_at timestamptz not null default now()
);

create index reports_athlete_generated_idx on public.reports (athlete_id, generated_at desc);

create table public.audit_events (
  id bigint generated always as identity primary key,
  coach_id uuid not null references public.coach_profiles(id),
  athlete_id uuid references public.athletes(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_events_coach_created_idx on public.audit_events (coach_id, created_at desc);
create index audit_events_athlete_created_idx on public.audit_events (athlete_id, created_at desc) where athlete_id is not null;

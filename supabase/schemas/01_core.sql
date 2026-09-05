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
  latest_sync_key text,
  age_band text check (age_band is null or age_band in ('infantil', 'cadete', 'juvenil', 'sub23', 'elite', 'master', 'undisclosed')),
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

create table public.power_curve_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_by uuid not null references public.coach_profiles(id),
  sport text not null,
  environment text not null check (environment in ('all', 'outdoor', 'indoor')),
  oldest date not null,
  newest date not null,
  points jsonb not null check (jsonb_typeof(points) = 'array'),
  source_models jsonb not null default '[]'::jsonb check (jsonb_typeof(source_models) = 'array'),
  source_version text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  synchronized_at timestamptz not null default now(),
  check (oldest <= newest),
  unique (athlete_id, sport, environment, oldest, newest, content_hash)
);

create index power_curve_snapshots_athlete_synchronized_idx
on public.power_curve_snapshots (athlete_id, synchronized_at desc);
create index power_curve_snapshots_created_by_idx
on public.power_curve_snapshots (created_by);

create table public.power_analysis_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  snapshot_id uuid not null references public.power_curve_snapshots(id) on delete restrict,
  created_by uuid not null references public.coach_profiles(id),
  model text not null check (model in ('ECP', 'MORTON_3P')),
  algorithm_version text not null,
  cp_watts numeric not null check (cp_watts >= 0),
  w_prime_joules numeric not null check (w_prime_joules >= 0),
  pmax_watts numeric check (pmax_watts is null or pmax_watts >= 0),
  rmse_watts numeric not null check (rmse_watts >= 0),
  quality jsonb not null check (jsonb_typeof(quality) = 'object'),
  confirmed_at timestamptz not null default now(),
  unique (snapshot_id, model, algorithm_version, created_by)
);

create index power_analysis_runs_athlete_confirmed_idx
on public.power_analysis_runs (athlete_id, confirmed_at desc);
create index power_analysis_runs_created_by_idx
on public.power_analysis_runs (created_by);

create or replace function public.prevent_power_analysis_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Confirmed power analyses are immutable';
end;
$$;

create trigger power_analysis_runs_immutable_after_confirmation
before update or delete on public.power_analysis_runs
for each row execute function public.prevent_power_analysis_mutation();

revoke all on function public.prevent_power_analysis_mutation() from public, anon, authenticated;

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

create or replace function public.prevent_approved_prescription_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'approved' then
    raise exception 'Approved prescriptions are immutable';
  end if;
  if new.status = 'approved' and (
    new.athlete_id is distinct from old.athlete_id
    or new.goal is distinct from old.goal
    or new.content is distinct from old.content
    or new.evidence_snapshot is distinct from old.evidence_snapshot
  ) then
    raise exception 'Edit the draft before approving it';
  end if;
  return new;
end;
$$;

create trigger prescriptions_immutable_after_approval
before update on public.prescriptions
for each row execute function public.prevent_approved_prescription_mutation();

revoke all on function public.prevent_approved_prescription_mutation() from public, anon, authenticated;

create or replace function public.prevent_acknowledged_result_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.acknowledged_at is not null then
    raise exception 'Acknowledged results are immutable';
  end if;
  if new.acknowledged_at is not null and (
    new.athlete_id is distinct from old.athlete_id
    or new.metric_code is distinct from old.metric_code
    or new.value is distinct from old.value
    or new.unit is distinct from old.unit
    or new.algorithm_name is distinct from old.algorithm_name
    or new.algorithm_version is distinct from old.algorithm_version
    or new.input_observation_ids is distinct from old.input_observation_ids
  ) then
    raise exception 'Recalculate the result before acknowledging it';
  end if;
  return new;
end;
$$;

create trigger derived_results_immutable_after_acknowledgement
before update on public.derived_results
for each row execute function public.prevent_acknowledged_result_mutation();

revoke all on function public.prevent_acknowledged_result_mutation() from public, anon, authenticated;

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

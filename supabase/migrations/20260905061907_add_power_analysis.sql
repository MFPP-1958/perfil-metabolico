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

alter table public.power_curve_snapshots enable row level security;
alter table public.power_analysis_runs enable row level security;

revoke all on table public.power_curve_snapshots from public, anon, authenticated, service_role;
revoke all on table public.power_analysis_runs from public, anon, authenticated, service_role;
grant select, insert on table public.power_curve_snapshots to authenticated, service_role;
grant select, insert on table public.power_analysis_runs to authenticated, service_role;

create policy power_curve_snapshots_select_authorized on public.power_curve_snapshots
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));
create policy power_curve_snapshots_insert_authorized on public.power_curve_snapshots
for insert to authenticated with check (
  created_by = (select auth.uid()) and (select public.coach_can_edit_athlete(athlete_id))
);

create policy power_analysis_runs_select_authorized on public.power_analysis_runs
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));
create policy power_analysis_runs_insert_authorized on public.power_analysis_runs
for insert to authenticated with check (
  created_by = (select auth.uid()) and (select public.coach_can_edit_athlete(athlete_id))
);

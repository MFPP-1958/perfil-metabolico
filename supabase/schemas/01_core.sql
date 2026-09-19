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
  origin text not null check (origin in ('manual', 'intervals_icu', 'laboratory', 'field_test', 'device', 'calculated', 'external_model')),
  quality text not null check (quality in ('measured', 'imported_estimate', 'calculated', 'incomplete', 'rejected')),
  -- Programa de terceros que produjo el valor. Obligatorio si el origen es external_model.
  source_reference jsonb check (source_reference is null or source_reference ? 'software'),
  constraint observations_external_model_source check (
    (origin = 'external_model') = (source_reference is not null)
  ),
  protocol_name text not null,
  protocol_version text not null,
  notes text check (notes is null or char_length(notes) <= 2000),
  -- Un valor erróneo no se borra: se retira con fecha y motivo y deja de usarse.
  retracted_at timestamptz,
  retraction_reason text check (retraction_reason is null or char_length(retraction_reason) between 1 and 500),
  constraint observations_retraction_complete check ((retracted_at is null) = (retraction_reason is null)),
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

create table public.athlete_sync_states (
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  sport text not null default 'Ride',
  environment text not null check (environment in ('all', 'outdoor', 'indoor')),
  oldest date not null,
  newest date not null,
  status text not null check (status in ('complete', 'partial', 'failed')),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  updated_components jsonb not null default '[]'::jsonb check (jsonb_typeof(updated_components) = 'array'),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  synchronized_at timestamptz not null,
  check (oldest <= newest),
  primary key (athlete_id, sport, environment, oldest, newest)
);

create index athlete_sync_states_context_time_idx
on public.athlete_sync_states (athlete_id, sport, environment, oldest, newest, synchronized_at desc);

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
  unique (id, athlete_id),
  unique (athlete_id, sport, environment, oldest, newest, content_hash)
);

create index power_curve_snapshots_athlete_synchronized_idx
on public.power_curve_snapshots (athlete_id, synchronized_at desc);
create index power_curve_snapshots_created_by_idx
on public.power_curve_snapshots (created_by);

create table public.power_analysis_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  snapshot_id uuid not null,
  created_by uuid not null references public.coach_profiles(id),
  model text not null check (model in ('ECP', 'MORTON_3P')),
  algorithm_version text not null,
  cp_watts numeric not null check (cp_watts >= 0),
  w_prime_joules numeric not null check (w_prime_joules >= 0),
  pmax_watts numeric check (pmax_watts is null or pmax_watts >= 0),
  rmse_watts numeric not null check (rmse_watts >= 0),
  quality jsonb not null check (jsonb_typeof(quality) = 'object'),
  confirmed_at timestamptz not null default now(),
  foreign key (snapshot_id, athlete_id) references public.power_curve_snapshots(id, athlete_id) on delete restrict,
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

create table public.durability_curve_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_by uuid not null references public.coach_profiles(id),
  sport text not null check (sport = 'Ride'),
  environment text not null check (environment in ('all', 'outdoor', 'indoor')),
  oldest date not null,
  newest date not null,
  fresh_curve jsonb not null check (jsonb_typeof(fresh_curve) = 'object'),
  fatigued_curves jsonb not null check (jsonb_typeof(fatigued_curves) = 'array'),
  weight_kg numeric check (weight_kg is null or weight_kg > 0),
  weight_observed_at timestamptz,
  source_version text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  synchronized_at timestamptz not null,
  check (oldest <= newest),
  unique (athlete_id, sport, environment, oldest, newest, content_hash),
  unique (id, athlete_id)
);

create index durability_curve_snapshots_context_time_idx
on public.durability_curve_snapshots (athlete_id, sport, environment, oldest, newest, synchronized_at desc, id desc);
create index durability_curve_snapshots_created_by_idx
on public.durability_curve_snapshots (created_by);

create table public.durability_analysis_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  snapshot_id uuid not null,
  created_by uuid not null references public.coach_profiles(id),
  algorithm_version text not null,
  comparisons jsonb not null check (jsonb_typeof(comparisons) = 'array'),
  quality jsonb not null check (jsonb_typeof(quality) = 'object'),
  confirmed_at timestamptz not null default now(),
  foreign key (snapshot_id, athlete_id) references public.durability_curve_snapshots(id, athlete_id) on delete restrict,
  unique (snapshot_id, algorithm_version, created_by)
);

create index durability_analysis_runs_athlete_confirmed_idx
on public.durability_analysis_runs (athlete_id, confirmed_at desc);
create index durability_analysis_runs_snapshot_athlete_idx
on public.durability_analysis_runs (snapshot_id, athlete_id);
create index durability_analysis_runs_created_by_idx
on public.durability_analysis_runs (created_by);

create or replace function public.prevent_durability_analysis_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Confirmed durability analyses are immutable';
end;
$$;

create trigger durability_analysis_runs_immutable_after_confirmation
before update or delete on public.durability_analysis_runs
for each row execute function public.prevent_durability_analysis_mutation();

revoke all on function public.prevent_durability_analysis_mutation() from public, anon, authenticated;

create table public.metabolic_scenarios (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_by uuid not null references public.coach_profiles(id),
  scenario_name text not null check (char_length(scenario_name) between 1 and 120),
  rationale text not null check (char_length(rationale) between 1 and 2000),
  event_profile text not null check (event_profile in ('explosiva', 'rodador', 'escalador', 'fondo')),
  -- Entradas reales con su procedencia, copiadas para que el escenario sea reproducible.
  real_inputs jsonb not null check (jsonb_typeof(real_inputs) = 'object'),
  -- Valores propuestos por el entrenador. Nunca son mediciones.
  targets jsonb not null check (jsonb_typeof(targets) = 'object' and targets ? 'vlamax'),
  reference_power_watts numeric not null check (reference_power_watts > 0),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  model_versions jsonb not null check (jsonb_typeof(model_versions) = 'object'),
  outcome jsonb not null check (jsonb_typeof(outcome) = 'object'),
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (athlete_id, content_hash)
);

create index metabolic_scenarios_athlete_created_idx
on public.metabolic_scenarios (athlete_id, created_at desc);
create index metabolic_scenarios_created_by_idx
on public.metabolic_scenarios (created_by);

create or replace function public.prevent_metabolic_scenario_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Saved metabolic scenarios are immutable';
end;
$$;

create trigger metabolic_scenarios_immutable
before update or delete on public.metabolic_scenarios
for each row execute function public.prevent_metabolic_scenario_mutation();

revoke all on function public.prevent_metabolic_scenario_mutation() from public, anon, authenticated;

create or replace function public.persist_athlete_sync(
  target_athlete_id uuid,
  expected_sync_key text,
  target_coach_id uuid,
  sync_payload jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_sync_key text;
begin
  select latest_sync_key
  into current_sync_key
  from public.athletes
  where id = target_athlete_id
  for update;

  if current_sync_key is distinct from expected_sync_key then
    return false;
  end if;

  if not exists (
    select 1
    from public.coach_athletes
    where coach_id = target_coach_id
      and athlete_id = target_athlete_id
      and role = 'coach'
  ) then
    raise exception 'Coach cannot edit athlete' using errcode = '42501';
  end if;

  if jsonb_typeof(sync_payload) <> 'object'
    or sync_payload->>'sport' <> 'Ride'
    or sync_payload->>'environment' not in ('all', 'outdoor', 'indoor')
    or sync_payload->>'status' not in ('complete', 'partial', 'failed')
    or jsonb_typeof(sync_payload->'warnings') <> 'array'
    or jsonb_typeof(sync_payload->'updated') <> 'array'
    or jsonb_typeof(sync_payload->'counts') <> 'object'
  then
    raise exception 'Invalid synchronized athlete payload' using errcode = '22023';
  end if;

  if jsonb_typeof(sync_payload->'profile_name') = 'string' then
    update public.athletes
    set display_name = sync_payload->>'profile_name',
        updated_at = (sync_payload->>'synchronized_at')::timestamptz
    where id = target_athlete_id;
  end if;

  insert into public.activities (
    athlete_id, intervals_activity_id, sport, started_at, indoor, duration_seconds,
    normalized_data, source_updated_at, synchronized_at
  )
  select target_athlete_id, item.intervals_activity_id, item.sport, item.started_at,
    item.indoor, item.duration_seconds, item.normalized_data, item.source_updated_at,
    (sync_payload->>'synchronized_at')::timestamptz
  from jsonb_to_recordset(coalesce(sync_payload->'activities', '[]'::jsonb)) as item(
    intervals_activity_id text, sport text, started_at timestamptz, indoor boolean,
    duration_seconds integer, normalized_data jsonb, source_updated_at timestamptz
  )
  on conflict (athlete_id, intervals_activity_id) do update set
    sport = excluded.sport,
    started_at = excluded.started_at,
    indoor = excluded.indoor,
    duration_seconds = excluded.duration_seconds,
    normalized_data = excluded.normalized_data,
    source_updated_at = excluded.source_updated_at,
    synchronized_at = excluded.synchronized_at;

  insert into public.planned_workouts (
    athlete_id, intervals_event_id, scheduled_at, structured_blocks,
    source_updated_at, synchronized_at
  )
  select target_athlete_id, item.intervals_event_id, item.scheduled_at,
    item.structured_blocks, item.source_updated_at,
    (sync_payload->>'synchronized_at')::timestamptz
  from jsonb_to_recordset(coalesce(sync_payload->'planned_workouts', '[]'::jsonb)) as item(
    intervals_event_id text, scheduled_at timestamptz, structured_blocks jsonb,
    source_updated_at timestamptz
  )
  on conflict (athlete_id, intervals_event_id) do update set
    scheduled_at = excluded.scheduled_at,
    structured_blocks = excluded.structured_blocks,
    source_updated_at = excluded.source_updated_at,
    synchronized_at = excluded.synchronized_at;

  insert into public.observations (
    athlete_id, created_by, metric_code, value, unit, observed_at, origin, quality,
    protocol_name, protocol_version
  )
  select target_athlete_id, target_coach_id, item.metric_code, item.value, item.unit,
    item.observed_at, 'intervals_icu', 'imported_estimate', item.protocol_name,
    item.protocol_version
  from jsonb_to_recordset(coalesce(sync_payload->'observations', '[]'::jsonb)) as item(
    metric_code text, value numeric, unit text, observed_at timestamptz,
    protocol_name text, protocol_version text
  )
  -- Solo se registra un valor nuevo si cambia respecto al último importado de ese
  -- campo: así un FTP que va de 236 a 240 y vuelve a 236 deja las tres marcas.
  where not exists (
    select 1 from (
      select existing.value, existing.unit
      from public.observations existing
      where existing.athlete_id = target_athlete_id
        and existing.origin = 'intervals_icu'
        and existing.metric_code = item.metric_code
        and existing.protocol_name = item.protocol_name
        and existing.protocol_version = item.protocol_version
        and existing.retracted_at is null
      order by existing.observed_at desc, existing.created_at desc
      limit 1
    ) latest
    where latest.value = item.value and latest.unit = item.unit
  );

  insert into public.derived_results (
    athlete_id, created_by, metric_code, value, unit, quality, algorithm_name,
    algorithm_version, warnings, calculated_at
  )
  select target_athlete_id, target_coach_id, item.metric_code, item.value, item.unit,
    'calculated', item.algorithm_name, item.algorithm_version, '[]'::jsonb,
    (sync_payload->>'synchronized_at')::timestamptz
  from jsonb_to_recordset(coalesce(sync_payload->'derived_results', '[]'::jsonb)) as item(
    metric_code text, value numeric, unit text, algorithm_name text, algorithm_version text
  )
  where not exists (
    select 1 from public.derived_results existing
    where existing.athlete_id = target_athlete_id
      and existing.metric_code = item.metric_code
      and existing.value is not distinct from item.value
      and existing.unit = item.unit
      and existing.algorithm_name = item.algorithm_name
      and existing.algorithm_version = item.algorithm_version
  );

  if jsonb_typeof(sync_payload->'snapshot') = 'object' then
    insert into public.power_curve_snapshots (
      athlete_id, created_by, sport, environment, oldest, newest, points,
      source_models, source_version, content_hash, synchronized_at
    ) values (
      target_athlete_id,
      target_coach_id,
      sync_payload->'snapshot'->>'sport',
      sync_payload->'snapshot'->>'environment',
      (sync_payload->'snapshot'->>'oldest')::date,
      (sync_payload->'snapshot'->>'newest')::date,
      sync_payload->'snapshot'->'points',
      sync_payload->'snapshot'->'source_models',
      sync_payload->'snapshot'->>'source_version',
      sync_payload->'snapshot'->>'content_hash',
      (sync_payload->>'synchronized_at')::timestamptz
    ) on conflict (athlete_id, sport, environment, oldest, newest, content_hash) do nothing;
  end if;

  if jsonb_typeof(sync_payload->'durability_snapshot') = 'object' then
    insert into public.durability_curve_snapshots (
      athlete_id, created_by, sport, environment, oldest, newest, fresh_curve,
      fatigued_curves, weight_kg, weight_observed_at, source_version, content_hash,
      synchronized_at
    ) values (
      target_athlete_id,
      target_coach_id,
      sync_payload->'durability_snapshot'->>'sport',
      sync_payload->'durability_snapshot'->>'environment',
      (sync_payload->'durability_snapshot'->>'oldest')::date,
      (sync_payload->'durability_snapshot'->>'newest')::date,
      sync_payload->'durability_snapshot'->'fresh_curve',
      sync_payload->'durability_snapshot'->'fatigued_curves',
      (sync_payload->'durability_snapshot'->>'weight_kg')::numeric,
      (sync_payload->'durability_snapshot'->>'weight_observed_at')::timestamptz,
      sync_payload->'durability_snapshot'->>'source_version',
      sync_payload->'durability_snapshot'->>'content_hash',
      (sync_payload->>'synchronized_at')::timestamptz
    ) on conflict (athlete_id, sport, environment, oldest, newest, content_hash) do nothing;
  end if;

  insert into public.athlete_sync_states (
    athlete_id, sport, environment, oldest, newest, status, warnings,
    updated_components, counts, synchronized_at
  ) values (
    target_athlete_id,
    sync_payload->>'sport',
    sync_payload->>'environment',
    (sync_payload->>'oldest')::date,
    (sync_payload->>'newest')::date,
    sync_payload->>'status',
    sync_payload->'warnings',
    sync_payload->'updated',
    sync_payload->'counts',
    (sync_payload->>'synchronized_at')::timestamptz
  ) on conflict (athlete_id, sport, environment, oldest, newest) do update set
    status = excluded.status,
    warnings = excluded.warnings,
    updated_components = excluded.updated_components,
    counts = excluded.counts,
    synchronized_at = excluded.synchronized_at;

  return true;
end;
$$;

revoke all on function public.persist_athlete_sync(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.persist_athlete_sync(uuid, text, uuid, jsonb) to service_role;

create or replace function public.confirm_durability_analysis(
  target_snapshot_id uuid,
  target_created_by uuid,
  target_algorithm_version text,
  target_comparisons jsonb,
  target_quality jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  snapshot_record record;
  existing_analysis public.durability_analysis_runs%rowtype;
  inserted_analysis public.durability_analysis_runs%rowtype;
  latest_snapshot_id uuid;
begin
  select athlete_id, sport, environment, oldest, newest
  into snapshot_record
  from public.durability_curve_snapshots
  where id = target_snapshot_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if not exists (
    select 1
    from public.coach_athletes
    where coach_id = target_created_by
      and athlete_id = snapshot_record.athlete_id
      and role = 'coach'
  ) then
    raise exception 'Coach cannot confirm durability analysis' using errcode = '42501';
  end if;

  select *
  into existing_analysis
  from public.durability_analysis_runs
  where snapshot_id = target_snapshot_id
    and algorithm_version = target_algorithm_version
    and created_by = target_created_by;

  if found then
    return jsonb_build_object('status', 'existing', 'analysis', to_jsonb(existing_analysis));
  end if;

  perform 1
  from public.athletes
  where id = snapshot_record.athlete_id
  for update;

  select *
  into existing_analysis
  from public.durability_analysis_runs
  where snapshot_id = target_snapshot_id
    and algorithm_version = target_algorithm_version
    and created_by = target_created_by;

  if found then
    return jsonb_build_object('status', 'existing', 'analysis', to_jsonb(existing_analysis));
  end if;

  select id
  into latest_snapshot_id
  from public.durability_curve_snapshots
  where athlete_id = snapshot_record.athlete_id
    and sport = snapshot_record.sport
    and environment = snapshot_record.environment
    and oldest = snapshot_record.oldest
    and newest = snapshot_record.newest
  order by synchronized_at desc, id desc
  limit 1;

  if latest_snapshot_id is distinct from target_snapshot_id then
    return jsonb_build_object('status', 'stale');
  end if;

  if target_algorithm_version is null or length(target_algorithm_version) = 0
    or jsonb_typeof(target_comparisons) <> 'array'
    or jsonb_typeof(target_quality) <> 'object'
  then
    raise exception 'Invalid durability confirmation payload' using errcode = '22023';
  end if;

  insert into public.durability_analysis_runs (
    athlete_id, snapshot_id, created_by, algorithm_version, comparisons, quality
  ) values (
    snapshot_record.athlete_id,
    target_snapshot_id,
    target_created_by,
    target_algorithm_version,
    target_comparisons,
    target_quality
  )
  returning * into inserted_analysis;

  return jsonb_build_object('status', 'created', 'analysis', to_jsonb(inserted_analysis));
end;
$$;

revoke all on function public.confirm_durability_analysis(uuid, uuid, text, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.confirm_durability_analysis(uuid, uuid, text, jsonb, jsonb)
to service_role;

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

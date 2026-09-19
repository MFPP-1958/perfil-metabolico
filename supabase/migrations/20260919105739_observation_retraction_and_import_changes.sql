alter table "public"."observations" add column "retracted_at" timestamp with time zone;

alter table "public"."observations" add column "retraction_reason" text;

alter table "public"."observations" add constraint "observations_retraction_complete" CHECK (((retracted_at IS NULL) = (retraction_reason IS NULL))) not valid;

alter table "public"."observations" validate constraint "observations_retraction_complete";

alter table "public"."observations" add constraint "observations_retraction_reason_check" CHECK (((retraction_reason IS NULL) OR ((char_length(retraction_reason) >= 1) AND (char_length(retraction_reason) <= 500)))) not valid;

alter table "public"."observations" validate constraint "observations_retraction_reason_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.persist_athlete_sync(target_athlete_id uuid, expected_sync_key text, target_coach_id uuid, sync_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;



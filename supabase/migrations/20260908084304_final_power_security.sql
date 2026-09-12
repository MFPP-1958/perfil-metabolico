drop policy "power_analysis_runs_insert_authorized" on "public"."power_analysis_runs";

drop policy "power_curve_snapshots_insert_authorized" on "public"."power_curve_snapshots";

revoke delete on table "public"."activities" from "anon";

revoke insert on table "public"."activities" from "anon";

revoke references on table "public"."activities" from "anon";

revoke select on table "public"."activities" from "anon";

revoke trigger on table "public"."activities" from "anon";

revoke truncate on table "public"."activities" from "anon";

revoke update on table "public"."activities" from "anon";

revoke delete on table "public"."athletes" from "anon";

revoke insert on table "public"."athletes" from "anon";

revoke references on table "public"."athletes" from "anon";

revoke select on table "public"."athletes" from "anon";

revoke trigger on table "public"."athletes" from "anon";

revoke truncate on table "public"."athletes" from "anon";

revoke update on table "public"."athletes" from "anon";

revoke delete on table "public"."audit_events" from "anon";

revoke insert on table "public"."audit_events" from "anon";

revoke references on table "public"."audit_events" from "anon";

revoke select on table "public"."audit_events" from "anon";

revoke trigger on table "public"."audit_events" from "anon";

revoke truncate on table "public"."audit_events" from "anon";

revoke update on table "public"."audit_events" from "anon";

revoke delete on table "public"."coach_athletes" from "anon";

revoke insert on table "public"."coach_athletes" from "anon";

revoke references on table "public"."coach_athletes" from "anon";

revoke select on table "public"."coach_athletes" from "anon";

revoke trigger on table "public"."coach_athletes" from "anon";

revoke truncate on table "public"."coach_athletes" from "anon";

revoke update on table "public"."coach_athletes" from "anon";

revoke delete on table "public"."coach_profiles" from "anon";

revoke insert on table "public"."coach_profiles" from "anon";

revoke references on table "public"."coach_profiles" from "anon";

revoke select on table "public"."coach_profiles" from "anon";

revoke trigger on table "public"."coach_profiles" from "anon";

revoke truncate on table "public"."coach_profiles" from "anon";

revoke update on table "public"."coach_profiles" from "anon";

revoke delete on table "public"."derived_results" from "anon";

revoke insert on table "public"."derived_results" from "anon";

revoke references on table "public"."derived_results" from "anon";

revoke select on table "public"."derived_results" from "anon";

revoke trigger on table "public"."derived_results" from "anon";

revoke truncate on table "public"."derived_results" from "anon";

revoke update on table "public"."derived_results" from "anon";

revoke delete on table "public"."observations" from "anon";

revoke insert on table "public"."observations" from "anon";

revoke references on table "public"."observations" from "anon";

revoke select on table "public"."observations" from "anon";

revoke trigger on table "public"."observations" from "anon";

revoke truncate on table "public"."observations" from "anon";

revoke update on table "public"."observations" from "anon";

revoke delete on table "public"."planned_workouts" from "anon";

revoke insert on table "public"."planned_workouts" from "anon";

revoke references on table "public"."planned_workouts" from "anon";

revoke select on table "public"."planned_workouts" from "anon";

revoke trigger on table "public"."planned_workouts" from "anon";

revoke truncate on table "public"."planned_workouts" from "anon";

revoke update on table "public"."planned_workouts" from "anon";

revoke insert on table "public"."power_analysis_runs" from "authenticated";

revoke insert on table "public"."power_curve_snapshots" from "authenticated";

revoke delete on table "public"."prescriptions" from "anon";

revoke insert on table "public"."prescriptions" from "anon";

revoke references on table "public"."prescriptions" from "anon";

revoke select on table "public"."prescriptions" from "anon";

revoke trigger on table "public"."prescriptions" from "anon";

revoke truncate on table "public"."prescriptions" from "anon";

revoke update on table "public"."prescriptions" from "anon";

revoke delete on table "public"."reports" from "anon";

revoke insert on table "public"."reports" from "anon";

revoke references on table "public"."reports" from "anon";

revoke select on table "public"."reports" from "anon";

revoke trigger on table "public"."reports" from "anon";

revoke truncate on table "public"."reports" from "anon";

revoke update on table "public"."reports" from "anon";

revoke delete on table "public"."test_sessions" from "anon";

revoke insert on table "public"."test_sessions" from "anon";

revoke references on table "public"."test_sessions" from "anon";

revoke select on table "public"."test_sessions" from "anon";

revoke trigger on table "public"."test_sessions" from "anon";

revoke truncate on table "public"."test_sessions" from "anon";

revoke update on table "public"."test_sessions" from "anon";

alter table "public"."power_analysis_runs" drop constraint "power_analysis_runs_snapshot_id_fkey";


  create table "public"."athlete_sync_states" (
    "athlete_id" uuid not null,
    "sport" text not null default 'Ride'::text,
    "environment" text not null,
    "oldest" date not null,
    "newest" date not null,
    "status" text not null,
    "warnings" jsonb not null default '[]'::jsonb,
    "updated_components" jsonb not null default '[]'::jsonb,
    "counts" jsonb not null default '{}'::jsonb,
    "synchronized_at" timestamp with time zone not null
      );


alter table "public"."athlete_sync_states" enable row level security;

revoke all on table "public"."athlete_sync_states" from public, anon, authenticated, service_role;

CREATE INDEX athlete_sync_states_context_time_idx ON public.athlete_sync_states USING btree (athlete_id, sport, environment, oldest, newest, synchronized_at DESC);

CREATE UNIQUE INDEX athlete_sync_states_pkey ON public.athlete_sync_states USING btree (athlete_id, sport, environment, oldest, newest);

CREATE UNIQUE INDEX power_curve_snapshots_id_athlete_id_key ON public.power_curve_snapshots USING btree (id, athlete_id);

alter table "public"."athlete_sync_states" add constraint "athlete_sync_states_pkey" PRIMARY KEY using index "athlete_sync_states_pkey";

alter table "public"."athlete_sync_states" add constraint "athlete_sync_states_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."athlete_sync_states" validate constraint "athlete_sync_states_athlete_id_fkey";

alter table "public"."athlete_sync_states" add constraint "athlete_sync_states_check" CHECK ((oldest <= newest)) not valid;

alter table "public"."athlete_sync_states" validate constraint "athlete_sync_states_check";

alter table "public"."athlete_sync_states" add constraint "athlete_sync_states_counts_check" CHECK ((jsonb_typeof(counts) = 'object'::text)) not valid;

alter table "public"."athlete_sync_states" validate constraint "athlete_sync_states_counts_check";

alter table "public"."athlete_sync_states" add constraint "athlete_sync_states_environment_check" CHECK ((environment = ANY (ARRAY['all'::text, 'outdoor'::text, 'indoor'::text]))) not valid;

alter table "public"."athlete_sync_states" validate constraint "athlete_sync_states_environment_check";

alter table "public"."athlete_sync_states" add constraint "athlete_sync_states_status_check" CHECK ((status = ANY (ARRAY['complete'::text, 'partial'::text, 'failed'::text]))) not valid;

alter table "public"."athlete_sync_states" validate constraint "athlete_sync_states_status_check";

alter table "public"."athlete_sync_states" add constraint "athlete_sync_states_updated_components_check" CHECK ((jsonb_typeof(updated_components) = 'array'::text)) not valid;

alter table "public"."athlete_sync_states" validate constraint "athlete_sync_states_updated_components_check";

alter table "public"."athlete_sync_states" add constraint "athlete_sync_states_warnings_check" CHECK ((jsonb_typeof(warnings) = 'array'::text)) not valid;

alter table "public"."athlete_sync_states" validate constraint "athlete_sync_states_warnings_check";

-- The former independent foreign keys allowed crossed ownership. Keep every legacy
-- analysis and align its redundant athlete_id with the referenced snapshot before
-- the new invariant is validated.
drop trigger "power_analysis_runs_immutable_after_confirmation" on "public"."power_analysis_runs";

update public.power_analysis_runs as analysis
set athlete_id = snapshot.athlete_id
from public.power_curve_snapshots as snapshot
where analysis.snapshot_id = snapshot.id
  and analysis.athlete_id is distinct from snapshot.athlete_id;

create trigger power_analysis_runs_immutable_after_confirmation
before update or delete on public.power_analysis_runs
for each row execute function public.prevent_power_analysis_mutation();

alter table "public"."power_analysis_runs" add constraint "power_analysis_runs_snapshot_id_athlete_id_fkey" FOREIGN KEY (snapshot_id, athlete_id) REFERENCES public.power_curve_snapshots(id, athlete_id) ON DELETE RESTRICT not valid;

alter table "public"."power_analysis_runs" validate constraint "power_analysis_runs_snapshot_id_athlete_id_fkey";

alter table "public"."power_curve_snapshots" add constraint "power_curve_snapshots_id_athlete_id_key" UNIQUE using index "power_curve_snapshots_id_athlete_id_key";

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
  where not exists (
    select 1 from public.observations existing
    where existing.athlete_id = target_athlete_id
      and existing.origin = 'intervals_icu'
      and existing.metric_code = item.metric_code
      and existing.value = item.value
      and existing.unit = item.unit
      and existing.protocol_name = item.protocol_name
      and existing.protocol_version = item.protocol_version
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

revoke all on function public.persist_athlete_sync(uuid, text, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.persist_athlete_sync(uuid, text, uuid, jsonb) to service_role;

grant select on table "public"."athlete_sync_states" to "authenticated";

grant insert on table "public"."athlete_sync_states" to "service_role";

grant select on table "public"."athlete_sync_states" to "service_role";

grant update on table "public"."athlete_sync_states" to "service_role";


  create policy "athlete_sync_states_select_authorized"
  on "public"."athlete_sync_states"
  as permissive
  for select
  to authenticated
using (( SELECT public.coach_can_access_athlete(athlete_sync_states.athlete_id) AS coach_can_access_athlete));

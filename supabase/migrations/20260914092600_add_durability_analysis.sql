SET local check_function_bodies = off;

CREATE TABLE "public"."durability_analysis_runs" (
  "id"                uuid                     NOT NULL DEFAULT extensions.gen_random_uuid(),
  "athlete_id"        uuid                     NOT NULL,
  "snapshot_id"       uuid                     NOT NULL,
  "created_by"        uuid                     NOT NULL,
  "algorithm_version" text                     NOT NULL,
  "comparisons"       jsonb                    NOT NULL,
  "quality"           jsonb                    NOT NULL,
  "confirmed_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "durability_analysis_runs_comparisons_check" CHECK ((jsonb_typeof(comparisons) = 'array'::text)),
  CONSTRAINT "durability_analysis_runs_pkey" PRIMARY KEY (id),
  CONSTRAINT "durability_analysis_runs_quality_check" CHECK ((jsonb_typeof(quality) = 'object'::text)),
  CONSTRAINT "durability_analysis_runs_snapshot_id_algorithm_version_crea_key" UNIQUE (snapshot_id, algorithm_version, created_by)
);

ALTER TABLE "public"."durability_analysis_runs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."durability_curve_snapshots" (
  "id"                 uuid                     NOT NULL DEFAULT extensions.gen_random_uuid(),
  "athlete_id"         uuid                     NOT NULL,
  "created_by"         uuid                     NOT NULL,
  "sport"              text                     NOT NULL,
  "environment"        text                     NOT NULL,
  "oldest"             date                     NOT NULL,
  "newest"             date                     NOT NULL,
  "fresh_curve"        jsonb                    NOT NULL,
  "fatigued_curves"    jsonb                    NOT NULL,
  "weight_kg"          numeric,
  "weight_observed_at" timestamp with time zone,
  "source_version"     text                     NOT NULL,
  "content_hash"       text                     NOT NULL,
  "synchronized_at"    timestamp with time zone NOT NULL,
  CONSTRAINT "durability_curve_snapshots_athlete_id_sport_environment_old_key" UNIQUE (athlete_id, sport, environment, oldest, newest, content_hash),
  CONSTRAINT "durability_curve_snapshots_check" CHECK ((oldest <= newest)),
  CONSTRAINT "durability_curve_snapshots_content_hash_check" CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "durability_curve_snapshots_environment_check" CHECK ((environment = ANY (ARRAY['all'::text, 'outdoor'::text, 'indoor'::text]))),
  CONSTRAINT "durability_curve_snapshots_fatigued_curves_check" CHECK ((jsonb_typeof(fatigued_curves) = 'array'::text)),
  CONSTRAINT "durability_curve_snapshots_fresh_curve_check" CHECK ((jsonb_typeof(fresh_curve) = 'object'::text)),
  CONSTRAINT "durability_curve_snapshots_id_athlete_id_key" UNIQUE (id, athlete_id),
  CONSTRAINT "durability_curve_snapshots_pkey" PRIMARY KEY (id),
  CONSTRAINT "durability_curve_snapshots_sport_check" CHECK ((sport = 'Ride'::text)),
  CONSTRAINT "durability_curve_snapshots_weight_kg_check" CHECK (((weight_kg IS NULL) OR (weight_kg > (0)::numeric)))
);

ALTER TABLE "public"."durability_curve_snapshots"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.persist_athlete_sync (
  target_athlete_id uuid,
  expected_sync_key text,
  target_coach_id   uuid,
  sync_payload      jsonb
)
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
$function$;

CREATE OR REPLACE FUNCTION public.prevent_durability_analysis_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  raise exception 'Confirmed durability analyses are immutable';
end;
$function$;

ALTER TABLE "public"."durability_analysis_runs"
  ADD CONSTRAINT "durability_analysis_runs_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE;

ALTER TABLE "public"."durability_analysis_runs"
  ADD CONSTRAINT "durability_analysis_runs_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.coach_profiles(id);

ALTER TABLE "public"."durability_curve_snapshots"
  ADD CONSTRAINT "durability_curve_snapshots_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE;

ALTER TABLE "public"."durability_curve_snapshots"
  ADD CONSTRAINT "durability_curve_snapshots_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.coach_profiles(id);

ALTER TABLE "public"."durability_analysis_runs"
  ADD CONSTRAINT "durability_analysis_runs_snapshot_id_athlete_id_fkey" FOREIGN KEY (snapshot_id, athlete_id) REFERENCES public.durability_curve_snapshots(id, athlete_id)
    ON DELETE RESTRICT;

CREATE INDEX durability_analysis_runs_athlete_confirmed_idx ON public.durability_analysis_runs USING btree (athlete_id, confirmed_at DESC);

CREATE INDEX durability_analysis_runs_created_by_idx ON public.durability_analysis_runs USING btree (created_by);

CREATE INDEX durability_analysis_runs_snapshot_athlete_idx ON public.durability_analysis_runs USING btree (snapshot_id, athlete_id);

CREATE INDEX durability_curve_snapshots_context_time_idx ON public.durability_curve_snapshots USING btree (athlete_id, sport, environment, oldest, newest, synchronized_at DESC);

CREATE INDEX durability_curve_snapshots_created_by_idx ON public.durability_curve_snapshots USING btree (created_by);

CREATE TRIGGER durability_analysis_runs_immutable_after_confirmation
  BEFORE DELETE OR UPDATE ON public.durability_analysis_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_durability_analysis_mutation();

CREATE POLICY "durability_analysis_runs_select_authorized" ON "public"."durability_analysis_runs"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.coach_can_access_athlete(durability_analysis_runs.athlete_id) AS coach_can_access_athlete));

CREATE POLICY "durability_curve_snapshots_select_authorized" ON "public"."durability_curve_snapshots"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.coach_can_access_athlete(durability_curve_snapshots.athlete_id) AS coach_can_access_athlete));

-- Explicit revokes also cover installations with legacy default API grants.
REVOKE ALL ON FUNCTION "public"."prevent_durability_analysis_mutation"() FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON TABLE "public"."durability_analysis_runs", "public"."durability_curve_snapshots" FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."prevent_durability_analysis_mutation"() TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."durability_analysis_runs" FROM "authenticated";

GRANT SELECT ON TABLE "public"."durability_analysis_runs" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."durability_analysis_runs" TO "postgres";

REVOKE ALL ON TABLE "public"."durability_analysis_runs" FROM "service_role";

GRANT INSERT, SELECT ON TABLE "public"."durability_analysis_runs" TO "service_role";

REVOKE ALL ON TABLE "public"."durability_curve_snapshots" FROM "authenticated";

GRANT SELECT ON TABLE "public"."durability_curve_snapshots" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."durability_curve_snapshots" TO "postgres";

REVOKE ALL ON TABLE "public"."durability_curve_snapshots" FROM "service_role";

GRANT INSERT, SELECT ON TABLE "public"."durability_curve_snapshots" TO "service_role";

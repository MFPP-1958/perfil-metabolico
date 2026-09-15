SET local check_function_bodies = off;

REVOKE ALL ON FUNCTION "public"."coach_can_access_athlete"(uuid) FROM "anon";

REVOKE ALL ON FUNCTION "public"."coach_can_edit_athlete"(uuid) FROM "anon";

REVOKE ALL ON FUNCTION "public"."prevent_acknowledged_result_mutation"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."prevent_acknowledged_result_mutation"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."prevent_approved_prescription_mutation"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."prevent_approved_prescription_mutation"() FROM "authenticated";

REVOKE ALL ON TABLE "public"."activities" FROM "anon";

REVOKE ALL ON TABLE "public"."athletes" FROM "anon";

REVOKE ALL ON TABLE "public"."audit_events" FROM "anon";

REVOKE ALL ON TABLE "public"."coach_athletes" FROM "anon";

REVOKE ALL ON TABLE "public"."coach_profiles" FROM "anon";

REVOKE ALL ON TABLE "public"."derived_results" FROM "anon";

REVOKE ALL ON TABLE "public"."observations" FROM "anon";

REVOKE ALL ON TABLE "public"."planned_workouts" FROM "anon";

REVOKE ALL ON TABLE "public"."prescriptions" FROM "anon";

REVOKE ALL ON TABLE "public"."reports" FROM "anon";

REVOKE ALL ON TABLE "public"."test_sessions" FROM "anon";

DROP INDEX "public"."durability_curve_snapshots_context_time_idx";

CREATE OR REPLACE FUNCTION public.confirm_durability_analysis (
  target_snapshot_id       uuid,
  target_created_by        uuid,
  target_algorithm_version text,
  target_comparisons       jsonb,
  target_quality           jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE INDEX durability_curve_snapshots_context_time_idx ON public.durability_curve_snapshots
  USING btree (athlete_id, sport, environment, oldest, newest, synchronized_at DESC, id DESC);

REVOKE ALL ON FUNCTION "public"."confirm_durability_analysis"(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."confirm_durability_analysis"(uuid, uuid, text, jsonb, jsonb) FROM "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."confirm_durability_analysis"(uuid, uuid, text, jsonb, jsonb) TO "postgres", "service_role";

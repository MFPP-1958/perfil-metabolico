SET local check_function_bodies = off;

CREATE TABLE "public"."activities" (
  "id"                    uuid                     NOT NULL DEFAULT extensions.gen_random_uuid(),
  "athlete_id"            uuid                     NOT NULL,
  "intervals_activity_id" text                     NOT NULL,
  "sport"                 text                     NOT NULL,
  "started_at"            timestamp with time zone NOT NULL,
  "indoor"                boolean,
  "duration_seconds"      integer                  NOT NULL,
  "normalized_data"       jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "source_updated_at"     timestamp with time zone,
  "synchronized_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "activities_athlete_id_intervals_activity_id_key" UNIQUE (athlete_id, intervals_activity_id),
  CONSTRAINT "activities_duration_seconds_check" CHECK ((duration_seconds >= 0)),
  CONSTRAINT "activities_normalized_data_check" CHECK ((jsonb_typeof(normalized_data) = 'object'::text)),
  CONSTRAINT "activities_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."activities"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."athletes" (
  "id"                   uuid                     NOT NULL DEFAULT extensions.gen_random_uuid(),
  "created_by"           uuid                     NOT NULL,
  "intervals_athlete_id" text,
  "display_name"         text                     NOT NULL,
  "latest_sync_key"      text,
  "age_band"             text,
  "sex"                  text,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "athletes_age_band_check"
    CHECK (((age_band IS NULL) OR (age_band = ANY (ARRAY['infantil'::text, 'cadete'::text, 'juvenil'::text, 'sub23'::text, 'elite'::text, 'master'::text, 'undisclosed'::text])))),
  CONSTRAINT "athletes_display_name_check" CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 120))),
  CONSTRAINT "athletes_intervals_athlete_id_check" CHECK ((intervals_athlete_id ~ '^i[0-9]+$'::text)),
  CONSTRAINT "athletes_intervals_athlete_id_key" UNIQUE (intervals_athlete_id),
  CONSTRAINT "athletes_pkey" PRIMARY KEY (id),
  CONSTRAINT "athletes_sex_check" CHECK (((sex IS NULL) OR (sex = ANY (ARRAY['female'::text, 'male'::text, 'intersex'::text, 'undisclosed'::text]))))
);

ALTER TABLE "public"."athletes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."audit_events" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "coach_id"    uuid                     NOT NULL,
  "athlete_id"  uuid,
  "action"      text                     NOT NULL,
  "entity_type" text                     NOT NULL,
  "entity_id"   text                     NOT NULL,
  "metadata"    jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "audit_events_metadata_check" CHECK ((jsonb_typeof(metadata) = 'object'::text)),
  CONSTRAINT "audit_events_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."audit_events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."coach_athletes" (
  "coach_id"   uuid                     NOT NULL,
  "athlete_id" uuid                     NOT NULL,
  "role"       text                     NOT NULL DEFAULT 'coach'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "coach_athletes_pkey" PRIMARY KEY (coach_id, athlete_id),
  CONSTRAINT "coach_athletes_role_check" CHECK ((role = ANY (ARRAY['coach'::text, 'viewer'::text])))
);

ALTER TABLE "public"."coach_athletes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."coach_profiles" (
  "id"           uuid                     NOT NULL,
  "display_name" text                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "coach_profiles_display_name_check" CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 120))),
  CONSTRAINT "coach_profiles_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."coach_profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."derived_results" (
  "id"                    uuid                     NOT NULL DEFAULT extensions.gen_random_uuid(),
  "athlete_id"            uuid                     NOT NULL,
  "test_session_id"       uuid,
  "created_by"            uuid                     NOT NULL,
  "metric_code"           text                     NOT NULL,
  "value"                 numeric,
  "unit"                  text                     NOT NULL,
  "quality"               text                     NOT NULL,
  "algorithm_name"        text                     NOT NULL,
  "algorithm_version"     text                     NOT NULL,
  "input_observation_ids" uuid[]                   NOT NULL DEFAULT '{}'::uuid[],
  "warnings"              jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "calculated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "acknowledged_at"       timestamp with time zone,
  "acknowledged_by"       uuid,
  CONSTRAINT "derived_results_pkey" PRIMARY KEY (id),
  CONSTRAINT "derived_results_quality_check" CHECK ((quality = ANY (ARRAY['calculated'::text, 'incomplete'::text, 'rejected'::text]))),
  CONSTRAINT "derived_results_warnings_check" CHECK ((jsonb_typeof(warnings) = 'array'::text))
);

ALTER TABLE "public"."derived_results"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."observations" (
  "id"               uuid                     NOT NULL DEFAULT extensions.gen_random_uuid(),
  "athlete_id"       uuid                     NOT NULL,
  "test_session_id"  uuid,
  "created_by"       uuid                     NOT NULL,
  "metric_code"      text                     NOT NULL,
  "value"            numeric                  NOT NULL,
  "unit"             text                     NOT NULL,
  "observed_at"      timestamp with time zone NOT NULL,
  "origin"           text                     NOT NULL,
  "quality"          text                     NOT NULL,
  "protocol_name"    text                     NOT NULL,
  "protocol_version" text                     NOT NULL,
  "notes"            text,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "observations_notes_check" CHECK (((notes IS NULL) OR (char_length(notes) <= 2000))),
  CONSTRAINT "observations_origin_check"
    CHECK ((origin = ANY (ARRAY['manual'::text, 'intervals_icu'::text, 'laboratory'::text, 'field_test'::text, 'device'::text, 'calculated'::text]))),
  CONSTRAINT "observations_pkey" PRIMARY KEY (id),
  CONSTRAINT "observations_quality_check" CHECK ((quality = ANY (ARRAY['measured'::text, 'imported_estimate'::text, 'calculated'::text, 'incomplete'::text, 'rejected'::text]))),
  CONSTRAINT "observations_value_check" CHECK ((value >= (0)::numeric))
);

ALTER TABLE "public"."observations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."planned_workouts" (
  "id"                 uuid                     NOT NULL DEFAULT extensions.gen_random_uuid(),
  "athlete_id"         uuid                     NOT NULL,
  "intervals_event_id" text                     NOT NULL,
  "scheduled_at"       timestamp with time zone NOT NULL,
  "structured_blocks"  jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "source_updated_at"  timestamp with time zone,
  "synchronized_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "planned_workouts_athlete_id_intervals_event_id_key" UNIQUE (athlete_id, intervals_event_id),
  CONSTRAINT "planned_workouts_pkey" PRIMARY KEY (id),
  CONSTRAINT "planned_workouts_structured_blocks_check" CHECK ((jsonb_typeof(structured_blocks) = 'array'::text))
);

ALTER TABLE "public"."planned_workouts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."prescriptions" (
  "id"                uuid                     NOT NULL DEFAULT extensions.gen_random_uuid(),
  "athlete_id"        uuid                     NOT NULL,
  "created_by"        uuid                     NOT NULL,
  "status"            text                     NOT NULL DEFAULT 'draft'::text,
  "goal"              text                     NOT NULL,
  "content"           jsonb                    NOT NULL,
  "evidence_snapshot" jsonb                    NOT NULL,
  "approved_by"       uuid,
  "approved_at"       timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "prescriptions_check" CHECK (((status = 'approved'::text) = ((approved_by IS NOT NULL) AND (approved_at IS NOT NULL)))),
  CONSTRAINT "prescriptions_content_check" CHECK ((jsonb_typeof(content) = 'object'::text)),
  CONSTRAINT "prescriptions_evidence_snapshot_check" CHECK ((jsonb_typeof(evidence_snapshot) = 'object'::text)),
  CONSTRAINT "prescriptions_pkey" PRIMARY KEY (id),
  CONSTRAINT "prescriptions_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'superseded'::text])))
);

ALTER TABLE "public"."prescriptions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."reports" (
  "id"           uuid                     NOT NULL DEFAULT extensions.gen_random_uuid(),
  "athlete_id"   uuid                     NOT NULL,
  "created_by"   uuid                     NOT NULL,
  "audience"     text                     NOT NULL,
  "snapshot"     jsonb                    NOT NULL,
  "generated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "reports_audience_check" CHECK ((audience = ANY (ARRAY['coach'::text, 'cyclist'::text, 'family'::text]))),
  CONSTRAINT "reports_pkey" PRIMARY KEY (id),
  CONSTRAINT "reports_snapshot_check" CHECK ((jsonb_typeof(snapshot) = 'object'::text))
);

ALTER TABLE "public"."reports"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."test_sessions" (
  "id"               uuid                     NOT NULL DEFAULT extensions.gen_random_uuid(),
  "athlete_id"       uuid                     NOT NULL,
  "created_by"       uuid                     NOT NULL,
  "protocol_code"    text                     NOT NULL,
  "protocol_version" text                     NOT NULL,
  "performed_at"     timestamp with time zone NOT NULL,
  "status"           text                     NOT NULL,
  "invalid_reason"   text,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "test_sessions_pkey" PRIMARY KEY (id),
  CONSTRAINT "test_sessions_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'complete'::text, 'invalid'::text])))
);

ALTER TABLE "public"."test_sessions"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.coach_can_access_athlete (
  target_athlete_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = (select auth.uid())
      and ca.athlete_id = target_athlete_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.coach_can_edit_athlete (
  target_athlete_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = (select auth.uid())
      and ca.athlete_id = target_athlete_id
      and ca.role = 'coach'
  );
$function$;

CREATE OR REPLACE FUNCTION public.prevent_acknowledged_result_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.prevent_approved_prescription_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

ALTER TABLE "public"."activities"
  ADD CONSTRAINT "activities_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE;

ALTER TABLE "public"."audit_events"
  ADD CONSTRAINT "audit_events_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE SET NULL;

ALTER TABLE "public"."coach_athletes"
  ADD CONSTRAINT "coach_athletes_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE;

ALTER TABLE "public"."coach_profiles"
  ADD CONSTRAINT "coach_profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."athletes"
  ADD CONSTRAINT "athletes_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.coach_profiles(id);

ALTER TABLE "public"."audit_events"
  ADD CONSTRAINT "audit_events_coach_id_fkey" FOREIGN KEY (coach_id) REFERENCES public.coach_profiles(id);

ALTER TABLE "public"."coach_athletes"
  ADD CONSTRAINT "coach_athletes_coach_id_fkey" FOREIGN KEY (coach_id) REFERENCES public.coach_profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."derived_results"
  ADD CONSTRAINT "derived_results_acknowledged_by_fkey" FOREIGN KEY (acknowledged_by) REFERENCES public.coach_profiles(id);

ALTER TABLE "public"."derived_results"
  ADD CONSTRAINT "derived_results_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE;

ALTER TABLE "public"."derived_results"
  ADD CONSTRAINT "derived_results_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.coach_profiles(id);

ALTER TABLE "public"."observations"
  ADD CONSTRAINT "observations_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE;

ALTER TABLE "public"."observations"
  ADD CONSTRAINT "observations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.coach_profiles(id);

ALTER TABLE "public"."planned_workouts"
  ADD CONSTRAINT "planned_workouts_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE;

ALTER TABLE "public"."prescriptions"
  ADD CONSTRAINT "prescriptions_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES public.coach_profiles(id);

ALTER TABLE "public"."prescriptions"
  ADD CONSTRAINT "prescriptions_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE;

ALTER TABLE "public"."prescriptions"
  ADD CONSTRAINT "prescriptions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.coach_profiles(id);

ALTER TABLE "public"."reports"
  ADD CONSTRAINT "reports_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE;

ALTER TABLE "public"."reports"
  ADD CONSTRAINT "reports_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.coach_profiles(id);

ALTER TABLE "public"."test_sessions"
  ADD CONSTRAINT "test_sessions_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE;

ALTER TABLE "public"."test_sessions"
  ADD CONSTRAINT "test_sessions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.coach_profiles(id);

ALTER TABLE "public"."derived_results"
  ADD CONSTRAINT "derived_results_test_session_id_fkey" FOREIGN KEY (test_session_id) REFERENCES public.test_sessions(id) ON DELETE RESTRICT;

ALTER TABLE "public"."observations"
  ADD CONSTRAINT "observations_test_session_id_fkey" FOREIGN KEY (test_session_id) REFERENCES public.test_sessions(id) ON DELETE RESTRICT;

CREATE INDEX activities_athlete_start_idx ON public.activities USING btree (athlete_id, started_at DESC);

CREATE INDEX audit_events_athlete_created_idx ON public.audit_events USING btree (athlete_id, created_at DESC)
  WHERE (athlete_id IS NOT NULL);

CREATE INDEX audit_events_coach_created_idx ON public.audit_events USING btree (coach_id, created_at DESC);

CREATE INDEX coach_athletes_athlete_idx ON public.coach_athletes USING btree (athlete_id, coach_id);

CREATE INDEX derived_results_athlete_calculated_idx ON public.derived_results USING btree (athlete_id, calculated_at DESC, metric_code);

CREATE INDEX derived_results_session_idx ON public.derived_results USING btree (test_session_id)
  WHERE (test_session_id IS NOT NULL);

CREATE INDEX observations_athlete_observed_idx ON public.observations USING btree (athlete_id, observed_at DESC, metric_code);

CREATE INDEX observations_session_idx ON public.observations USING btree (test_session_id)
  WHERE (test_session_id IS NOT NULL);

CREATE INDEX planned_workouts_athlete_scheduled_idx ON public.planned_workouts USING btree (athlete_id, scheduled_at DESC);

CREATE INDEX prescriptions_athlete_created_idx ON public.prescriptions USING btree (athlete_id, created_at DESC);

CREATE INDEX reports_athlete_generated_idx ON public.reports USING btree (athlete_id, generated_at DESC);

CREATE INDEX test_sessions_athlete_performed_idx ON public.test_sessions USING btree (athlete_id, performed_at DESC);

CREATE TRIGGER derived_results_immutable_after_acknowledgement
  BEFORE UPDATE ON public.derived_results
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_acknowledged_result_mutation();

CREATE TRIGGER prescriptions_immutable_after_approval
  BEFORE UPDATE ON public.prescriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_approved_prescription_mutation();

CREATE POLICY "activities_select_authorized" ON "public"."activities"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.coach_can_access_athlete(activities.athlete_id) AS coach_can_access_athlete));

CREATE POLICY "athletes_delete_owned" ON "public"."athletes"
  FOR DELETE
  TO "authenticated"
  USING ((created_by = ( SELECT auth.uid() AS uid)));

CREATE POLICY "athletes_insert_owned" ON "public"."athletes"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((created_by = ( SELECT auth.uid() AS uid)));

CREATE POLICY "athletes_select_authorized" ON "public"."athletes"
  FOR SELECT
  TO "authenticated"
  USING (((created_by = ( SELECT auth.uid() AS uid)) OR ( SELECT public.coach_can_access_athlete(athletes.id) AS coach_can_access_athlete)));

CREATE POLICY "athletes_update_owned" ON "public"."athletes"
  FOR UPDATE
  TO "authenticated"
  USING ((created_by = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((created_by = ( SELECT auth.uid() AS uid)));

CREATE POLICY "audit_events_insert_own" ON "public"."audit_events"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((coach_id = ( SELECT auth.uid() AS uid)) AND ((athlete_id IS NULL) OR ( SELECT public.coach_can_edit_athlete(audit_events.athlete_id) AS coach_can_edit_athlete))));

CREATE POLICY "audit_events_select_own" ON "public"."audit_events"
  FOR SELECT
  TO "authenticated"
  USING ((coach_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "coach_athletes_delete_own" ON "public"."coach_athletes"
  FOR DELETE
  TO "authenticated"
  USING (((coach_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.athletes a
  WHERE ((a.id = coach_athletes.athlete_id) AND (a.created_by = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY "coach_athletes_insert_own" ON "public"."coach_athletes"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((coach_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.athletes a
  WHERE ((a.id = coach_athletes.athlete_id) AND (a.created_by = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY "coach_athletes_select_own" ON "public"."coach_athletes"
  FOR SELECT
  TO "authenticated"
  USING ((coach_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "coach_athletes_update_own" ON "public"."coach_athletes"
  FOR UPDATE
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.athletes a
  WHERE ((a.id = coach_athletes.athlete_id) AND (a.created_by = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.athletes a
  WHERE ((a.id = coach_athletes.athlete_id) AND (a.created_by = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "coach_profiles_insert_own" ON "public"."coach_profiles"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "coach_profiles_select_own" ON "public"."coach_profiles"
  FOR SELECT
  TO "authenticated"
  USING ((id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "coach_profiles_update_own" ON "public"."coach_profiles"
  FOR UPDATE
  TO "authenticated"
  USING ((id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "derived_results_insert_authorized" ON "public"."derived_results"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT public.coach_can_edit_athlete(derived_results.athlete_id) AS coach_can_edit_athlete)));

CREATE POLICY "derived_results_select_authorized" ON "public"."derived_results"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.coach_can_access_athlete(derived_results.athlete_id) AS coach_can_access_athlete));

CREATE POLICY "derived_results_update_owned" ON "public"."derived_results"
  FOR UPDATE
  TO "authenticated"
  USING ((created_by = ( SELECT auth.uid() AS uid)))
  WITH
    CHECK
    (((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT public.coach_can_edit_athlete(derived_results.athlete_id) AS coach_can_edit_athlete) AND ((acknowledged_by IS NULL) OR
    (acknowledged_by = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "observations_insert_authorized" ON "public"."observations"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT public.coach_can_edit_athlete(observations.athlete_id) AS coach_can_edit_athlete)));

CREATE POLICY "observations_select_authorized" ON "public"."observations"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.coach_can_access_athlete(observations.athlete_id) AS coach_can_access_athlete));

CREATE POLICY "planned_workouts_select_authorized" ON "public"."planned_workouts"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.coach_can_access_athlete(planned_workouts.athlete_id) AS coach_can_access_athlete));

CREATE POLICY "prescriptions_insert_authorized" ON "public"."prescriptions"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    (((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT public.coach_can_edit_athlete(prescriptions.athlete_id) AS coach_can_edit_athlete) AND (status = 'draft'::text) AND
    (approved_by IS NULL) AND (approved_at IS NULL)));

CREATE POLICY "prescriptions_select_authorized" ON "public"."prescriptions"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.coach_can_access_athlete(prescriptions.athlete_id) AS coach_can_access_athlete));

CREATE POLICY "prescriptions_update_owned" ON "public"."prescriptions"
  FOR UPDATE
  TO "authenticated"
  USING ((created_by = ( SELECT auth.uid() AS uid)))
  WITH
    CHECK
    (((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT public.coach_can_edit_athlete(prescriptions.athlete_id) AS coach_can_edit_athlete) AND ((approved_by IS NULL) OR
    (approved_by = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "reports_delete_owned" ON "public"."reports"
  FOR DELETE
  TO "authenticated"
  USING (((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT public.coach_can_edit_athlete(reports.athlete_id) AS coach_can_edit_athlete)));

CREATE POLICY "reports_insert_authorized" ON "public"."reports"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT public.coach_can_edit_athlete(reports.athlete_id) AS coach_can_edit_athlete)));

CREATE POLICY "reports_select_authorized" ON "public"."reports"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.coach_can_access_athlete(reports.athlete_id) AS coach_can_access_athlete));

CREATE POLICY "test_sessions_delete_owned" ON "public"."test_sessions"
  FOR DELETE
  TO "authenticated"
  USING (((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT public.coach_can_edit_athlete(test_sessions.athlete_id) AS coach_can_edit_athlete)));

CREATE POLICY "test_sessions_insert_authorized" ON "public"."test_sessions"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT public.coach_can_edit_athlete(test_sessions.athlete_id) AS coach_can_edit_athlete)));

CREATE POLICY "test_sessions_select_authorized" ON "public"."test_sessions"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.coach_can_access_athlete(test_sessions.athlete_id) AS coach_can_access_athlete));

CREATE POLICY "test_sessions_update_owned" ON "public"."test_sessions"
  FOR UPDATE
  TO "authenticated"
  USING ((created_by = ( SELECT auth.uid() AS uid)))
  WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT public.coach_can_edit_athlete(test_sessions.athlete_id) AS coach_can_edit_athlete)));

REVOKE ALL ON FUNCTION "public"."coach_can_access_athlete"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."coach_can_access_athlete"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."coach_can_edit_athlete"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."coach_can_edit_athlete"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."prevent_acknowledged_result_mutation"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."prevent_acknowledged_result_mutation"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."prevent_approved_prescription_mutation"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."prevent_approved_prescription_mutation"() TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."activities" TO "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."athletes" TO "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_events" TO "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."coach_athletes" TO "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."coach_profiles" TO "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."derived_results" TO "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."observations" TO "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."planned_workouts" TO "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."prescriptions" TO "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reports" TO "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."test_sessions" TO "authenticated", "postgres", "service_role";

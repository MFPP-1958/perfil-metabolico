
  create table "public"."metabolic_scenarios" (
    "id" uuid not null default extensions.gen_random_uuid(),
    "athlete_id" uuid not null,
    "created_by" uuid not null,
    "scenario_name" text not null,
    "rationale" text not null,
    "event_profile" text not null,
    "real_inputs" jsonb not null,
    "targets" jsonb not null,
    "reference_power_watts" numeric not null,
    "config" jsonb not null,
    "model_versions" jsonb not null,
    "outcome" jsonb not null,
    "content_hash" text not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."metabolic_scenarios" enable row level security;

CREATE INDEX metabolic_scenarios_athlete_created_idx ON public.metabolic_scenarios USING btree (athlete_id, created_at DESC);

CREATE UNIQUE INDEX metabolic_scenarios_athlete_id_content_hash_key ON public.metabolic_scenarios USING btree (athlete_id, content_hash);

CREATE INDEX metabolic_scenarios_created_by_idx ON public.metabolic_scenarios USING btree (created_by);

CREATE UNIQUE INDEX metabolic_scenarios_pkey ON public.metabolic_scenarios USING btree (id);

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_pkey" PRIMARY KEY using index "metabolic_scenarios_pkey";

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_athlete_id_content_hash_key" UNIQUE using index "metabolic_scenarios_athlete_id_content_hash_key";

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."metabolic_scenarios" validate constraint "metabolic_scenarios_athlete_id_fkey";

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_config_check" CHECK ((jsonb_typeof(config) = 'object'::text)) not valid;

alter table "public"."metabolic_scenarios" validate constraint "metabolic_scenarios_config_check";

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.coach_profiles(id) not valid;

alter table "public"."metabolic_scenarios" validate constraint "metabolic_scenarios_created_by_fkey";

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_event_profile_check" CHECK ((event_profile = ANY (ARRAY['explosiva'::text, 'rodador'::text, 'escalador'::text, 'fondo'::text]))) not valid;

alter table "public"."metabolic_scenarios" validate constraint "metabolic_scenarios_event_profile_check";

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_model_versions_check" CHECK ((jsonb_typeof(model_versions) = 'object'::text)) not valid;

alter table "public"."metabolic_scenarios" validate constraint "metabolic_scenarios_model_versions_check";

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_outcome_check" CHECK ((jsonb_typeof(outcome) = 'object'::text)) not valid;

alter table "public"."metabolic_scenarios" validate constraint "metabolic_scenarios_outcome_check";

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_rationale_check" CHECK (((char_length(rationale) >= 1) AND (char_length(rationale) <= 2000))) not valid;

alter table "public"."metabolic_scenarios" validate constraint "metabolic_scenarios_rationale_check";

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_real_inputs_check" CHECK ((jsonb_typeof(real_inputs) = 'object'::text)) not valid;

alter table "public"."metabolic_scenarios" validate constraint "metabolic_scenarios_real_inputs_check";

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_reference_power_watts_check" CHECK ((reference_power_watts > (0)::numeric)) not valid;

alter table "public"."metabolic_scenarios" validate constraint "metabolic_scenarios_reference_power_watts_check";

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_scenario_name_check" CHECK (((char_length(scenario_name) >= 1) AND (char_length(scenario_name) <= 120))) not valid;

alter table "public"."metabolic_scenarios" validate constraint "metabolic_scenarios_scenario_name_check";

alter table "public"."metabolic_scenarios" add constraint "metabolic_scenarios_targets_check" CHECK (((jsonb_typeof(targets) = 'object'::text) AND (targets ? 'vlamax'::text))) not valid;

alter table "public"."metabolic_scenarios" validate constraint "metabolic_scenarios_targets_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.prevent_metabolic_scenario_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'Saved metabolic scenarios are immutable';
end;
$function$
;

grant select on table "public"."metabolic_scenarios" to "authenticated";

grant insert on table "public"."metabolic_scenarios" to "service_role";

grant select on table "public"."metabolic_scenarios" to "service_role";


  create policy "metabolic_scenarios_select_authorized"
  on "public"."metabolic_scenarios"
  as permissive
  for select
  to authenticated
using (( SELECT public.coach_can_access_athlete(metabolic_scenarios.athlete_id) AS coach_can_access_athlete));


CREATE TRIGGER metabolic_scenarios_immutable BEFORE DELETE OR UPDATE ON public.metabolic_scenarios FOR EACH ROW EXECUTE FUNCTION public.prevent_metabolic_scenario_mutation();



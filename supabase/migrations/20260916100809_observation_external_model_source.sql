alter table "public"."observations" drop constraint "observations_origin_check";

alter table "public"."observations" add column "source_reference" jsonb;

alter table "public"."observations" add constraint "observations_external_model_source" CHECK (((origin = 'external_model'::text) = (source_reference IS NOT NULL))) not valid;

alter table "public"."observations" validate constraint "observations_external_model_source";

alter table "public"."observations" add constraint "observations_source_reference_check" CHECK (((source_reference IS NULL) OR (source_reference ? 'software'::text))) not valid;

alter table "public"."observations" validate constraint "observations_source_reference_check";

alter table "public"."observations" add constraint "observations_origin_check" CHECK ((origin = ANY (ARRAY['manual'::text, 'intervals_icu'::text, 'laboratory'::text, 'field_test'::text, 'device'::text, 'calculated'::text, 'external_model'::text]))) not valid;

alter table "public"."observations" validate constraint "observations_origin_check";



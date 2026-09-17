begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

select has_table('public', 'metabolic_scenarios', 'metabolic scenarios table exists');
select table_privs_are('public', 'metabolic_scenarios', 'authenticated', array['SELECT']);
select table_privs_are('public', 'metabolic_scenarios', 'anon', array[]::text[]);
select table_privs_are('public', 'metabolic_scenarios', 'service_role', array['SELECT', 'INSERT']);

insert into auth.users (id, email) values
  ('12000000-0000-4000-8000-000000000001', 'scenario-coach-a@example.test'),
  ('12000000-0000-4000-8000-000000000002', 'scenario-coach-b@example.test');
insert into public.coach_profiles (id, display_name) values
  ('12000000-0000-4000-8000-000000000001', 'Coach A'),
  ('12000000-0000-4000-8000-000000000002', 'Coach B');
insert into public.athletes (id, created_by, display_name, latest_sync_key) values
  ('22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'Athlete A', 'sync-current');
insert into public.coach_athletes (coach_id, athlete_id, role) values
  ('12000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', 'coach');

create function pg_temp.scenario_payload(fingerprint text default 'a') returns jsonb
language sql as $$
  select jsonb_build_object(
    'athlete_id', '22000000-0000-4000-8000-000000000001',
    'created_by', '12000000-0000-4000-8000-000000000001',
    'scenario_name', 'Escenario ' || fingerprint,
    'rationale', 'Hipotesis de prueba para el escenario ' || fingerprint,
    'event_profile', 'rodador',
    'real_inputs', '{"vlamax": 0.4}'::jsonb,
    'targets', jsonb_build_object('vlamax', 0.5),
    'reference_power_watts', 300,
    'config', '{}'::jsonb,
    'model_versions', '{}'::jsonb,
    'outcome', '{}'::jsonb,
    'content_hash', repeat(fingerprint, 64)
  );
$$;

create function pg_temp.insert_scenario(fingerprint text default 'a') returns uuid
language sql as $$
  insert into public.metabolic_scenarios (
    athlete_id, created_by, scenario_name, rationale, event_profile,
    real_inputs, targets, reference_power_watts, config, model_versions, outcome, content_hash
  )
  select
    (pg_temp.scenario_payload(fingerprint)->>'athlete_id')::uuid,
    (pg_temp.scenario_payload(fingerprint)->>'created_by')::uuid,
    pg_temp.scenario_payload(fingerprint)->>'scenario_name',
    pg_temp.scenario_payload(fingerprint)->>'rationale',
    pg_temp.scenario_payload(fingerprint)->>'event_profile',
    pg_temp.scenario_payload(fingerprint)->'real_inputs',
    pg_temp.scenario_payload(fingerprint)->'targets',
    (pg_temp.scenario_payload(fingerprint)->>'reference_power_watts')::numeric,
    pg_temp.scenario_payload(fingerprint)->'config',
    pg_temp.scenario_payload(fingerprint)->'model_versions',
    pg_temp.scenario_payload(fingerprint)->'outcome',
    pg_temp.scenario_payload(fingerprint)->>'content_hash'
  returning id;
$$;

set local role service_role;
select lives_ok($$select pg_temp.insert_scenario('a')$$, 'service role can save a scenario');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '12000000-0000-4000-8000-000000000002';
select results_eq(
  $$select count(*) from public.metabolic_scenarios$$,
  array[0::bigint],
  'a coach without access sees no scenario rows'
);
set local request.jwt.claim.sub = '12000000-0000-4000-8000-000000000001';
select results_eq(
  $$select count(*) from public.metabolic_scenarios$$,
  array[1::bigint],
  'the authorized coach sees the scenario'
);
select throws_ok(
  $$select pg_temp.insert_scenario('b')$$,
  '42501', null,
  'authenticated cannot insert a scenario'
);

reset role;
set local role anon;
select results_eq(
  $$select count(*) from public.metabolic_scenarios$$,
  array[0::bigint],
  'anon reads no rows (no select policy targets anon)'
);

reset role;
-- Exercise the trigger as owner so grants cannot mask a missing immutable trigger.
select throws_ok(
  $$update public.metabolic_scenarios set scenario_name = 'changed'$$,
  'P0001', 'Saved metabolic scenarios are immutable',
  'trigger blocks scenario updates'
);
select throws_ok(
  $$delete from public.metabolic_scenarios$$,
  'P0001', 'Saved metabolic scenarios are immutable',
  'trigger blocks scenario deletion'
);

set local role service_role;
select throws_ok(
  $$insert into public.metabolic_scenarios (
      athlete_id, created_by, scenario_name, rationale, event_profile,
      real_inputs, targets, reference_power_watts, config, model_versions, outcome, content_hash
    ) values (
      '22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001',
      'Escenario invalido', 'Perfil fuera de catalogo', 'sprinter',
      '{}', '{"vlamax": 0.5}', 300, '{}', '{}', '{}', repeat('c', 64)
    )$$,
  '23514', null,
  'event_profile rejects a value outside the four allowed'
);
select throws_ok(
  $$insert into public.metabolic_scenarios (
      athlete_id, created_by, scenario_name, rationale, event_profile,
      real_inputs, targets, reference_power_watts, config, model_versions, outcome, content_hash
    ) values (
      '22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001',
      'Escenario invalido', 'targets sin vlamax', 'rodador',
      '{}', '{"cp": 250}', 300, '{}', '{}', '{}', repeat('d', 64)
    )$$,
  '23514', null,
  'targets requires the vlamax key'
);

reset role;
select * from finish();
rollback;

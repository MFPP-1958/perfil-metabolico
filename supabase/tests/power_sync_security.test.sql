begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'power-coach@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'power-viewer@example.test');

insert into public.coach_profiles (id, display_name) values
  ('10000000-0000-4000-8000-000000000001', 'Power coach'),
  ('10000000-0000-4000-8000-000000000002', 'Power viewer');

insert into public.athletes (id, created_by, intervals_athlete_id, display_name, latest_sync_key) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'i900001', 'Athlete A', 'sync-b'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'i900002', 'Athlete B', null);

insert into public.coach_athletes (coach_id, athlete_id, role) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'coach'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'coach'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'viewer');

insert into public.power_curve_snapshots (
  id, athlete_id, created_by, sport, environment, oldest, newest, points,
  source_models, source_version, content_hash, synchronized_at
) values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Ride', 'all', '2026-06-08', '2026-09-05', '[{"seconds":5,"watts":900}]',
  '[]', 'test-v1', repeat('a', 64), '2026-09-05T12:00:00Z'
);

select ok(
  has_table_privilege('authenticated', 'public.power_curve_snapshots', 'select'),
  'authenticated retains snapshot reads'
);
select ok(
  not has_table_privilege('authenticated', 'public.power_curve_snapshots', 'insert'),
  'authenticated has no snapshot insert grant'
);
select ok(
  not has_table_privilege('authenticated', 'public.power_analysis_runs', 'insert'),
  'authenticated has no confirmed-analysis insert grant'
);
select ok(
  not has_table_privilege('anon', 'public.power_curve_snapshots', 'insert')
  and not has_table_privilege('anon', 'public.power_analysis_runs', 'insert'),
  'anon has no power write grants'
);
select ok(
  has_table_privilege('service_role', 'public.power_curve_snapshots', 'insert')
  and has_table_privilege('service_role', 'public.power_analysis_runs', 'insert'),
  'service role retains server-side power writes'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select results_eq(
  $$select count(*) from public.power_curve_snapshots where id = '30000000-0000-4000-8000-000000000001'$$,
  array[1::bigint],
  'authorized coach can read a snapshot'
);
select throws_ok(
  $$insert into public.power_curve_snapshots (athlete_id, created_by, sport, environment, oldest, newest, points, source_version, content_hash)
    values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Ride', 'all', '2026-06-08', '2026-09-05', '[{"seconds":5,"watts":999}]', 'forged', repeat('b', 64))$$,
  '42501', null,
  'authenticated coach cannot forge a snapshot directly'
);
select throws_ok(
  $$insert into public.power_analysis_runs (athlete_id, snapshot_id, created_by, model, algorithm_version, cp_watts, w_prime_joules, rmse_watts, quality)
    values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'ECP', 'forged', 300, 18000, 0, '{}')$$,
  '42501', null,
  'authenticated coach cannot forge a confirmed analysis directly'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';
select results_eq(
  $$select count(*) from public.power_curve_snapshots where id = '30000000-0000-4000-8000-000000000001'$$,
  array[1::bigint],
  'authorized viewer retains snapshot reads'
);

reset role;
set local role service_role;
select lives_ok(
  $$insert into public.power_analysis_runs (athlete_id, snapshot_id, created_by, model, algorithm_version, cp_watts, w_prime_joules, rmse_watts, quality)
    values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'ECP', 'server-confirmation', 300, 18000, 0, '{}')$$,
  'service role can persist a server-confirmed analysis'
);
select throws_ok(
  $$insert into public.power_analysis_runs (athlete_id, snapshot_id, created_by, model, algorithm_version, cp_watts, w_prime_joules, rmse_watts, quality)
    values ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'ECP', 'crossed', 300, 18000, 0, '{}')$$,
  '23503', null,
  'snapshot and analysis athlete IDs cannot be crossed'
);
select ok(
  public.persist_athlete_sync(
    '20000000-0000-4000-8000-000000000001', 'sync-a',
    '10000000-0000-4000-8000-000000000001',
    '{"sport":"Ride","environment":"all","oldest":"2026-06-08","newest":"2026-09-05","synchronized_at":"2026-09-05T12:01:00Z","status":"complete","warnings":[],"updated":["activities"],"counts":{"activities":{"received":1,"accepted":1,"rejected":0}},"profile_name":null,"activities":[{"intervals_activity_id":"i700001","sport":"Ride","started_at":"2026-09-01T08:00:00Z","indoor":false,"duration_seconds":3600,"normalized_data":{}}],"planned_workouts":[],"observations":[],"derived_results":[],"snapshot":null}'::jsonb
  ) is false,
  'stale sync A is rejected after sync B became latest'
);
select ok(
  public.persist_athlete_sync(
    '20000000-0000-4000-8000-000000000001', 'sync-b',
    '10000000-0000-4000-8000-000000000001',
    '{"sport":"Ride","environment":"all","oldest":"2026-06-08","newest":"2026-09-05","synchronized_at":"2026-09-05T12:02:00Z","status":"partial","warnings":["activities:1_rejected"],"updated":["activities"],"counts":{"activities":{"received":2,"accepted":1,"rejected":1}},"profile_name":null,"activities":[{"intervals_activity_id":"i700002","sport":"Ride","started_at":"2026-09-02T08:00:00Z","indoor":false,"duration_seconds":3600,"normalized_data":{}}],"planned_workouts":[],"observations":[],"derived_results":[],"snapshot":null}'::jsonb
  ),
  'latest sync B persists through the server-only transaction'
);
reset role;
select results_eq(
  $$select intervals_activity_id from public.activities where athlete_id = '20000000-0000-4000-8000-000000000001' order by intervals_activity_id$$,
  array['i700002'::text],
  'only B data persists after the A/B interleave'
);
select results_eq(
  $$select status || ':' || (warnings->>0) from public.athlete_sync_states where athlete_id = '20000000-0000-4000-8000-000000000001' and environment = 'all'$$,
  array['partial:activities:1_rejected'::text],
  'server stores the latest context status and sanitized warning'
);
select ok(
  not has_function_privilege('authenticated', 'public.persist_athlete_sync(uuid,text,uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.persist_athlete_sync(uuid,text,uuid,jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.persist_athlete_sync(uuid,text,uuid,jsonb)', 'execute'),
  'only service role can execute the atomic persistence function'
);

select * from finish();
rollback;

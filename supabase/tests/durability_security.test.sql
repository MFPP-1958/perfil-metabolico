begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'durability_curve_snapshots', 'durability snapshots exist');
select has_table('public', 'durability_analysis_runs', 'durability analyses exist');
select table_privs_are('public', 'durability_curve_snapshots', 'authenticated', array['SELECT']);
select table_privs_are('public', 'durability_analysis_runs', 'authenticated', array['SELECT']);
select table_privs_are('public', 'durability_curve_snapshots', 'anon', array[]::text[]);
select table_privs_are('public', 'durability_analysis_runs', 'anon', array[]::text[]);
select table_privs_are('public', 'durability_curve_snapshots', 'service_role', array['SELECT', 'INSERT']);
select table_privs_are('public', 'durability_analysis_runs', 'service_role', array['SELECT', 'INSERT']);
select function_privs_are('public', 'persist_athlete_sync', array['uuid','text','uuid','jsonb'], 'authenticated', array[]::text[]);
select function_privs_are('public', 'persist_athlete_sync', array['uuid','text','uuid','jsonb'], 'anon', array[]::text[]);
select function_privs_are('public', 'persist_athlete_sync', array['uuid','text','uuid','jsonb'], 'service_role', array['EXECUTE']);
select ok(not (select prosecdef from pg_proc where oid = 'public.persist_athlete_sync(uuid,text,uuid,jsonb)'::regprocedure), 'atomic persistence uses invoker permissions');
select has_function('public', 'confirm_durability_analysis', array['uuid','uuid','text','jsonb','jsonb'],
  'atomic durability confirmation exists');
select function_privs_are('public', 'confirm_durability_analysis', array['uuid','uuid','text','jsonb','jsonb'], 'public', array[]::text[]);
select function_privs_are('public', 'confirm_durability_analysis', array['uuid','uuid','text','jsonb','jsonb'], 'anon', array[]::text[]);
select function_privs_are('public', 'confirm_durability_analysis', array['uuid','uuid','text','jsonb','jsonb'], 'authenticated', array[]::text[]);
select function_privs_are('public', 'confirm_durability_analysis', array['uuid','uuid','text','jsonb','jsonb'], 'service_role', array['EXECUTE']);
select ok(not (select prosecdef from pg_proc where oid = 'public.confirm_durability_analysis(uuid,uuid,text,jsonb,jsonb)'::regprocedure),
  'atomic durability confirmation uses invoker permissions');
select is((select count(*) from pg_class where relnamespace = 'public'::regnamespace
  and relname in ('durability_curve_snapshots', 'durability_analysis_runs') and relrowsecurity),
  2::bigint, 'both durability tables enable RLS');

insert into auth.users (id, email) values
  ('11000000-0000-4000-8000-000000000001', 'durability-coach-a@example.test'),
  ('11000000-0000-4000-8000-000000000002', 'durability-coach-b@example.test'),
  ('11000000-0000-4000-8000-000000000003', 'durability-viewer@example.test');
insert into public.coach_profiles (id, display_name) values
  ('11000000-0000-4000-8000-000000000001', 'Coach A'),
  ('11000000-0000-4000-8000-000000000002', 'Coach B'),
  ('11000000-0000-4000-8000-000000000003', 'Viewer');
insert into public.athletes (id, created_by, display_name, latest_sync_key) values
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Athlete A', 'sync-current'),
  ('21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 'Athlete B', 'sync-current');
insert into public.coach_athletes (coach_id, athlete_id, role) values
  ('11000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'coach'),
  ('11000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', 'coach'),
  ('11000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', 'viewer');

create function pg_temp.durability_payload(fingerprint text default 'a') returns jsonb
language sql as $$
  select jsonb_build_object(
    'sport', 'Ride', 'environment', 'all', 'oldest', '2026-06-14', 'newest', '2026-09-14',
    'synchronized_at', '2026-09-14T12:00:00Z', 'status', 'complete',
    'warnings', '[]'::jsonb, 'updated', '["activities","power","durability"]'::jsonb, 'counts', '{}'::jsonb,
    'profile_name', 'Synced athlete',
    'activities', jsonb_build_array(jsonb_build_object('intervals_activity_id', 'activity-' || fingerprint,
      'sport', 'Ride', 'started_at', '2026-09-14T08:00:00Z', 'duration_seconds', 3600, 'normalized_data', '{}'::jsonb)),
    'snapshot', jsonb_build_object('sport', 'Ride', 'environment', 'all', 'oldest', '2026-06-14', 'newest', '2026-09-14',
      'points', '[]'::jsonb, 'source_models', '[]'::jsonb, 'source_version', 'test-v1', 'content_hash', repeat(fingerprint, 64)),
    'durability_snapshot', jsonb_build_object('sport', 'Ride', 'environment', 'all', 'oldest', '2026-06-14', 'newest', '2026-09-14',
      'fresh_curve', '{"points":[]}'::jsonb, 'fatigued_curves', '[]'::jsonb, 'weight_kg', 70,
      'weight_observed_at', '2026-09-13T09:00:00Z', 'source_version', 'test-v1', 'content_hash', repeat(fingerprint, 64))
  );
$$;

set local role service_role;
select ok(public.persist_athlete_sync('21000000-0000-4000-8000-000000000001', 'sync-current',
  '11000000-0000-4000-8000-000000000001', pg_temp.durability_payload()), 'service can persist athlete A with durability');
select ok(public.persist_athlete_sync('21000000-0000-4000-8000-000000000002', 'sync-current',
  '11000000-0000-4000-8000-000000000002', pg_temp.durability_payload()), 'same fingerprint is independent between athletes');
select ok(public.persist_athlete_sync('21000000-0000-4000-8000-000000000001', 'sync-current',
  '11000000-0000-4000-8000-000000000001', pg_temp.durability_payload()), 'repeated synchronization succeeds');
select results_eq($$select count(*) from public.durability_curve_snapshots where athlete_id = '21000000-0000-4000-8000-000000000001'$$,
  array[1::bigint], 'same athlete, context and fingerprint is idempotent');
select results_eq($$select weight_kg::text || ':' || source_version from public.durability_curve_snapshots where athlete_id = '21000000-0000-4000-8000-000000000001'$$,
  array['70:test-v1'], 'snapshot preserves weight and source version');
select lives_ok($$insert into public.durability_analysis_runs (athlete_id, snapshot_id, created_by, algorithm_version, comparisons, quality)
  select athlete_id, id, created_by, 'test-v1', '[]', '{}' from public.durability_curve_snapshots$$,
  'service can confirm analyses for both athletes');
select throws_ok($$insert into public.durability_analysis_runs (athlete_id, snapshot_id, created_by, algorithm_version, comparisons, quality)
  select '21000000-0000-4000-8000-000000000002', id, created_by, 'crossed', '[]', '{}' from public.durability_curve_snapshots
  where athlete_id = '21000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'composite FK rejects a snapshot from another athlete');
select throws_ok($$insert into public.durability_analysis_runs (athlete_id, snapshot_id, created_by, algorithm_version, comparisons, quality)
  select athlete_id, id, created_by, 'test-v1', '[]', '{}' from public.durability_curve_snapshots
  where athlete_id = '21000000-0000-4000-8000-000000000001'$$,
  '23505', null, 'same snapshot, version and creator cannot be confirmed twice');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000001';
select results_eq($$select athlete_id::text from public.durability_curve_snapshots$$,
  array['21000000-0000-4000-8000-000000000001'], 'coach A sees only athlete A snapshots');
select results_eq($$select athlete_id::text from public.durability_analysis_runs$$,
  array['21000000-0000-4000-8000-000000000001'], 'coach A sees only athlete A analyses');
select throws_ok($$insert into public.durability_curve_snapshots default values$$, '42501', null, 'authenticated cannot insert a snapshot');
select throws_ok($$insert into public.durability_analysis_runs default values$$, '42501', null, 'authenticated cannot insert an analysis');
select throws_ok($$update public.durability_analysis_runs set quality = '{}'$$, '42501', null, 'authenticated cannot update analyses');
select throws_ok($$delete from public.durability_analysis_runs$$, '42501', null, 'authenticated cannot delete analyses');
select throws_ok($$select public.persist_athlete_sync('21000000-0000-4000-8000-000000000001', 'sync-current',
  '11000000-0000-4000-8000-000000000001', '{}')$$, '42501', null, 'authenticated cannot invoke server persistence');
select throws_ok($$select public.confirm_durability_analysis('31000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001', 'test-v2', '[]', '{}')$$,
  '42501', null, 'authenticated cannot invoke atomic durability confirmation');
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000002';
select results_eq($$select athlete_id::text from public.durability_curve_snapshots$$,
  array['21000000-0000-4000-8000-000000000002'], 'coach B sees only athlete B snapshots');
select results_eq($$select athlete_id::text from public.durability_analysis_runs$$,
  array['21000000-0000-4000-8000-000000000002'], 'coach B sees only athlete B analyses');
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000003';
select results_eq($$select athlete_id::text from public.durability_curve_snapshots$$,
  array['21000000-0000-4000-8000-000000000001'], 'viewer can read assigned athlete snapshots');
select results_eq($$select athlete_id::text from public.durability_analysis_runs$$,
  array['21000000-0000-4000-8000-000000000001'], 'viewer can read assigned athlete analyses');
reset role;
set local role anon;
select throws_ok($$select * from public.durability_curve_snapshots$$, '42501', null, 'anon cannot read snapshots');
select throws_ok($$select * from public.durability_analysis_runs$$, '42501', null, 'anon cannot read analyses');

reset role;
-- Exercise the trigger as owner so grants cannot mask a missing immutable trigger.
select throws_ok($$update public.durability_analysis_runs set quality = '{"changed":true}'$$,
  'P0001', 'Confirmed durability analyses are immutable', 'trigger blocks privileged analysis updates');
select throws_ok($$delete from public.durability_analysis_runs$$,
  'P0001', 'Confirmed durability analyses are immutable', 'trigger blocks privileged analysis deletion');

set local role service_role;
select ok(public.persist_athlete_sync('21000000-0000-4000-8000-000000000001', 'sync-stale',
  '11000000-0000-4000-8000-000000000001', pg_temp.durability_payload('b')) is false, 'stale sync is rejected before writing');
select results_eq($$select count(*) from public.durability_curve_snapshots where content_hash = repeat('b', 64)$$,
  array[0::bigint], 'stale sync leaves no durability snapshot');
select results_eq($$select count(*) from public.power_curve_snapshots where content_hash = repeat('b', 64)$$,
  array[0::bigint], 'stale sync leaves no power snapshot');
select results_eq($$select count(*) from public.activities where intervals_activity_id = 'activity-b'$$,
  array[0::bigint], 'stale sync leaves no activity');
select throws_ok($$select public.persist_athlete_sync('21000000-0000-4000-8000-000000000001', 'sync-current',
  '11000000-0000-4000-8000-000000000003', pg_temp.durability_payload('b'))$$,
  '42501', 'Coach cannot edit athlete', 'viewer cannot authorize server persistence');
select throws_ok($$select public.persist_athlete_sync('21000000-0000-4000-8000-000000000001', 'sync-current',
  '11000000-0000-4000-8000-000000000001', jsonb_set(pg_temp.durability_payload('c'), '{status}', '"invalid"'))$$,
  '22023', 'Invalid synchronized athlete payload', 'invalid sync status is rejected');
select throws_ok($$select public.persist_athlete_sync('21000000-0000-4000-8000-000000000001', 'sync-current',
  '11000000-0000-4000-8000-000000000001', jsonb_set(pg_temp.durability_payload('c'), '{durability_snapshot,weight_kg}', '-1'))$$,
  '23514', null, 'invalid durability rolls back the atomic synchronization');
select results_eq($$select count(*) from public.activities where intervals_activity_id = 'activity-c'$$,
  array[0::bigint], 'failed durability rolls back preceding activity writes');
select results_eq($$select count(*) from public.power_curve_snapshots where content_hash = repeat('c', 64)$$,
  array[0::bigint], 'failed durability rolls back preceding power writes');
-- Fail after inserting durability to prove it shares the sync-state transaction.
select throws_ok($$select public.persist_athlete_sync('21000000-0000-4000-8000-000000000001', 'sync-current',
  '11000000-0000-4000-8000-000000000001', jsonb_set(pg_temp.durability_payload('d'), '{oldest}', '"2026-10-01"'))$$,
  '23514', null, 'sync-state failure rejects the whole synchronization');
select results_eq($$select count(*) from public.durability_curve_snapshots where content_hash = repeat('d', 64)$$,
  array[0::bigint], 'sync-state failure rolls back durability too');
select results_eq($$select count(*) from public.athlete_sync_states where athlete_id = '21000000-0000-4000-8000-000000000001' and status = 'complete'$$,
  array[1::bigint], 'previous sync state survives rejected synchronization');
select ok(public.persist_athlete_sync('21000000-0000-4000-8000-000000000001', 'sync-current',
  '11000000-0000-4000-8000-000000000001', pg_temp.durability_payload('e')), 'changed content creates a new historical snapshot');
select results_eq($$select count(*) from public.durability_curve_snapshots where athlete_id = '21000000-0000-4000-8000-000000000001'$$,
  array[2::bigint], 'history retains both distinct fingerprints');

-- Represent sync B committing between API recalculation and confirmation of snapshot A.
reset role;
insert into public.durability_curve_snapshots (
  id, athlete_id, created_by, sport, environment, oldest, newest, fresh_curve,
  fatigued_curves, weight_kg, weight_observed_at, source_version, content_hash, synchronized_at
) values (
  '31000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'Ride', 'indoor', '2026-06-14', '2026-09-14', '{"points":[]}', '[]', 70, null,
  'test-v1', repeat('1', 64), '2026-09-14T10:00:00Z'
), (
  '31000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'Ride', 'indoor', '2026-06-14', '2026-09-14', '{"points":[]}', '[]', 70, null,
  'test-v1', repeat('2', 64), '2026-09-14T11:00:00Z'
);
set local role service_role;
select is(
  public.confirm_durability_analysis(
    '31000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'durability-record-profile@2.0.0', '[]', '{"coverage":"high","warnings":[]}'
  )->>'status',
  'stale',
  'confirmation rejects A after synchronized snapshot B becomes latest'
);
select results_eq($$select count(*) from public.durability_analysis_runs
  where snapshot_id = '31000000-0000-4000-8000-000000000001'$$,
  array[0::bigint], 'stale confirmation inserts no run');
select is(
  public.confirm_durability_analysis(
    '31000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001',
    'durability-record-profile@2.0.0', '[]', '{"coverage":"high","warnings":[]}'
  )->>'status',
  'created',
  'latest snapshot can be confirmed atomically'
);
select throws_ok($$select public.confirm_durability_analysis(
  '31000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000003',
  'durability-record-profile@2.0.0', '[]', '{"coverage":"high","warnings":[]}'
)$$, '42501', 'Coach cannot confirm durability analysis',
  'atomic confirmation enforces coach ownership even through service role');
reset role;
insert into public.durability_curve_snapshots (
  id, athlete_id, created_by, sport, environment, oldest, newest, fresh_curve,
  fatigued_curves, weight_kg, weight_observed_at, source_version, content_hash, synchronized_at
) values (
  '31000000-0000-4000-8000-000000000003',
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'Ride', 'indoor', '2026-06-14', '2026-09-14', '{"points":[]}', '[]', 70, null,
  'test-v1', repeat('3', 64), '2026-09-14T12:00:00Z'
);
set local role service_role;
select is(
  public.confirm_durability_analysis(
    '31000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001',
    'durability-record-profile@2.0.0', '[]', '{"coverage":"different","warnings":[]}'
  )->>'status',
  'existing',
  'idempotent confirmation wins after the confirmed snapshot becomes stale'
);
select is(
  public.confirm_durability_analysis(
    '31000000-0000-4000-8000-000000000099',
    '11000000-0000-4000-8000-000000000001',
    'durability-record-profile@2.0.0', '[]', '{}'
  )->>'status',
  'not_found',
  'atomic confirmation reports a snapshot removed after API recalculation'
);

reset role;
select * from finish();
rollback;

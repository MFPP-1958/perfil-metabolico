import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tables = [
  'coach_profiles', 'athletes', 'coach_athletes', 'observations', 'test_sessions',
  'derived_results', 'activities', 'planned_workouts', 'prescriptions', 'reports',
  'audit_events', 'athlete_sync_states', 'power_curve_snapshots', 'power_analysis_runs',
];

function sql(name: string) {
  return readFileSync(resolve(`supabase/schemas/${name}`), 'utf8').toLowerCase();
}

function migration(name: string) {
  return readFileSync(resolve(`supabase/migrations/${name}`), 'utf8').toLowerCase();
}

describe('database schema', () => {
  it('defines every professional data table with RLS enabled', () => {
    const core = sql('01_core.sql');
    const rls = sql('02_rls.sql');
    for (const table of tables) {
      expect(core).toContain(`create table public.${table}`);
      expect(rls).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('uses authenticated ownership predicates without per-row auth re-evaluation', () => {
    const rls = sql('02_rls.sql');
    expect(rls).toContain('to authenticated');
    expect(rls).toContain('(select auth.uid())');
    expect(rls).not.toMatch(/to anon\b/);
  });

  it('constrains metric provenance and prescription approval', () => {
    const core = sql('01_core.sql');
    expect(core).toContain("quality in ('measured', 'imported_estimate', 'calculated', 'incomplete', 'rejected')");
    expect(core).toContain("status in ('draft', 'approved', 'superseded')");
    expect(core).toContain('approved_by');
    expect(core).toContain('algorithm_version');
  });

  it('indexes foreign keys and athlete date filters', () => {
    const core = sql('01_core.sql');
    expect(core).toContain('observations_athlete_observed_idx');
    expect(core).toContain('activities_athlete_start_idx');
    expect(core).toContain('coach_athletes_athlete_idx');
  });

  it('minimizes age data and keeps observations immutable', () => {
    const core = sql('01_core.sql');
    const rls = sql('02_rls.sql');
    expect(core).toContain('age_band text');
    expect(core).not.toContain('date_of_birth');
    expect(rls).not.toContain('observations_delete_owned');
  });

  it('prevents mutation of approved or acknowledged evidence', () => {
    const core = sql('01_core.sql');
    expect(core).toContain('prevent_approved_prescription_mutation');
    expect(core).toContain('prevent_acknowledged_result_mutation');
    expect(core).toContain('new.evidence_snapshot is distinct from old.evidence_snapshot');
  });

  it('stores traceable power snapshots and immutable confirmed analyses', () => {
    const core = sql('01_core.sql');
    expect(core).toContain('content_hash text not null');
    expect(core).toContain("points jsonb not null check (jsonb_typeof(points) = 'array')");
    expect(core).toContain("source_models jsonb not null default '[]'::jsonb check (jsonb_typeof(source_models) = 'array')");
    expect(core).toContain("environment text not null check (environment in ('all', 'outdoor', 'indoor'))");
    expect(core).toContain("model text not null check (model in ('ecp', 'morton_3p'))");
    expect(core).toContain('check (oldest <= newest)');
    expect(core).toContain('foreign key (snapshot_id, athlete_id) references public.power_curve_snapshots(id, athlete_id) on delete restrict');
    expect(core).toContain('cp_watts numeric not null check (cp_watts >= 0)');
    expect(core).toContain('w_prime_joules numeric not null check (w_prime_joules >= 0)');
    expect(core).toContain('pmax_watts numeric check (pmax_watts is null or pmax_watts >= 0)');
    expect(core).toContain('rmse_watts numeric not null check (rmse_watts >= 0)');
    expect(core).toContain('unique (athlete_id, sport, environment, oldest, newest, content_hash)');
    expect(core).toContain('unique (id, athlete_id)');
    expect(core).toContain('unique (snapshot_id, model, algorithm_version, created_by)');
    expect(core).toContain('create index power_curve_snapshots_created_by_idx\non public.power_curve_snapshots (created_by)');
    expect(core).toContain('create index power_analysis_runs_created_by_idx\non public.power_analysis_runs (created_by)');
    expect(core).toContain('prevent_power_analysis_mutation');
    expect(core).toContain('before update or delete on public.power_analysis_runs');
  });

  it('keeps power evidence client-readable and server-write-only', () => {
    const rls = sql('02_rls.sql');
    expect(rls).toContain('revoke all on table public.power_curve_snapshots from public, anon, authenticated, service_role');
    expect(rls).toContain('revoke all on table public.power_analysis_runs from public, anon, authenticated, service_role');
    expect(rls).toContain('grant select on table public.power_curve_snapshots to authenticated');
    expect(rls).toContain('grant select on table public.power_analysis_runs to authenticated');
    expect(rls).toContain('grant select, insert on table public.power_curve_snapshots to service_role');
    expect(rls).toContain('grant select, insert on table public.power_analysis_runs to service_role');
    expect(rls).toContain('power_curve_snapshots_select_authorized');
    expect(rls).toContain('power_analysis_runs_select_authorized');
    expect(rls).not.toContain('power_curve_snapshots_insert_authorized');
    expect(rls).not.toContain('power_analysis_runs_insert_authorized');
    expect(rls).not.toContain('power_analysis_runs_update_authorized');
    expect(rls).not.toContain('power_analysis_runs_delete_authorized');
  });

  it('repairs legacy crossed analysis ownership before validating the composite foreign key', () => {
    const finalMigration = migration('20260908084304_final_power_security.sql');
    const suspendImmutability = finalMigration.indexOf('drop trigger "power_analysis_runs_immutable_after_confirmation"');
    const repair = finalMigration.indexOf('update public.power_analysis_runs as analysis');
    const restoreImmutability = finalMigration.indexOf('create trigger power_analysis_runs_immutable_after_confirmation');
    const compositeForeignKey = finalMigration.indexOf('add constraint "power_analysis_runs_snapshot_id_athlete_id_fkey"');
    expect(suspendImmutability).toBeGreaterThan(-1);
    expect(repair).toBeGreaterThan(suspendImmutability);
    expect(restoreImmutability).toBeGreaterThan(repair);
    expect(compositeForeignKey).toBeGreaterThan(repair);
  });

  it('keeps viewer relationships read-only', () => {
    const rls = sql('02_rls.sql');
    expect(rls).toContain('coach_can_edit_athlete');
    expect(rls).toContain("ca.role = 'coach'");
    expect(rls).toContain('coach_can_edit_athlete(athlete_id)');
  });
});

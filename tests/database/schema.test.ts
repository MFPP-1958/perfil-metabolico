import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tables = [
  'coach_profiles', 'athletes', 'coach_athletes', 'observations', 'test_sessions',
  'derived_results', 'activities', 'planned_workouts', 'prescriptions', 'reports',
  'audit_events',
];

function sql(name: string) {
  return readFileSync(resolve(`supabase/schemas/${name}`), 'utf8').toLowerCase();
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
});

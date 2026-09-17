create or replace function public.coach_can_access_athlete(target_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = (select auth.uid())
      and ca.athlete_id = target_athlete_id
  );
$$;

revoke all on function public.coach_can_access_athlete(uuid) from public, anon;
grant execute on function public.coach_can_access_athlete(uuid) to authenticated;

create or replace function public.coach_can_edit_athlete(target_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = (select auth.uid())
      and ca.athlete_id = target_athlete_id
      and ca.role = 'coach'
  );
$$;

revoke all on function public.coach_can_edit_athlete(uuid) from public, anon;
grant execute on function public.coach_can_edit_athlete(uuid) to authenticated;

alter table public.coach_profiles enable row level security;
alter table public.athletes enable row level security;
alter table public.coach_athletes enable row level security;
alter table public.observations enable row level security;
alter table public.test_sessions enable row level security;
alter table public.derived_results enable row level security;
alter table public.activities enable row level security;
alter table public.planned_workouts enable row level security;
alter table public.athlete_sync_states enable row level security;
alter table public.power_curve_snapshots enable row level security;
alter table public.power_analysis_runs enable row level security;
alter table public.durability_curve_snapshots enable row level security;
alter table public.durability_analysis_runs enable row level security;
alter table public.metabolic_scenarios enable row level security;
alter table public.prescriptions enable row level security;
alter table public.reports enable row level security;
alter table public.audit_events enable row level security;

revoke all on all tables in schema public from anon;
revoke all on table public.power_curve_snapshots from public, anon, authenticated, service_role;
revoke all on table public.power_analysis_runs from public, anon, authenticated, service_role;
revoke all on table public.athlete_sync_states from public, anon, authenticated, service_role;
revoke all on table public.durability_curve_snapshots from public, anon, authenticated, service_role;
revoke all on table public.durability_analysis_runs from public, anon, authenticated, service_role;
grant select on table public.durability_curve_snapshots, public.durability_analysis_runs to authenticated;
grant select, insert on table public.durability_curve_snapshots, public.durability_analysis_runs to service_role;
revoke all on table public.metabolic_scenarios from public, anon, authenticated, service_role;
grant select on table public.metabolic_scenarios to authenticated;
grant select, insert on table public.metabolic_scenarios to service_role;
grant select on table public.power_curve_snapshots to authenticated;
grant select on table public.power_analysis_runs to authenticated;
grant select on table public.athlete_sync_states to authenticated;
grant select, insert on table public.power_curve_snapshots to service_role;
grant select, insert on table public.power_analysis_runs to service_role;
grant select, insert, update on table public.athlete_sync_states to service_role;

create policy coach_profiles_select_own on public.coach_profiles
for select to authenticated using (id = (select auth.uid()));
create policy coach_profiles_insert_own on public.coach_profiles
for insert to authenticated with check (id = (select auth.uid()));
create policy coach_profiles_update_own on public.coach_profiles
for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy athletes_select_authorized on public.athletes
for select to authenticated using (
  created_by = (select auth.uid()) or (select public.coach_can_access_athlete(id))
);
create policy athletes_insert_owned on public.athletes
for insert to authenticated with check (created_by = (select auth.uid()));
create policy athletes_update_owned on public.athletes
for update to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
create policy athletes_delete_owned on public.athletes
for delete to authenticated using (created_by = (select auth.uid()));

create policy coach_athletes_select_own on public.coach_athletes
for select to authenticated using (coach_id = (select auth.uid()));
create policy coach_athletes_insert_own on public.coach_athletes
for insert to authenticated with check (
  coach_id = (select auth.uid())
  and exists (
    select 1 from public.athletes a
    where a.id = athlete_id and a.created_by = (select auth.uid())
  )
);
create policy coach_athletes_update_own on public.coach_athletes
for update to authenticated using (
  exists (select 1 from public.athletes a where a.id = athlete_id and a.created_by = (select auth.uid()))
) with check (
  exists (select 1 from public.athletes a where a.id = athlete_id and a.created_by = (select auth.uid()))
);
create policy coach_athletes_delete_own on public.coach_athletes
for delete to authenticated using (
  coach_id = (select auth.uid())
  or exists (select 1 from public.athletes a where a.id = athlete_id and a.created_by = (select auth.uid()))
);

create policy test_sessions_select_authorized on public.test_sessions
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));
create policy test_sessions_insert_authorized on public.test_sessions
for insert to authenticated with check (
  created_by = (select auth.uid()) and (select public.coach_can_edit_athlete(athlete_id))
);
create policy test_sessions_update_owned on public.test_sessions
for update to authenticated using (created_by = (select auth.uid())) with check (
  created_by = (select auth.uid()) and (select public.coach_can_edit_athlete(athlete_id))
);
create policy test_sessions_delete_owned on public.test_sessions
for delete to authenticated using (created_by = (select auth.uid()) and (select public.coach_can_edit_athlete(athlete_id)));

create policy observations_select_authorized on public.observations
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));
create policy observations_insert_authorized on public.observations
for insert to authenticated with check (
  created_by = (select auth.uid()) and (select public.coach_can_edit_athlete(athlete_id))
);
create policy derived_results_select_authorized on public.derived_results
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));
create policy derived_results_insert_authorized on public.derived_results
for insert to authenticated with check (
  created_by = (select auth.uid()) and (select public.coach_can_edit_athlete(athlete_id))
);
create policy derived_results_update_owned on public.derived_results
for update to authenticated using (created_by = (select auth.uid())) with check (
  created_by = (select auth.uid())
  and (select public.coach_can_edit_athlete(athlete_id))
  and (acknowledged_by is null or acknowledged_by = (select auth.uid()))
);

create policy activities_select_authorized on public.activities
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));

create policy planned_workouts_select_authorized on public.planned_workouts
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));

create policy athlete_sync_states_select_authorized on public.athlete_sync_states
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));

create policy power_curve_snapshots_select_authorized on public.power_curve_snapshots
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));

create policy power_analysis_runs_select_authorized on public.power_analysis_runs
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));

create policy durability_curve_snapshots_select_authorized on public.durability_curve_snapshots
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));

create policy durability_analysis_runs_select_authorized on public.durability_analysis_runs
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));

create policy metabolic_scenarios_select_authorized on public.metabolic_scenarios
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));

create policy prescriptions_select_authorized on public.prescriptions
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));
create policy prescriptions_insert_authorized on public.prescriptions
for insert to authenticated with check (
  created_by = (select auth.uid())
  and (select public.coach_can_edit_athlete(athlete_id))
  and status = 'draft'
  and approved_by is null
  and approved_at is null
);
create policy prescriptions_update_owned on public.prescriptions
for update to authenticated using (created_by = (select auth.uid())) with check (
  created_by = (select auth.uid())
  and (select public.coach_can_edit_athlete(athlete_id))
  and (approved_by is null or approved_by = (select auth.uid()))
);

create policy reports_select_authorized on public.reports
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));
create policy reports_insert_authorized on public.reports
for insert to authenticated with check (
  created_by = (select auth.uid()) and (select public.coach_can_edit_athlete(athlete_id))
);
create policy reports_delete_owned on public.reports
for delete to authenticated using (created_by = (select auth.uid()) and (select public.coach_can_edit_athlete(athlete_id)));

create policy audit_events_select_own on public.audit_events
for select to authenticated using (coach_id = (select auth.uid()));
create policy audit_events_insert_own on public.audit_events
for insert to authenticated with check (
  coach_id = (select auth.uid())
  and (athlete_id is null or (select public.coach_can_edit_athlete(athlete_id)))
);

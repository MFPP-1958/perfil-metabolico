create index power_curve_snapshots_created_by_idx
on public.power_curve_snapshots (created_by);

create index power_analysis_runs_created_by_idx
on public.power_analysis_runs (created_by);

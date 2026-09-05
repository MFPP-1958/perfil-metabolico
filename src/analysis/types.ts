export type AnalysisPeriod =
  | { preset: 30 | 90 | 180 | 365 }
  | { preset: 'custom'; oldest: string; newest: string };

export type AnalysisEnvironment = 'all' | 'outdoor' | 'indoor';

export interface ResolvedPeriod {
  oldest: string;
  newest: string;
  days: number;
}

export type SyncState =
  | { status: 'idle'; synchronizedAt: string | null }
  | { status: 'running'; synchronizedAt: string | null }
  | { status: 'complete' | 'partial' | 'failed'; synchronizedAt: string | null; message: string };

export interface AnalysisPreferences {
  athleteId: string;
  period: AnalysisPeriod;
  environment: AnalysisEnvironment;
}

export interface ActivitySummary {
  id: string;
  athleteId: string;
  source: 'intervals_icu';
  sourceId: string;
  startTime: string;
  sport: string;
  indoor: boolean | null;
  durationSeconds: number;
  distanceMetres?: number;
  averagePowerWatts?: number;
}

export interface PlannedWorkout {
  id: string;
  athleteId: string;
  sourceId: string;
  scheduledAt: string;
  blocks: readonly WorkoutBlock[];
}

export interface WorkoutBlock {
  kind: 'warmup' | 'work' | 'recovery' | 'cooldown';
  durationSeconds: number;
  target?: { metric: 'power' | 'heart_rate' | 'rpe'; min: number; max: number; unit: string };
}

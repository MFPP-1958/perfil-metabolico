export type BlockKind = 'warmup' | 'work' | 'recovery' | 'cooldown';
export type Target = { type: 'power' | 'heart_rate'; min: number; max: number };

export interface PlannedBlock {
  id: string;
  kind: BlockKind;
  durationSeconds: number;
  target: Target;
}

export interface CompletedBlock {
  plannedKind?: BlockKind;
  durationSeconds: number;
  averagePower?: number;
  variabilityIndex?: number;
  averageHeartRate?: number;
  averageCadence?: number;
  rpe?: number;
}

export interface PlannedWorkoutStructure { title: string; blocks: PlannedBlock[] }
export interface CompletedWorkout { title: string; blocks: CompletedBlock[] }

export interface AlignedBlock {
  planned?: PlannedBlock;
  completed?: CompletedBlock;
  status: 'matched' | 'skipped' | 'extra';
  targetType?: Target['type'];
  durationCompliancePercent?: number;
  powerCompliancePercent?: number;
  heartRateCompliancePercent?: number;
}

export interface SessionAlignment {
  confidence: 'high' | 'low';
  blocks: AlignedBlock[];
  warnings: string[];
}

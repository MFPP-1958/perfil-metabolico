export type CoverageQuality = 'high' | 'moderate' | 'low' | 'insufficient';
export type CellQuality = 'observed' | 'insufficient' | 'incompatible';
export type DurabilityLevel = 'kj0' | 'kj1';

export interface DurabilityPoint {
  seconds: number;
  watts: number;
  activityId: string | null;
  supportingActivityCount: number;
  supportingEffortCount: number;
  powerSource: 'measured' | 'unknown';
}

export interface DurabilityInput {
  sport: 'Ride';
  environment: 'all' | 'outdoor' | 'indoor';
  oldest: string;
  newest: string;
  fresh: { weightKg: number | null; points: readonly DurabilityPoint[] };
  fatigued: readonly {
    level: DurabilityLevel;
    afterKj: number;
    weightKg: number | null;
    points: readonly DurabilityPoint[];
  }[];
}

export interface DurabilityLevelResult {
  afterKj: number;
  afterKjPerKg: number | null;
  fatiguedWatts: number | null;
  declinePercent: number | null;
  quality: CellQuality;
  supportingActivityCount: number;
  supportingEffortCount: number;
  powerSource: 'measured' | 'unknown';
}

export interface DurabilityRow {
  seconds: 10 | 60 | 300 | 1200;
  freshWatts: number | null;
  levels: Partial<Record<DurabilityLevel, DurabilityLevelResult>>;
  onsetAfterKj: number | null;
  onsetAfterKjPerKg: number | null;
}

export interface DurabilityResult {
  algorithmVersion: 'durability-record-profile@2.0.0';
  rows: DurabilityRow[];
  coverage: CoverageQuality;
  warnings: string[];
}

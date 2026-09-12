export interface AthleteSyncRequest {
  athleteId: string;
  oldest: string;
  newest: string;
  environment: 'all' | 'outdoor' | 'indoor';
  syncKey: string;
}

export interface AthleteSyncResult {
  status: 'complete' | 'partial';
  synchronizedAt: string;
  warnings: string[];
  counts?: Record<string, { received: number; accepted: number; rejected: number }>;
}

export type AthleteSyncContext = Omit<AthleteSyncRequest, 'syncKey'>;

export interface AthletePersistedSyncState {
  status: 'complete' | 'partial' | 'failed';
  synchronizedAt: string;
  warnings: string[];
  counts?: Record<string, { received: number; accepted: number; rejected: number }>;
}

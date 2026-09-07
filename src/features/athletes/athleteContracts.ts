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
}

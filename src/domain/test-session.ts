import type { Observation } from './observation';

export interface TestSession {
  id: string;
  athleteId: string;
  protocolCode: string;
  protocolVersion: string;
  performedAt: string;
  status: 'draft' | 'complete' | 'invalid';
  observations: readonly Observation[];
}

export interface DerivedResult {
  id: string;
  athleteId: string;
  testSessionId?: string;
  metricCode: string;
  value: number;
  unit: string;
  algorithm: { name: string; version: string };
  inputObservationIds: readonly string[];
  quality: 'calculated' | 'incomplete' | 'rejected';
  calculatedAt: string;
  warnings: readonly string[];
}

import {
  isValidDateOnly,
  validateAnalysisPeriodShape,
} from './period';
import type { AnalysisEnvironment, AnalysisPreferences } from './types';

export type { AnalysisEnvironment, AnalysisPeriod, AnalysisPreferences } from './types';

export const ANALYSIS_PREFERENCES_STORAGE_KEY = 'mfpp.analysis.preferences.v1';

const ENVIRONMENTS = new Set<AnalysisEnvironment>(['all', 'outdoor', 'indoor']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isStrictPreferences(value: unknown): value is AnalysisPreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 3) return false;
  if (!isUuid(candidate.athleteId) || !ENVIRONMENTS.has(candidate.environment as AnalysisEnvironment)) return false;
  if (!validateAnalysisPeriodShape(candidate.period)) return false;
  if (candidate.period.preset === 'custom') {
    return isValidDateOnly(candidate.period.oldest) && isValidDateOnly(candidate.period.newest);
  }
  return true;
}

export function loadAnalysisPreferences(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  authorizedIds: ReadonlySet<string>,
): AnalysisPreferences | null {
  let raw: string | null;
  try {
    raw = storage.getItem(ANALYSIS_PREFERENCES_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    removeInvalidPreferences(storage);
    return null;
  }
  if (!isStrictPreferences(parsed) || !authorizedIds.has(parsed.athleteId)) {
    removeInvalidPreferences(storage);
    return null;
  }
  return {
    athleteId: parsed.athleteId,
    period: parsed.period.preset === 'custom'
      ? { preset: 'custom', oldest: parsed.period.oldest, newest: parsed.period.newest }
      : { preset: parsed.period.preset },
    environment: parsed.environment,
  };
}

export function saveAnalysisPreferences(
  storage: Pick<Storage, 'setItem'>,
  value: AnalysisPreferences,
): void {
  if (!isStrictPreferences(value)) throw new Error('Las preferencias de análisis no son válidas.');
  const safeValue: AnalysisPreferences = {
    athleteId: value.athleteId,
    period: value.period.preset === 'custom'
      ? { preset: 'custom', oldest: value.period.oldest, newest: value.period.newest }
      : { preset: value.period.preset },
    environment: value.environment,
  };
  storage.setItem(ANALYSIS_PREFERENCES_STORAGE_KEY, JSON.stringify(safeValue));
}

function removeInvalidPreferences(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(ANALYSIS_PREFERENCES_STORAGE_KEY);
  } catch {
    // A storage that cannot be modified must not prevent the empty safe state.
  }
}

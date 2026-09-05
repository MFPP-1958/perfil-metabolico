import { describe, expect, it } from 'vitest';
import { loadAnalysisPreferences, saveAnalysisPreferences, type AnalysisPreferences } from './preferences';

const allowedId = '11111111-1111-4111-8111-111111111111';

function memoryStorage(initial?: string): Storage {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set('mfpp.analysis.preferences.v1', initial);
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('analysis preferences', () => {
  it('loads only a valid preference for an authorized athlete', () => {
    const saved = JSON.stringify({ athleteId: allowedId, period: { preset: 90 }, environment: 'all' });
    expect(loadAnalysisPreferences(memoryStorage(saved), new Set([allowedId]))).toEqual({
      athleteId: allowedId,
      period: { preset: 90 },
      environment: 'all',
    });
  });

  it('returns null for an athlete that is not authorized', () => {
    const saved = JSON.stringify({ athleteId: allowedId, period: { preset: 90 }, environment: 'all' });
    expect(loadAnalysisPreferences(memoryStorage(saved), new Set())).toBeNull();
  });

  it('returns null for malformed, unsafe, or unsupported values', () => {
    const invalid = [
      '{bad json',
      JSON.stringify({ athleteId: 'i593028', period: { preset: 90 }, environment: 'all' }),
      JSON.stringify({ athleteId: allowedId, period: { preset: 60 }, environment: 'all' }),
      JSON.stringify({ athleteId: allowedId, period: { preset: 90 }, environment: 'virtual' }),
      JSON.stringify({ athleteId: allowedId, period: { preset: 'custom', oldest: '2026-09-06', newest: '2026-09-05' }, environment: 'all' }),
      JSON.stringify({ athleteId: allowedId, period: { preset: 90 }, environment: 'all', name: 'Jaume' }),
    ];

    for (const value of invalid) expect(loadAnalysisPreferences(memoryStorage(value), new Set([allowedId]))).toBeNull();
  });

  it('persists only the approved non-sensitive preference fields', () => {
    const storage = memoryStorage();
    const value: AnalysisPreferences = { athleteId: allowedId, period: { preset: 90 }, environment: 'all' };
    saveAnalysisPreferences(storage, value);
    const raw = storage.getItem('mfpp.analysis.preferences.v1');
    expect(raw).toBe(JSON.stringify(value));
    expect(raw).not.toContain('Jaume');
    expect(raw).not.toContain('i593028');
  });

  it('does not persist invalid values', () => {
    const storage = memoryStorage();
    expect(() => saveAnalysisPreferences(storage, { athleteId: 'i593028', period: { preset: 90 }, environment: 'all' } as never)).toThrow();
    expect(storage.getItem('mfpp.analysis.preferences.v1')).toBeNull();
  });
});

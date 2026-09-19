import { describe, expect, it } from 'vitest';
import { defaultSelection, evaluateCompliance, resolveTargetWatts, verdictFor, type DetectedInterval, type SessionReferences } from './compliance';

const references: SessionReferences = {
  ftp: { value: 240, quality: 'measured', observedAt: '2026-09-16T10:00:00Z' },
  pVo2max: { value: 392, quality: 'calculated', observedAt: '2026-09-18T07:00:00Z' },
  pmax: null,
  powerZones: [55, 75, 90, 105, 120, 150, 999],
};

function interval(index: number, movingSeconds: number, averageWatts: number | null, type = 'WORK'): DetectedInterval {
  return { index, type, startSeconds: index * 600, movingSeconds, averageWatts, averageHeartRate: 160, averageCadence: 90 };
}

describe('resolveTargetWatts', () => {
  it('calcula el porcentaje sobre la referencia del ciclista', () => {
    expect(resolveTargetWatts({ kind: 'percent', percent: 106, reference: 'FTP', referenceAssumed: false, unknownReference: null, progressive: false }, references))
      .toMatchObject({ status: 'ok', watts: 254.4 });
    expect(resolveTargetWatts({ kind: 'percent', percent: 100, reference: 'P@VO2max', referenceAssumed: false, unknownReference: null, progressive: false }, references))
      .toMatchObject({ status: 'ok', watts: 392 });
  });

  it('usa los vatios absolutos tal cual', () => {
    expect(resolveTargetWatts({ kind: 'watts', watts: 200 }, references)).toMatchObject({ status: 'ok', watts: 200 });
  });

  it('resuelve las zonas con los límites de Intervals.icu sobre el FTP del ciclista', () => {
    // Z2 va del 55 al 75 % del FTP.
    expect(resolveTargetWatts({ kind: 'zone', zone: 2 }, references)).toMatchObject({ status: 'ok', watts: 156, lowWatts: 132, highWatts: 180 });
    // Z7 no tiene techo: se acota a 30 puntos por encima del suelo.
    expect(resolveTargetWatts({ kind: 'zone', zone: 7 }, references)).toMatchObject({ status: 'ok', watts: 396, lowWatts: 360, highWatts: null });
  });

  it('explica por qué no hay objetivo en vez de inventarlo', () => {
    expect(resolveTargetWatts(null, references)).toMatchObject({ status: 'missing' });
    expect(resolveTargetWatts({ kind: 'percent', percent: 100, reference: 'Pmáx', referenceAssumed: false, unknownReference: null, progressive: false }, references))
      .toMatchObject({ status: 'missing', reason: expect.stringContaining('Pmáx') });
    expect(resolveTargetWatts({ kind: 'percent', percent: 100, reference: null, referenceAssumed: false, unknownReference: "P1'", progressive: false }, references))
      .toMatchObject({ status: 'missing', reason: expect.stringContaining("P1'") });
    expect(resolveTargetWatts({ kind: 'zone', zone: 3 }, { ...references, powerZones: null })).toMatchObject({ status: 'missing' });
  });
});

describe('defaultSelection', () => {
  it('elige solo los intervalos de trabajo cuya duración encaja con la pauta', () => {
    const intervals = [interval(0, 900, 150, 'RECOVERY'), interval(1, 30, 500), interval(2, 175, 260), interval(3, 180, 255), interval(4, 400, 230), interval(5, 185, 250)];
    expect(defaultSelection(intervals, 180, 5)).toEqual([2, 3, 5]);
  });

  it('no pasa de las repeticiones prescritas', () => {
    const intervals = [interval(0, 180, 260), interval(1, 180, 255), interval(2, 180, 250)];
    expect(defaultSelection(intervals, 180, 2)).toEqual([0, 1]);
  });

  it('no elige nada si ningún intervalo encaja, en vez de promediarlos todos', () => {
    const intervals = [interval(0, 103, 236), interval(1, 108, 213)];
    expect(defaultSelection(intervals, 1500, 2)).toEqual([]);
  });
});

describe('evaluateCompliance', () => {
  it('pondera la potencia por el tiempo de cada serie', () => {
    const result = evaluateCompliance([interval(0, 100, 300), interval(1, 300, 200)], { status: 'ok', watts: 200, lowWatts: null, highWatts: null, basis: '' }, { repetitions: 3, repSeconds: 200 });
    expect(result).toMatchObject({ count: 2, meanSeconds: 200, meanWatts: 225, powerPercent: 112.5, durationPercent: 100, missingRepetitions: 1 });
  });

  it('da por cumplida una zona si la media cae dentro de ella', () => {
    const result = evaluateCompliance([interval(0, 3600, 175)], { status: 'ok', watts: 156, lowWatts: 132, highWatts: 180, basis: '' }, { repetitions: 1, repSeconds: 3600 });
    expect(result.powerVerdict.tone).toBe('good');
  });

  it('sin series no calcula cumplimiento', () => {
    const result = evaluateCompliance([], { status: 'ok', watts: 200, lowWatts: null, highWatts: null, basis: '' }, { repetitions: 2, repSeconds: 1500 });
    expect(result).toMatchObject({ count: 0, meanWatts: null, powerPercent: null });
  });
});

describe('verdictFor', () => {
  it('usa las bandas del dashboard: ±5 % en objetivo, ±12 % cerca, más allá lejos', () => {
    expect(verdictFor(104)).toEqual({ label: 'En objetivo', tone: 'good' });
    expect(verdictFor(90)).toEqual({ label: 'Por debajo', tone: 'mid' });
    expect(verdictFor(113)).toEqual({ label: 'Muy por encima', tone: 'bad' });
    expect(verdictFor(null)).toEqual({ label: 'Sin dato', tone: 'none' });
  });
});

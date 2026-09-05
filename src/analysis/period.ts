import type { AnalysisPeriod, ResolvedPeriod } from './types';

export type { AnalysisPeriod, ResolvedPeriod } from './types';

const PRESETS = new Set<30 | 90 | 180 | 365>([30, 90, 180, 365]);
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function parseDateOnly(value: unknown, label: string): Date {
  if (typeof value !== 'string') throw new Error(`${label} debe ser una fecha válida (AAAA-MM-DD).`);
  const match = DATE_ONLY.exec(value);
  if (!match) throw new Error(`${label} debe ser una fecha válida (AAAA-MM-DD).`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} debe ser una fecha válida (AAAA-MM-DD).`);
  }
  return parsed;
}

export function isValidDateOnly(value: unknown): value is string {
  try {
    parseDateOnly(value, 'La fecha');
    return true;
  } catch {
    return false;
  }
}

export function validateAnalysisPeriodShape(period: unknown): period is AnalysisPeriod {
  if (typeof period !== 'object' || period === null || Array.isArray(period)) return false;
  const candidate = period as Record<string, unknown>;
  if (candidate.preset === 'custom') {
    if (Object.keys(candidate).length !== 3) return false;
    if (!isValidDateOnly(candidate.oldest) || !isValidDateOnly(candidate.newest)) return false;
    const oldest = parseDateOnly(candidate.oldest, 'La fecha inicial');
    const newest = parseDateOnly(candidate.newest, 'La fecha final');
    const days = Math.round((newest.getTime() - oldest.getTime()) / DAY_MS) + 1;
    return oldest.getTime() <= newest.getTime() && days <= 730;
  }
  return Object.keys(candidate).length === 1 && PRESETS.has(candidate.preset as never);
}

export function resolvePeriod(period: AnalysisPeriod, today: string): ResolvedPeriod {
  const newestDate = parseDateOnly(today, 'La fecha de hoy');
  const newest = today;

  if (typeof period !== 'object' || period === null || Array.isArray(period)) {
    throw new Error('Periodo no válido.');
  }

  const periodKeys = Object.keys(period as unknown as Record<string, unknown>);

  if (period.preset !== 'custom') {
    if (periodKeys.length !== 1 || !PRESETS.has(period.preset)) throw new Error('El periodo debe ser de 30, 90, 180 o 365 días.');
    const days = period.preset;
    const oldestDate = new Date(newestDate.getTime() - (days - 1) * DAY_MS);
    return { oldest: toDateOnly(oldestDate), newest, days };
  }

  if (periodKeys.length !== 3) throw new Error('Periodo personalizado no válido.');
  const oldestDate = parseDateOnly(period.oldest, 'La fecha inicial');
  const customNewestDate = parseDateOnly(period.newest, 'La fecha final');
  if (oldestDate.getTime() > customNewestDate.getTime()) {
    throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
  }
  if (customNewestDate.getTime() > newestDate.getTime() || oldestDate.getTime() > newestDate.getTime()) {
    throw new Error('Las fechas no pueden ser futuras.');
  }
  const days = Math.round((customNewestDate.getTime() - oldestDate.getTime()) / DAY_MS) + 1;
  if (days > 730) throw new Error('El periodo personalizado no puede superar 730 días.');
  return { oldest: period.oldest, newest: period.newest, days };
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

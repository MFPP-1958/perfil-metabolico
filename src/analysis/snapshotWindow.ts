import { isValidDateOnly } from './period';
import type { ResolvedPeriod } from './types';

const DAY_MS = 86_400_000;

/**
 * Cómo se pidió la ventana. Los periodos predefinidos («los últimos 90 días»)
 * son deslizantes: sus dos extremos avanzan cada día, así que una instantánea
 * nunca vuelve a coincidir al día siguiente de tomarla. Un periodo personalizado
 * nombra dos fechas concretas y solo lo satisface esa misma ventana.
 */
export type WindowKind = 'rolling' | 'fixed';

export interface SnapshotWindow {
  oldest: string;
  newest: string;
}

/**
 * Candidatas que se traen cuando la ventana es deslizante. Vienen ordenadas de
 * más reciente a más antigua y solo las primeras pueden caer dentro del retraso
 * admitido, así que ocho sobran.
 */
export const ROLLING_CANDIDATES = 8;

/** Lee las fechas de una fila de instantánea sin confiar en su forma. */
export function snapshotWindowOf(row: unknown): SnapshotWindow | null {
  if (typeof row !== 'object' || row === null) return null;
  const { oldest, newest } = row as Record<string, unknown>;
  if (typeof oldest !== 'string' || typeof newest !== 'string') return null;
  return { oldest, newest };
}

function toDayNumber(value: string): number {
  if (!isValidDateOnly(value)) throw new Error('La fecha debe ser válida (AAAA-MM-DD).');
  return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) / DAY_MS;
}

/** Duración en días de una ventana, contando ambos extremos. */
export function windowSpanDays(window: SnapshotWindow): number {
  return toDayNumber(window.newest) - toDayNumber(window.oldest) + 1;
}

/** Días que le faltan al final de la instantánea para alcanzar el final pedido. */
export function snapshotLagDays(snapshot: SnapshotWindow, period: ResolvedPeriod): number {
  return toDayNumber(period.newest) - toDayNumber(snapshot.newest);
}

/**
 * Retraso máximo que aún deja a la instantánea representar el periodo pedido.
 * Una décima parte del periodo, nunca menos de una semana: un análisis de 365
 * días sigue siendo representativo un mes después, uno de 30 no.
 */
export function maxLagDays(period: ResolvedPeriod): number {
  return Math.max(7, Math.round(period.days / 10));
}

/**
 * Si la instantánea responde a la misma pregunta que plantea el periodo.
 *
 * Nunca relaja el ciclista ni el entorno: eso lo comprueba quien llama. Y nunca
 * reetiqueta la ventana, porque la instantánea conserva sus fechas reales y quien
 * la muestra debe enseñarlas.
 */
function formatDay(value: string): string {
  const [year, month, day] = value.split('-');
  return `${Number(day)}/${Number(month)}/${year}`;
}

/**
 * Texto que advierte de que lo mostrado no llega hasta el final del periodo
 * pedido. Devuelve null cuando sí llega, para no dar avisos vacíos.
 *
 * Existe porque la instantánea se acepta aunque se haya tomado días antes, y
 * quien la lea tiene que saber qué días cubre de verdad.
 */
export function staleWindowNotice(snapshot: SnapshotWindow, period: ResolvedPeriod): string | null {
  const lag = snapshotLagDays(snapshot, period);
  if (lag <= 0) return null;
  const retraso = lag === 1 ? 'un día' : `${lag} días`;
  return `Esta curva se tomó del ${formatDay(snapshot.oldest)} al ${formatDay(snapshot.newest)}:`
    + ` le faltan ${retraso} para llegar a hoy. Sincroniza si quieres incluirlos.`;
}

export function snapshotFitsPeriod(
  snapshot: SnapshotWindow,
  period: ResolvedPeriod,
  kind: WindowKind,
): boolean {
  if (kind === 'fixed') {
    return snapshot.oldest === period.oldest && snapshot.newest === period.newest;
  }
  if (windowSpanDays(snapshot) !== period.days) return false;
  const lag = snapshotLagDays(snapshot, period);
  return lag >= 0 && lag <= maxLagDays(period);
}

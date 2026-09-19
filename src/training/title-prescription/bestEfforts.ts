import type { DetectedInterval } from './compliance';

/** Señal de la actividad segundo a segundo, tal como la guarda Intervals.icu. */
export interface PowerStream {
  /** Segundos desde el inicio; salta cuando el ciclista se para. */
  time: readonly number[];
  watts: readonly (number | null)[];
  heartRate: readonly (number | null)[] | null;
  cadence: readonly (number | null)[] | null;
}

/** Una parada más larga que esto separa dos esfuerzos: un bloque no puede contenerla. */
export const MAX_PAUSE_SECONDS = 30;
// Límite de trabajo: 60 repeticiones sobre 6 h de señal siguen siendo instantáneas.
const MAX_REPETITIONS = 60;

function average(values: readonly (number | null)[] | null, start: number, end: number) {
  if (!values) return null;
  let sum = 0;
  let count = 0;
  for (let index = start; index < end; index += 1) {
    const value = values[index];
    if (value != null && Number.isFinite(value)) { sum += value; count += 1; }
  }
  return count ? sum / count : null;
}

/**
 * Los `count` bloques de `durationSeconds` que, sin solaparse, dan la mayor
 * potencia total. Sirve cuando Intervals.icu no separa las series: trocea los
 * esfuerzos largos y no detecta los continuos.
 *
 * Se elige el mejor conjunto, no el mejor bloque primero: el mejor bloque
 * suelto suele caer a caballo entre dos series y deja sin sitio a la otra.
 * Si no caben todos, devuelve los que caben. Los huecos sin potencia cuentan
 * como cero, igual que en un potenciómetro.
 */
export function findBestEfforts(stream: PowerStream, durationSeconds: number, count: number): DetectedInterval[] {
  const length = Math.round(durationSeconds);
  const wanted = Math.min(Math.floor(count), MAX_REPETITIONS);
  const samples = stream.watts.length;
  if (length < 1 || wanted < 1 || samples < length || stream.time.length !== samples) return [];

  const prefix = new Float64Array(samples + 1);
  for (let index = 0; index < samples; index += 1) prefix[index + 1] = prefix[index] + (stream.watts[index] ?? 0);
  const valid = new Uint8Array(samples);
  for (let start = 0; start + length <= samples; start += 1) {
    valid[start] = stream.time[start + length - 1] - stream.time[start] <= length - 1 + MAX_PAUSE_SECONDS ? 1 : 0;
  }

  // best[k][i]: mayor potencia total con k bloques dentro de las primeras i muestras.
  const impossible = -Infinity;
  const best: Float64Array[] = [new Float64Array(samples + 1)];
  const takes: Uint8Array[] = [new Uint8Array(samples + 1)];
  for (let blocks = 1; blocks <= wanted; blocks += 1) {
    const row = new Float64Array(samples + 1).fill(impossible);
    const take = new Uint8Array(samples + 1);
    const previous = best[blocks - 1];
    for (let end = 1; end <= samples; end += 1) {
      row[end] = row[end - 1];
      const start = end - length;
      if (start >= 0 && valid[start] && previous[start] !== impossible) {
        const total = previous[start] + prefix[end] - prefix[start];
        if (total > row[end]) { row[end] = total; take[end] = 1; }
      }
    }
    best.push(row);
    takes.push(take);
  }

  let blocks = wanted;
  while (blocks > 0 && best[blocks][samples] === impossible) blocks -= 1;
  const starts: number[] = [];
  for (let end = samples; blocks > 0 && end > 0;) {
    if (takes[blocks][end]) { starts.push(end - length); end -= length; blocks -= 1; } else end -= 1;
  }

  return starts.sort((left, right) => left - right).map((start, index) => ({
    index,
    type: 'WORK',
    startSeconds: stream.time[start],
    movingSeconds: length,
    averageWatts: (prefix[start + length] - prefix[start]) / length,
    averageHeartRate: average(stream.heartRate, start, start + length),
    averageCadence: average(stream.cadence, start, start + length),
  }));
}

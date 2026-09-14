import { z } from 'zod';
import { activitySchema, athleteSchema, plannedWorkoutSchema, powerCurveSchema } from './schemas';

export type DurabilityCurveLevel = 'fresh' | 'kj0' | 'kj1';

export interface NormalizedDurabilityCurve {
  level: DurabilityCurveLevel;
  afterKj: number | null;
  weightKg: number | null;
  points: Array<{
    seconds: number;
    watts: number;
    activityId: string | null;
    supportingActivityIds: string[];
    supportingEffortCount: number;
    startIndex: number | null;
    endIndex: number | null;
  }>;
}

export interface NormalizedDurabilityCurves {
  fresh: NormalizedDurabilityCurve | null;
  fatigued: NormalizedDurabilityCurve[];
  rejected: DurabilityCurveLevel[];
}

const durabilityCurveResponseSchema = z.object({ list: z.array(z.unknown()).min(1) }).loose();
const supportingValuesSchema = z.array(z.number().finite());
const supportingActivityIdsSchema = z.array(z.string());

function durabilityCurveLevel(id: string): DurabilityCurveLevel {
  if (id.endsWith('-kj0')) return 'kj0';
  if (id.endsWith('-kj1')) return 'kj1';
  return 'fresh';
}

function mapSupportingActivityIds(
  primaryActivityId: string | undefined,
  submaxValues: unknown[] | undefined,
  submaxActivityIds: unknown[] | undefined,
  index: number,
) {
  const primary = primaryActivityId == null ? [] : [primaryActivityId];
  const values = supportingValuesSchema.safeParse(submaxValues?.[index]);
  const activities = supportingActivityIdsSchema.safeParse(submaxActivityIds?.[index]);
  if (!values.success || !activities.success || values.data.length !== activities.data.length) {
    return { activityIds: primary, effortCount: 1 };
  }
  return {
    activityIds: [...new Set([...primary, ...activities.data])],
    effortCount: 1 + activities.data.length,
  };
}

function mapDurabilityCurve(curve: z.infer<typeof powerCurveSchema>, level: DurabilityCurveLevel): NormalizedDurabilityCurve {
  const values = curve.values ?? curve.watts ?? [];
  return {
    level,
    afterKj: curve.after_kj ?? null,
    weightKg: curve.weight ?? null,
    points: curve.secs.flatMap((seconds, index) => {
      const watts = values[index];
      if (seconds <= 0 || watts <= 0) return [];
      const supporting = mapSupportingActivityIds(
        curve.activity_id?.[index],
        curve.submax_values,
        curve.submax_activity_id,
        index,
      );
      return [{
        seconds,
        watts,
        activityId: curve.activity_id?.[index] ?? null,
        supportingActivityIds: supporting.activityIds,
        supportingEffortCount: supporting.effortCount,
        startIndex: curve.start_index?.[index] ?? null,
        endIndex: curve.end_index?.[index] ?? null,
      }];
    }),
  };
}

export function mapDurabilityCurves(input: unknown): NormalizedDurabilityCurves {
  const response = durabilityCurveResponseSchema.parse(input);
  let fresh: NormalizedDurabilityCurve | null = null;
  const fatigued: NormalizedDurabilityCurve[] = [];
  const rejected: DurabilityCurveLevel[] = [];

  for (const rawCurve of response.list) {
    const id = z.object({ id: z.string() }).safeParse(rawCurve);
    if (!id.success) continue;
    const level = durabilityCurveLevel(id.data.id);
    const curve = powerCurveSchema.safeParse(rawCurve);
    if (!curve.success) {
      rejected.push(level);
      continue;
    }
    const mapped = mapDurabilityCurve(curve.data, level);
    if (!mapped.points.length || (level !== 'fresh' && mapped.afterKj === null)) {
      rejected.push(level);
      continue;
    }
    if (level === 'fresh') fresh = mapped;
    else fatigued.push(mapped);
  }

  return {
    fresh,
    fatigued: fatigued.sort((left, right) => left.level.localeCompare(right.level)),
    rejected,
  };
}

export interface ImportedMetric {
  metricCode: 'ftp' | 'w_prime';
  value: number;
  unit: 'W' | 'kJ';
  sourceField: string;
  quality: 'imported_estimate';
}

export function mapSportSettings(input: unknown) {
  const athlete = athleteSchema.parse(input);
  const cycling = athlete.sportSettings.find((setting) => setting.types.includes('Ride'));
  const metrics: ImportedMetric[] = [];
  if (cycling?.ftp != null) metrics.push({ metricCode: 'ftp', value: cycling.ftp, unit: 'W', sourceField: 'sportSettings[Ride].ftp', quality: 'imported_estimate' });
  if (cycling?.w_prime != null) metrics.push({ metricCode: 'w_prime', value: cycling.w_prime / 1000, unit: 'kJ', sourceField: 'sportSettings[Ride].w_prime', quality: 'imported_estimate' });
  return { athleteSourceId: athlete.id, metrics };
}

export function mapPowerCurve(input: unknown) {
  const response = durabilityCurveResponseSchema.parse(input);
  const rawCurve = response.list.find((candidate) => {
    const id = z.object({ id: z.string() }).safeParse(candidate);
    return id.success && durabilityCurveLevel(id.data.id) === 'fresh';
  });
  const curve = powerCurveSchema.parse(rawCurve);
  const values = curve.values ?? curve.watts ?? [];
  const bestWattsByDuration = new Map<number, number>();
  curve.secs.forEach((seconds, index) => {
    const watts = values[index];
    if (seconds <= 0 || watts <= 0) return;
    bestWattsByDuration.set(seconds, Math.max(watts, bestWattsByDuration.get(seconds) ?? 0));
  });
  return {
    period: { start: curve.start_date_local ?? null, end: curve.end_date_local ?? null },
    points: [...bestWattsByDuration.entries()].sort(([left], [right]) => left - right).map(([seconds, watts], index) => ({
      seconds,
      watts,
      metricCode: seconds === 5 ? 'power_5s' as const : 'power_duration_point' as const,
      sourceField: `normalized.points[${index}]`,
    })),
    models: curve.powerModels.map((model) => ({
      type: model.type,
      cpWatts: model.criticalPower ?? null,
      wPrimeKj: model.wPrime == null ? null : model.wPrime / 1000,
      pmaxWatts: model.pMax ?? null,
      ftpWatts: model.ftp ?? null,
      r2: model.r2 ?? null,
      sourceField: 'list[0].powerModels',
    })).sort((left, right) => {
      const leftKey = JSON.stringify([left.type, left.cpWatts, left.wPrimeKj, left.pmaxWatts, left.ftpWatts, left.r2]);
      const rightKey = JSON.stringify([right.type, right.cpWatts, right.wPrimeKj, right.pmaxWatts, right.ftpWatts, right.r2]);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
    estimatedVo2max: curve.vo2max_5m ?? null,
  };
}

export function mapActivity(input: unknown) {
  const result = activitySchema.safeParse(input);
  if (!result.success) throw new Error('La actividad de Intervals.icu no tiene una forma válida.');
  const activity = result.data;
  return {
    sourceId: activity.id,
    athleteSourceId: activity.icu_athlete_id,
    name: activity.name,
    sport: activity.type,
    startedAt: activity.start_date,
    durationSeconds: activity.moving_time,
    distanceMetres: activity.distance ?? null,
    indoor: activity.trainer ?? null,
    deviceWatts: activity.device_watts ?? null,
    averagePowerWatts: activity.icu_average_watts ?? null,
    averageHeartRateBpm: activity.average_heartrate ?? null,
    averageCadenceRpm: activity.average_cadence ?? null,
    source: 'intervals_icu' as const,
  };
}

export function mapPlannedWorkout(input: unknown) {
  const workout = plannedWorkoutSchema.parse(input);
  return {
    sourceId: String(workout.id),
    athleteSourceId: workout.athlete_id,
    scheduledAt: workout.start_date_local,
    name: workout.name,
    category: workout.category,
    blocks: (workout.workout_doc?.steps ?? []).map((step, index) => ({
      order: index,
      durationSeconds: step.duration,
      targetMin: step.power?.start ?? null,
      targetMax: step.power?.end ?? null,
      targetUnit: step.power?.units ?? null,
    })),
  };
}

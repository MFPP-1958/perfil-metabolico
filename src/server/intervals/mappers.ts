import { activitySchema, athleteSchema, plannedWorkoutSchema, powerCurveResponseSchema } from './schemas';

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
  const curve = powerCurveResponseSchema.parse(input).list[0];
  const values = curve.values ?? curve.watts ?? [];
  return {
    period: { start: curve.start_date_local ?? null, end: curve.end_date_local ?? null },
    points: curve.secs.map((seconds, index) => ({
      seconds,
      watts: values[index],
      metricCode: seconds === 5 ? 'power_5s' as const : 'power_duration_point' as const,
      sourceField: `list[0].${curve.values ? 'values' : 'watts'}[${index}]`,
    })),
    models: curve.powerModels.map((model) => ({
      type: model.type,
      cpWatts: model.criticalPower ?? null,
      wPrimeKj: model.wPrime == null ? null : model.wPrime / 1000,
      pmaxWatts: model.pMax ?? null,
      ftpWatts: model.ftp ?? null,
      r2: model.r2 ?? null,
      sourceField: 'list[0].powerModels',
    })),
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

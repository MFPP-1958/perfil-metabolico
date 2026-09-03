import { z } from 'zod';

const nullableNumber = z.number().finite().nullable().optional();

export const sportSettingSchema = z.object({
  types: z.array(z.string()),
  ftp: nullableNumber,
  w_prime: nullableNumber,
}).loose();

export const athleteSchema = z.object({
  id: z.string().regex(/^i\d+$/),
  name: z.string().min(1),
  icu_weight: nullableNumber,
  sportSettings: z.array(sportSettingSchema).default([]),
}).loose();

export const powerModelSchema = z.object({
  type: z.enum(['ECP', 'MORTON_3P']),
  criticalPower: nullableNumber,
  wPrime: nullableNumber,
  pMax: nullableNumber,
  ftp: nullableNumber,
  r2: nullableNumber,
}).loose();

export const powerCurveSchema = z.object({
  id: z.string(),
  start_date_local: z.string().optional(),
  end_date_local: z.string().optional(),
  weight: nullableNumber,
  secs: z.array(z.number().int().positive()),
  values: z.array(z.number().finite()).optional(),
  watts: z.array(z.number().finite()).optional(),
  vo2max_5m: nullableNumber,
  powerModels: z.array(powerModelSchema).default([]),
}).loose().refine((curve) => (curve.values ?? curve.watts)?.length === curve.secs.length, {
  message: 'La curva no contiene pares completos de duración y potencia.',
});

export const powerCurveResponseSchema = z.object({ list: z.array(powerCurveSchema).min(1) }).loose();

export const activitySchema = z.object({
  id: z.string().regex(/^i?\d+$/),
  icu_athlete_id: z.string().regex(/^i\d+$/),
  name: z.string().default('Actividad sin nombre'),
  type: z.string(),
  start_date: z.string(),
  moving_time: z.number().int().nonnegative(),
  distance: nullableNumber,
  trainer: z.boolean().nullable().optional(),
  icu_average_watts: nullableNumber,
  average_heartrate: nullableNumber,
  average_cadence: nullableNumber,
}).loose();

export const plannedWorkoutSchema = z.object({
  id: z.union([z.string(), z.number()]),
  athlete_id: z.string().regex(/^i\d+$/),
  start_date_local: z.string(),
  name: z.string(),
  category: z.string(),
  workout_doc: z.object({
    steps: z.array(z.object({
      duration: z.number().positive(),
      power: z.object({
        start: z.number(),
        end: z.number(),
        units: z.string(),
      }).optional(),
    }).loose()),
  }).optional(),
}).loose();

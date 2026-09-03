import { z } from 'zod';
import { metricCatalog } from './metrics';

const metricCodes = Object.keys(metricCatalog) as [keyof typeof metricCatalog, ...(keyof typeof metricCatalog)[]];

export const observationSchema = z.object({
  id: z.uuid(),
  athleteId: z.uuid(),
  metricCode: z.enum(metricCodes),
  value: z.number().finite(),
  unit: z.string().min(1),
  observedAt: z.iso.datetime(),
  origin: z.enum(['manual', 'intervals_icu', 'laboratory', 'field_test', 'device', 'calculated']),
  quality: z.enum(['measured', 'imported_estimate', 'calculated', 'incomplete', 'rejected']),
  protocol: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  notes: z.string().max(2_000).optional(),
}).superRefine((observation, context) => {
  const definition = metricCatalog[observation.metricCode];
  if (observation.unit !== definition.unit) {
    context.addIssue({ code: 'custom', path: ['unit'], message: `La unidad de ${definition.label} debe ser ${definition.unit}.` });
  }
  if (observation.value < definition.min || observation.value > definition.max) {
    context.addIssue({ code: 'custom', path: ['value'], message: `El valor está fuera del rango admisible para ${definition.label}.` });
  }
});

export type Observation = z.infer<typeof observationSchema>;

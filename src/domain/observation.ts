import { z } from 'zod';
import { metricCatalog } from './metrics';

const metricCodes = Object.keys(metricCatalog) as [keyof typeof metricCatalog, ...(keyof typeof metricCatalog)[]];

export const observationSchema = z.object({
  id: z.uuid(),
  athleteId: z.uuid(),
  metricCode: z.enum(metricCodes),
  value: z.number().finite(),
  unit: z.string().min(1),
  observedAt: z.iso.datetime({ offset: true }),
  origin: z.enum(['manual', 'intervals_icu', 'laboratory', 'field_test', 'device', 'calculated', 'external_model']),
  quality: z.enum(['measured', 'imported_estimate', 'calculated', 'incomplete', 'rejected']),
  protocol: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  /** Solo para `external_model`: nombra el programa de terceros que produjo el valor. */
  sourceReference: z.object({
    software: z.string().min(1),
    version: z.string().min(1).optional(),
  }).optional(),
  notes: z.string().max(2_000).optional(),
}).superRefine((observation, context) => {
  if (observation.origin === 'external_model' && !observation.sourceReference) {
    context.addIssue({ code: 'custom', path: ['sourceReference'], message: 'Un valor producido por software de terceros debe nombrar el programa que lo calculó.' });
  }
  if (observation.origin !== 'external_model' && observation.sourceReference) {
    context.addIssue({ code: 'custom', path: ['sourceReference'], message: 'Solo un valor de origen external_model puede nombrar un programa externo.' });
  }
  const definition = metricCatalog[observation.metricCode];
  if (observation.unit !== definition.unit) {
    context.addIssue({ code: 'custom', path: ['unit'], message: `La unidad de ${definition.label} debe ser ${definition.unit}.` });
  }
  if (observation.value < definition.min || observation.value > definition.max) {
    context.addIssue({ code: 'custom', path: ['value'], message: `El valor está fuera del rango admisible para ${definition.label}.` });
  }
});

export type Observation = z.infer<typeof observationSchema>;

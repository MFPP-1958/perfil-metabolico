import { prescriptionRules } from './rules';

export interface PrescriptionEvidence {
  metricCode: string;
  value: number;
  unit: string;
  observationId: string;
  quality: 'measured' | 'calculated' | 'imported_estimate';
}

export interface PrescriptionContext {
  athleteId: string;
  age: number;
  goal: string;
  phase?: 'base' | 'desarrollo' | 'competición' | 'recuperación';
  availableDays: number;
  evidence: PrescriptionEvidence[];
}

export interface PrescriptionDraft {
  id: string;
  status: 'draft';
  athleteId: string;
  goal: string;
  phase: NonNullable<PrescriptionContext['phase']>;
  sessions: Array<(typeof prescriptionRules)[number]>;
  evidenceSnapshot: PrescriptionEvidence[];
  safeguards: string[];
  createdAt: string;
  approval?: never;
}

export type PrescriptionGeneration = PrescriptionDraft | { status: 'blocked'; reasons: string[] };
export type ApprovedPrescription = Omit<PrescriptionDraft, 'status' | 'approval'> & {
  status: 'approved';
  approval: { coachId: string; at: string };
  auditAction: 'prescription.approved';
};

export function generatePrescriptionDraft(context: PrescriptionContext): PrescriptionGeneration {
  const reasons: string[] = [];
  if (!context.goal.trim()) reasons.push('Falta el objetivo del ciclista.');
  if (!context.phase) reasons.push('Falta la fase de entrenamiento.');
  if (!Number.isInteger(context.availableDays) || context.availableDays < 1) reasons.push('Falta una disponibilidad semanal válida.');
  if (!context.evidence.length) reasons.push('Faltan datos aprobados para justificar la propuesta.');
  if (reasons.length || !context.phase) return { status: 'blocked', reasons };
  const safeguards = context.age < 18
    ? ['En menores se describe la respuesta actual sin etiquetas permanentes ni asignación automática de modalidad.', 'Requiere supervisión y consentimiento conforme a la política del club.']
    : ['Revisar carga reciente, salud y disponibilidad antes de programar.'];
  return {
    id: `draft-${context.athleteId}-${Date.now()}`, status: 'draft', athleteId: context.athleteId,
    goal: context.goal, phase: context.phase, sessions: [prescriptionRules[0]],
    evidenceSnapshot: context.evidence.map((item) => ({ ...item })), safeguards, createdAt: new Date().toISOString(),
  };
}

export function approvePrescription(draft: PrescriptionDraft, approval: { coachId: string; at: string }): ApprovedPrescription {
  if (!approval.coachId || Number.isNaN(Date.parse(approval.at))) throw new Error('La aprobación necesita entrenador y fecha válidos.');
  return { ...draft, status: 'approved', approval: { ...approval }, evidenceSnapshot: draft.evidenceSnapshot.map((item) => ({ ...item })), auditAction: 'prescription.approved' };
}

import { describe, expect, it } from 'vitest';
import { approvePrescription, generatePrescriptionDraft } from './generate';

const context = {
  athleteId: 'athlete-1', age: 29, goal: 'Mejorar potencia aeróbica', phase: 'desarrollo' as const,
  availableDays: 4, evidence: [{ metricCode: 'p_vo2max', value: 400, unit: 'W', observationId: 'obs-1', quality: 'measured' as const }],
};

describe('prescription workflow', () => {
  it('blocks generation without goal, phase or availability', () => {
    expect(generatePrescriptionDraft({ ...context, goal: '' }).status).toBe('blocked');
    expect(generatePrescriptionDraft({ ...context, phase: undefined }).status).toBe('blocked');
    expect(generatePrescriptionDraft({ ...context, availableDays: 0 }).status).toBe('blocked');
  });

  it('creates only a draft with rationale, dosage and stop criteria', () => {
    const result = generatePrescriptionDraft(context);
    expect(result.status).toBe('draft');
    if (result.status !== 'draft') return;
    expect(result.approval).toBeUndefined();
    expect(result.sessions[0].rationale).toBeTruthy();
    expect(result.sessions[0].stopCriteria.length).toBeGreaterThan(0);
    expect(result.evidenceSnapshot[0].observationId).toBe('obs-1');
  });

  it('requires an explicit coach action to approve with an immutable snapshot', () => {
    const draft = generatePrescriptionDraft(context);
    if (draft.status !== 'draft') throw new Error('expected draft');
    const approved = approvePrescription(draft, { coachId: 'coach-1', at: '2026-09-03T16:00:00Z' });
    expect(approved.status).toBe('approved');
    expect(approved.approval.coachId).toBe('coach-1');
    expect(approved.auditAction).toBe('prescription.approved');
  });

  it('does not assign a permanent phenotype or specialization to a minor', () => {
    const result = generatePrescriptionDraft({ ...context, age: 16, goal: 'Mejorar sprint' });
    expect(JSON.stringify(result)).not.toMatch(/fenotipo|especialista|especialización/i);
  });
});

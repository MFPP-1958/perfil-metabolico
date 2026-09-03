import { describe, expect, it } from 'vitest';
import { buildReportSnapshot } from './build-report';

const data = {
  athleteId: 'a1', athleteName: 'Ciclista de prueba', generatedAt: '2026-09-03T16:00:00Z',
  results: [{ id: 'r1', metric: 'CP', value: 305, unit: 'W', status: 'approved' as const, modelVersion: 'ecp@1.0.0', source: 'Intervals.icu', limitation: 'Estimación dependiente de la cobertura de esfuerzos.' }],
  prescription: { id: 'p1', status: 'approved' as const, summary: '4 × 4 min de potencia aeróbica.', approvedBy: 'coach-1' },
};

describe('report snapshots', () => {
  it.each(['coach', 'cyclist', 'family'] as const)('builds the %s audience variant', (audience) => {
    const report = buildReportSnapshot(audience, data);
    expect(report.status).toBe('ready');
    if (report.status !== 'ready') return;
    expect(report.snapshot.audience).toBe(audience);
    expect(report.snapshot.approvedResultIds).toEqual(['r1']);
    expect(report.snapshot.modelVersions.r1).toBe('ecp@1.0.0');
    expect(report.citations).toContain('Intervals.icu');
  });

  it('blocks unapproved results and prescriptions', () => {
    expect(buildReportSnapshot('coach', { ...data, results: [{ ...data.results[0], status: 'draft' }] }).status).toBe('blocked');
    expect(buildReportSnapshot('coach', { ...data, prescription: { ...data.prescription, status: 'draft' } }).status).toBe('blocked');
  });
});

import type { ReportSnapshot } from '../domain/report';

export type ReportAudience = ReportSnapshot['audience'];
export interface ReportData {
  athleteId: string;
  athleteName: string;
  generatedAt: string;
  results: Array<{ id: string; metric: string; value: number; unit: string; status: 'draft' | 'approved'; modelVersion: string; source: string; limitation: string }>;
  prescription?: { id: string; status: 'draft' | 'approved'; summary: string; approvedBy: string };
}

export type BuiltReport = { status: 'blocked'; reasons: string[] } | { status: 'ready'; snapshot: ReportSnapshot; athleteName: string; results: ReportData['results']; prescription?: ReportData['prescription']; citations: string[]; title: string; introduction: string };

const audienceCopy: Record<ReportAudience, { title: string; introduction: string }> = {
  coach: { title: 'Informe para el entrenador', introduction: 'Resultados aprobados, trazabilidad técnica, incertidumbre y decisiones de entrenamiento.' },
  cyclist: { title: 'Informe para el ciclista', introduction: 'Tu estado actual explicado con valores aprobados y sus principales limitaciones.' },
  family: { title: 'Informe para la familia', introduction: 'Una explicación sencilla del seguimiento deportivo, sin etiquetas permanentes ni conclusiones médicas.' },
};

export function buildReportSnapshot(audience: ReportAudience, data: ReportData): BuiltReport {
  const reasons: string[] = [];
  if (!data.results.length) reasons.push('No hay resultados aprobados para informar.');
  if (data.results.some((result) => result.status !== 'approved')) reasons.push('Hay resultados pendientes de aprobación.');
  if (data.prescription && data.prescription.status !== 'approved') reasons.push('La prescripción sigue en borrador.');
  if (reasons.length) return { status: 'blocked', reasons };
  const copy = audienceCopy[audience];
  const snapshot: ReportSnapshot = {
    id: `report-${data.athleteId}-${audience}-${data.generatedAt}`,
    athleteId: data.athleteId, audience, generatedAt: data.generatedAt,
    approvedResultIds: data.results.map((result) => result.id),
    modelVersions: Object.fromEntries(data.results.map((result) => [result.id, result.modelVersion])),
    sections: [
      { title: 'Resultados', body: data.results.map((result) => `${result.metric}: ${result.value} ${result.unit}`).join('; ') },
      ...(data.prescription ? [{ title: 'Trabajo acordado', body: data.prescription.summary }] : []),
      { title: 'Límites', body: data.results.map((result) => result.limitation).join(' ') },
    ],
  };
  return { status: 'ready', snapshot, athleteName: data.athleteName, results: data.results.map((result) => ({ ...result })), prescription: data.prescription ? { ...data.prescription } : undefined, citations: [...new Set(data.results.map((result) => result.source))], ...copy };
}

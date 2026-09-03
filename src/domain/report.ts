export interface ReportSnapshot {
  id: string;
  athleteId: string;
  audience: 'coach' | 'cyclist' | 'family';
  generatedAt: string;
  approvedResultIds: readonly string[];
  modelVersions: Readonly<Record<string, string>>;
  sections: readonly { title: string; body: string }[];
}

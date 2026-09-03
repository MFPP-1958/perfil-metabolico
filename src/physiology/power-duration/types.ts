export interface PowerDurationPoint { seconds: number; watts: number }
export interface PowerDurationInput {
  points: readonly PowerDurationPoint[];
  sport: string;
  period: string;
  indoor: boolean | null;
}
export type PowerDurationModel = 'ECP' | 'MORTON_3P';
export interface CurveQuality { complete: boolean; warnings: string[] }
export interface PowerDurationFit {
  model: PowerDurationModel;
  algorithmVersion: string;
  cpWatts: number;
  wPrimeJoules: number;
  pmaxWatts: number | null;
  observedFiveSecondWatts: number | null;
  rmseWatts: number;
  points: readonly (PowerDurationPoint & { modelledWatts: number; residualWatts: number })[];
  quality: CurveQuality;
  context: Omit<PowerDurationInput, 'points'>;
}

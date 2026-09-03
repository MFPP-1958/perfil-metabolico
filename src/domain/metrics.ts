export const metricCatalog = {
  ftp: { label: 'FTP', unit: 'W', min: 1, max: 800 },
  eftp: { label: 'eFTP', unit: 'W', min: 1, max: 800 },
  cp: { label: 'CP', unit: 'W', min: 1, max: 800 },
  mlss: { label: 'MLSS', unit: 'W', min: 1, max: 800 },
  lt1: { label: 'LT1', unit: 'W', min: 1, max: 700 },
  vt1: { label: 'VT1', unit: 'W', min: 1, max: 700 },
  pmax: { label: 'Pmax', unit: 'W', min: 1, max: 3_000 },
  power_5s: { label: 'Potencia 5 s', unit: 'W', min: 1, max: 3_000 },
  p_vo2max: { label: 'P@VO₂max', unit: 'W', min: 1, max: 1_000 },
  frc: { label: 'FRC', unit: 'kJ', min: 0, max: 100 },
  w_prime: { label: 'W′', unit: 'kJ', min: 0, max: 100 },
  vo2max: { label: 'VO₂max', unit: 'ml·kg⁻¹·min⁻¹', min: 10, max: 100 },
  vlamax: { label: 'VLa máx', unit: 'mmol·l⁻¹·s⁻¹', min: 0, max: 3 },
  peak_accumulation_rate: { label: 'Tasa pico de acumulación', unit: 'mmol·l⁻¹·s⁻¹', min: 0, max: 3 },
  lactate: { label: 'Lactato', unit: 'mmol·l⁻¹', min: 0, max: 30 },
  heart_rate: { label: 'Frecuencia cardiaca', unit: 'bpm', min: 20, max: 260 },
  cadence: { label: 'Cadencia', unit: 'rpm', min: 0, max: 250 },
  rpe: { label: 'RPE', unit: '0-10', min: 0, max: 10 },
  body_mass: { label: 'Masa corporal', unit: 'kg', min: 15, max: 250 },
  tte: { label: 'TTE', unit: 's', min: 1, max: 28_800 },
} as const;

export type MetricCode = keyof typeof metricCatalog;
export type MetricUnit = (typeof metricCatalog)[MetricCode]['unit'];

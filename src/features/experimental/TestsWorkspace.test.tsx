import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisContext, type AnalysisContextValue } from '../../analysis/AnalysisContext';
import type { Observation } from '../../domain/observation';

const chartState = vi.hoisted(() => ({
  configurations: [] as Array<{ data: { datasets: Array<{ label: string; data: Array<{ x: number; y: number }> }> } }>,
  destroy: vi.fn(),
}));

vi.mock('chart.js', () => ({
  Chart: class Chart {
    static register = vi.fn();
    constructor(_canvas: HTMLCanvasElement, configuration: never) {
      chartState.configurations.push(configuration);
    }
    destroy() { chartState.destroy(); }
  },
  LineController: class LineController {},
  LineElement: class LineElement {},
  PointElement: class PointElement {},
  LinearScale: class LinearScale {},
  Tooltip: class Tooltip {},
  Legend: class Legend {},
}));

import { TestsWorkspace } from './TestsWorkspace';

const athleteId = '11111111-1111-4111-8111-111111111111';

function observation(overrides: Partial<Observation>): Observation {
  return {
    id: crypto.randomUUID(), athleteId, metricCode: 'vo2max', value: 68,
    unit: 'ml·kg⁻¹·min⁻¹', observedAt: '2026-09-01T08:00:00.000Z', origin: 'laboratory',
    quality: 'measured', protocol: { name: 'rampa', version: '1' }, ...overrides,
  } as Observation;
}

function renderWith(observations: Observation[], athlete: Partial<AnalysisContextValue['athlete']> = {}) {
  const value = {
    athletes: [], athleteId, period: '90 días', environment: 'all', today: '2026-09-16',
    sync: { status: 'idle' }, loadingRoster: false, loadingAthlete: false, error: '',
    athlete: { id: athleteId, name: 'Jaume Santamaria', observations, ...athlete },
    selectAthlete: () => undefined, setPeriod: () => undefined, setEnvironment: () => undefined,
    synchronize: async () => undefined, reloadRoster: async () => undefined,
    addObservation: async () => undefined, clearError: () => undefined,
  } as unknown as AnalysisContextValue;
  return render(<AnalysisContext.Provider value={value}><TestsWorkspace /></AnalysisContext.Provider>);
}

const perfilCompleto = [
  observation({}),
  observation({ metricCode: 'vlamax', value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', origin: 'external_model', quality: 'calculated', sourceReference: { software: 'WKO5' } }),
  observation({ metricCode: 'body_mass', value: 70, unit: 'kg', origin: 'manual' }),
  observation({ metricCode: 'p_vo2max', value: 400, unit: 'W', origin: 'field_test' }),
];

describe('TestsWorkspace', () => {
  it('nombra al ciclista activo y no ofrece demostración', () => {
    renderWith(perfilCompleto);
    expect(screen.getByText(/Jaume Santamaria/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /demostración/i })).not.toBeInTheDocument();
  });

  it('calcula el modelo de Mader con las observaciones del ciclista', () => {
    renderWith(perfilCompleto);
    expect(screen.getByText('MLSS modelado')).toBeInTheDocument();
    expect(screen.getByText(/WKO5/)).toBeInTheDocument();
  });

  it('dice qué métrica falta y qué protocolo la produce', () => {
    renderWith(perfilCompleto.filter((item) => item.metricCode !== 'p_vo2max'));
    expect(screen.getByRole('alert')).toHaveTextContent(/P@VO₂max/);
    expect(screen.getByRole('alert')).toHaveTextContent(/potencia asociada al VO₂max/i);
    expect(screen.queryByText('MLSS modelado')).not.toBeInTheDocument();
  });

  it('pide seleccionar ciclista cuando no hay ninguno', () => {
    const value = {
      athletes: [], athleteId: '', athlete: null, period: '90 días', environment: 'all',
      today: '2026-09-16', sync: { status: 'idle' }, loadingRoster: false, loadingAthlete: false,
      error: '', selectAthlete: () => undefined, setPeriod: () => undefined,
      setEnvironment: () => undefined, synchronize: async () => undefined,
      reloadRoster: async () => undefined, addObservation: async () => undefined,
      clearError: () => undefined,
    } as unknown as AnalysisContextValue;
    render(<AnalysisContext.Provider value={value}><TestsWorkspace /></AnalysisContext.Provider>);
    expect(screen.getByText(/Selecciona un ciclista/i)).toBeInTheDocument();
  });
});

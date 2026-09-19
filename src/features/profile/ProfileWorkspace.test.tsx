import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisContext, type AnalysisContextValue } from '../../analysis/AnalysisContext';
import type { Observation } from '../../domain/observation';
import { ProfileWorkspace } from './ProfileWorkspace';

const jaumeId = '96a0a55f-bf3a-41d0-a2df-567548bff081';

function obs(id: number, metricCode: Observation['metricCode'], value: number, unit: string, observedAt: string, origin: Observation['origin']): Observation {
  const quality: Observation['quality'] = origin === 'intervals_icu' ? 'imported_estimate' : origin === 'external_model' ? 'calculated' : 'measured';
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, athleteId: jaumeId, metricCode, value, unit, observedAt, origin, quality,
    protocol: { name: 'x', version: '1' },
    ...(origin === 'external_model' ? { sourceReference: { software: 'WKO5' } } : {}),
  };
}

const observations = [
  obs(1, 'ftp', 236, 'W', '2026-09-15T15:45:07Z', 'intervals_icu'),
  obs(2, 'ftp', 239, 'W', '2026-09-16T10:29:10Z', 'field_test'),
  obs(3, 'vo2max', 71.5, 'ml·kg⁻¹·min⁻¹', '2026-09-18T07:07:10Z', 'external_model'),
  obs(4, 'vlamax', 0.3, 'mmol·l⁻¹·s⁻¹', '2026-09-18T07:07:52Z', 'external_model'),
  obs(5, 'p_vo2max', 392, 'W', '2026-09-18T07:08:18Z', 'external_model'),
  obs(6, 'body_mass', 54.8, 'kg', '2026-09-18T07:08:43Z', 'manual'),
];

function context(overrides: Partial<AnalysisContextValue> = {}): AnalysisContextValue {
  return {
    athletes: [{ id: jaumeId, intervalsId: 'i593028', name: 'Jaume Santamaria' }],
    athleteId: jaumeId,
    athlete: { id: jaumeId, intervalsId: 'i593028', name: 'Jaume Santamaria', observations },
    period: { preset: 90 },
    environment: 'all',
    today: '2026-09-19',
    sync: { status: 'idle', synchronizedAt: null },
    loadingRoster: false,
    loadingAthlete: false,
    error: '',
    selectAthlete: vi.fn(),
    setPeriod: vi.fn(),
    setEnvironment: vi.fn(),
    synchronize: vi.fn().mockResolvedValue(undefined),
    reloadRoster: vi.fn().mockResolvedValue(undefined),
    addObservation: vi.fn().mockResolvedValue(true),
    addObservations: vi.fn().mockResolvedValue(true),
    retractObservation: vi.fn().mockResolvedValue(true),
    clearError: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(value = context()) {
  render(<MemoryRouter><AnalysisContext.Provider value={value}><ProfileWorkspace /></AnalysisContext.Provider></MemoryRouter>);
}

describe('ProfileWorkspace', () => {
  it('muestra el perfil de hoy con procedencia, antigüedad y vatios por kilo', () => {
    renderWorkspace();
    expect(screen.getByLabelText('Perfil a fecha')).toHaveValue('2026-09-19');
    const ftp = screen.getByRole('group', { name: 'FTP' });
    expect(ftp).toHaveTextContent('239 W');
    expect(ftp).toHaveTextContent('4,36 W/kg');
    expect(ftp).toHaveTextContent('Test de campo');
    expect(ftp).toHaveTextContent('hace 3 días');
    expect(screen.getByRole('group', { name: 'VO₂max' })).toHaveTextContent('WKO5');
  });

  it('calcula el modelo de Mader con los valores de esa fecha', () => {
    renderWorkspace();
    const mader = screen.getByRole('region', { name: 'Modelo metabólico a esta fecha' });
    expect(mader).toHaveTextContent(/MLSS\s*338 W/);
    expect(mader).toHaveTextContent(/FATmax\s*249 W/);
  });

  it('avisa de que FTP y MLSS modelado no cuadran y señala cuál revisar', () => {
    renderWorkspace();
    const coherence = screen.getByRole('region', { name: 'Coherencia del umbral' });
    expect(coherence).toHaveTextContent('se separan un 42 %');
    expect(coherence).toHaveTextContent('Revisa primero: MLSS modelado (Mader)');
  });

  it('reconstruye el perfil de una fecha pasada', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Perfil a fecha'), { target: { value: '2026-09-15' } });
    expect(screen.getByRole('group', { name: 'FTP' })).toHaveTextContent('236 W');
    expect(screen.queryByRole('group', { name: 'VO₂max' })).not.toBeInTheDocument();
    expect(screen.getByText(/Sin dato a esta fecha:.*VO₂max/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Modelo metabólico a esta fecha' })).getByText(/Faltan datos/)).toBeInTheDocument();
  });

  it('compara con otra fecha', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Comparar con'), { target: { value: '2026-09-15' } });
    expect(screen.getByRole('group', { name: 'FTP' })).toHaveTextContent('+3 W respecto al');
  });

  it('pide elegir ciclista si no hay ninguno', () => {
    renderWorkspace(context({ athleteId: '', athlete: null }));
    expect(screen.getByText(/Selecciona un ciclista/)).toBeInTheDocument();
  });
});

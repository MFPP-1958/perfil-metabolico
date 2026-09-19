import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisContext, type AnalysisContextValue } from '../../analysis/AnalysisContext';
import type { Observation } from '../../domain/observation';
import { DataSourcesWorkspace } from './DataSourcesWorkspace';

const jaumeId = '96a0a55f-bf3a-41d0-a2df-567548bff081';

function obs(id: number, metricCode: Observation['metricCode'], value: number, unit: string, observedAt: string, origin: Observation['origin'], extra: Partial<Observation> = {}): Observation {
  const quality: Observation['quality'] = origin === 'intervals_icu' ? 'imported_estimate' : origin === 'external_model' ? 'calculated' : 'measured';
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, athleteId: jaumeId, metricCode, value, unit, observedAt, origin, quality,
    protocol: { name: 'x', version: '1' },
    ...(origin === 'external_model' ? { sourceReference: { software: 'WKO5', version: '5.0.16' } } : {}),
    ...extra,
  };
}

const observations = [
  obs(1, 'ftp', 236, 'W', '2026-09-15T15:45:07Z', 'intervals_icu'),
  obs(2, 'ftp', 239, 'W', '2026-09-16T10:29:10Z', 'field_test'),
  obs(3, 'vo2max', 71.5, 'ml·kg⁻¹·min⁻¹', '2026-09-18T07:07:10Z', 'external_model'),
  obs(4, 'body_mass', 54.8, 'kg', '2026-09-18T07:08:43Z', 'manual'),
  obs(5, 'pmax', 1200, 'W', '2026-09-17T07:00:00Z', 'field_test', { retractedAt: '2026-09-18T09:00:00.000Z', retractionReason: 'Pico del potenciómetro' }),
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
  render(<AnalysisContext.Provider value={value}><DataSourcesWorkspace /></AnalysisContext.Provider>);
  return value;
}

describe('DataSourcesWorkspace', () => {
  it('muestra para cada métrica el valor vigente, su fuente y sus alternativas', () => {
    renderWorkspace();
    const table = screen.getByRole('table', { name: 'Valores vigentes por métrica' });
    const ftp = within(table).getByRole('row', { name: /^FTP/ });
    expect(ftp).toHaveTextContent('239 W');
    expect(ftp).toHaveTextContent('Test de campo');
    expect(ftp).toHaveTextContent('1 alternativa');
    const vo2 = within(table).getByRole('row', { name: /^VO₂max/ });
    expect(vo2).toHaveTextContent('71,5 ml·kg⁻¹·min⁻¹');
    expect(vo2).toHaveTextContent('WKO5 5.0.16');
    expect(within(table).getByRole('row', { name: /^VLa máx/ })).toHaveTextContent('Sin dato');
  });

  it('despliega las alternativas de una métrica', async () => {
    renderWorkspace();
    await userEvent.click(screen.getByRole('button', { name: 'Ver 1 alternativa de FTP' }));
    const table = screen.getByRole('table', { name: 'Valores vigentes por métrica' });
    expect(within(table).getByText('236 W')).toBeInTheDocument();
    expect(within(table).getByText(/Estimación de Intervals\.icu/)).toBeInTheDocument();
  });

  it('retira un valor erróneo pidiendo el motivo', async () => {
    const value = renderWorkspace();
    await userEvent.click(screen.getByRole('button', { name: 'Retirar FTP 239 W' }));
    const confirm = screen.getByRole('button', { name: 'Confirmar retirada' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Motivo de la retirada'), 'Test mal ejecutado');
    await userEvent.click(confirm);
    expect(value.retractObservation).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000002', 'Test mal ejecutado');
  });

  it('lista los valores retirados con su motivo', () => {
    renderWorkspace();
    const retired = screen.getByRole('list', { name: 'Valores retirados' });
    expect(retired).toHaveTextContent('Pmax');
    expect(retired).toHaveTextContent('1200 W');
    expect(retired).toHaveTextContent('Pico del potenciómetro');
  });

  it('guarda en lote los valores de WKO5', async () => {
    const value = renderWorkspace();
    await userEvent.type(screen.getByLabelText('mFTP (W)'), '241');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar valores de WKO5' }));
    expect(value.addObservations).toHaveBeenCalledWith([expect.objectContaining({ metricCode: 'mftp', value: 241 })]);
  });

  it('pide elegir ciclista si no hay ninguno', () => {
    renderWorkspace(context({ athleteId: '', athlete: null }));
    expect(screen.getByText(/Selecciona un ciclista/)).toBeInTheDocument();
  });
});

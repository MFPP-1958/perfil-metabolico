import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisContext, type AnalysisContextValue } from '../../analysis/AnalysisContext';
import type { Observation } from '../../domain/observation';
import type { SessionActivity, SessionDetail, SessionsApi } from './sessionsApi';
import { referencesFromObservations } from './sessionFormat';
import { SessionsWorkspace } from './SessionsWorkspace';

const jaumeId = '96a0a55f-bf3a-41d0-a2df-567548bff081';
const vo2Id = '3f0f5c0e-8f1f-4d8e-9d55-1f1b8f7f2a10';
const rideId = '4a1f5c0e-8f1f-4d8e-9d55-1f1b8f7f2a11';
const umbralId = '5b2f5c0e-8f1f-4d8e-9d55-1f1b8f7f2a12';

function observation(metricCode: Observation['metricCode'], value: number, quality: Observation['quality'], observedAt: string): Observation {
  return {
    id: crypto.randomUUID(), athleteId: jaumeId, metricCode, value, unit: 'W', observedAt,
    origin: quality === 'imported_estimate' ? 'intervals_icu' : 'field_test', quality, protocol: { name: 'x', version: '1' },
  };
}

const observations = [
  observation('ftp', 236, 'imported_estimate', '2026-09-15T15:45:07.928Z'),
  observation('ftp', 239, 'measured', '2026-09-16T10:29:10.207Z'),
  { ...observation('p_vo2max', 392, 'calculated', '2026-09-18T07:08:18.809Z'), origin: 'external_model' as const, sourceReference: { software: 'WKO5' } },
];

const activities: SessionActivity[] = [
  { id: vo2Id, startedAt: '2026-09-03T09:47:32+00:00', name: "Segorbe - VO2 max (12')-1 x ( 4 x 3' @ 100% P@VO2max R-3' 60", durationSeconds: 5400, averagePowerWatts: 180, indoor: false },
  { id: rideId, startedAt: '2026-09-12T14:31:14+00:00', name: 'Castellfort Ciclismo en ruta', durationSeconds: 9000, averagePowerWatts: 194, indoor: false },
  { id: umbralId, startedAt: '2026-09-02T07:46:46+00:00', name: "Segorbe - P.Umbral (50') 1 x (2 x 25' @ 200 w R-10' @ 150 w)", durationSeconds: 5400, averagePowerWatts: 190, indoor: true },
];

function interval(index: number, type: string, movingSeconds: number, averageWatts: number) {
  return { index, type, startSeconds: index * 300, movingSeconds, averageWatts, averageHeartRate: 170, averageCadence: 92 };
}

const vo2Detail: SessionDetail = {
  activityId: vo2Id,
  powerZones: [55, 75, 90, 105, 120, 150, 999],
  intervals: [
    interval(0, 'RECOVERY', 1200, 150),
    interval(1, 'WORK', 20, 600),
    interval(2, 'WORK', 180, 370),
    interval(3, 'RECOVERY', 180, 140),
    interval(4, 'WORK', 175, 360),
    interval(5, 'RECOVERY', 180, 140),
    interval(6, 'WORK', 182, 350),
  ],
};

const umbralDetail: SessionDetail = {
  activityId: umbralId,
  powerZones: null,
  intervals: [interval(0, 'WORK', 103, 236), interval(1, 'WORK', 108, 213)],
};

function fakeApi(): SessionsApi {
  return {
    list: vi.fn().mockResolvedValue(activities),
    detail: vi.fn(async ({ activityId }: { activityId: string }) => (activityId === umbralId ? umbralDetail : vo2Detail)),
  };
}

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
    clearError: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(api = fakeApi(), value = context()) {
  render(
    <AnalysisContext.Provider value={value}>
      <SessionsWorkspace api={api} />
    </AnalysisContext.Provider>,
  );
  return api;
}

describe('referencesFromObservations', () => {
  it('prefiere el valor medido o calculado más reciente a la estimación importada', () => {
    const references = referencesFromObservations(observations, null);
    expect(references.ftp).toMatchObject({ value: 239, quality: 'measured' });
    expect(references.pVo2max).toMatchObject({ value: 392, quality: 'calculated' });
    expect(references.pmax).toBeNull();
  });

  it('recurre a la estimación importada si no hay otra', () => {
    expect(referencesFromObservations([observations[0]], null).ftp).toMatchObject({ value: 236, quality: 'imported_estimate' });
  });
});

describe('SessionsWorkspace', () => {
  it('lista las actividades del periodo con la pauta leída, empezando por la más reciente', async () => {
    const api = renderWorkspace();
    const list = await screen.findByRole('list', { name: 'Actividades del periodo' });
    expect(api.list).toHaveBeenCalledWith({ athleteId: jaumeId, oldest: '2026-06-22', newest: '2026-09-19' }, expect.any(AbortSignal));
    const items = within(list).getAllByRole('button');
    expect(items[0]).toHaveTextContent('Castellfort Ciclismo en ruta');
    expect(items[0]).toHaveTextContent('Sin pauta en el título');
    expect(items[1]).toHaveTextContent('4 × 3 min · 100 % P@VO₂max');
  });

  it('puede ocultar las actividades sin pauta', async () => {
    renderWorkspace();
    const list = await screen.findByRole('list', { name: 'Actividades del periodo' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Solo sesiones con pauta' }));
    expect(within(list).queryByText(/Castellfort/)).not.toBeInTheDocument();
  });

  it('respeta el filtro de entorno', async () => {
    renderWorkspace(fakeApi(), context({ environment: 'indoor' }));
    const list = await screen.findByRole('list', { name: 'Actividades del periodo' });
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    expect(within(list).getByRole('button')).toHaveTextContent('P.Umbral');
  });

  it('compara las series que encajan con la pauta y deja fuera las demás', async () => {
    const api = renderWorkspace();
    await userEvent.click(await screen.findByRole('button', { name: /VO2 max/ }));
    expect(api.detail).toHaveBeenCalledWith({ athleteId: jaumeId, activityId: vo2Id }, expect.any(AbortSignal));

    const summary = await screen.findByRole('region', { name: 'Resultado' });
    expect(within(summary).getByText('392 W')).toBeInTheDocument();
    expect(within(summary).getByText('3 de 4')).toBeInTheDocument();
    expect(screen.getByText(/100 % de P@VO₂max \(392 W, calculado\)/)).toBeInTheDocument();
    expect(screen.getByText('Falta 1 serie')).toBeInTheDocument();
    // El esprint de 20 s no encaja con series de 3 min y no se marca.
    expect(screen.getByRole('checkbox', { name: 'Intervalo 2 cuenta como serie' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Intervalo 3 cuenta como serie' })).toBeChecked();
  });

  it('recalcula al marcar a mano un intervalo', async () => {
    renderWorkspace();
    await userEvent.click(await screen.findByRole('button', { name: /VO2 max/ }));
    const summary = await screen.findByRole('region', { name: 'Resultado' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Intervalo 2 cuenta como serie' }));
    expect(within(summary).getByText('4 de 4')).toBeInTheDocument();
  });

  it('recalcula el objetivo si el entrenador corrige la pauta', async () => {
    renderWorkspace();
    await userEvent.click(await screen.findByRole('button', { name: /VO2 max/ }));
    await screen.findByRole('region', { name: 'Resultado' });
    const percent = screen.getByLabelText('Porcentaje');
    await userEvent.clear(percent);
    await userEvent.type(percent, '90');
    expect(screen.getByText(/90 % de P@VO₂max/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Resultado' })).getByText('353 W')).toBeInTheDocument();
  });

  it('no da veredicto cuando ningún intervalo encaja con la pauta, y lo explica', async () => {
    renderWorkspace();
    await userEvent.click(await screen.findByRole('button', { name: /P\.Umbral/ }));
    expect(await screen.findByText(/Ningún intervalo detectado dura lo que pide la pauta/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Resultado' })).getByText('0 de 2')).toBeInTheDocument();
    // No detectarlas no es lo mismo que no haberlas hecho.
    expect(screen.queryByText(/Faltan 2 series/)).not.toBeInTheDocument();
  });

  it('avisa si no hay ciclista', () => {
    renderWorkspace(fakeApi(), context({ athleteId: '', athlete: null }));
    expect(screen.getByText(/Selecciona un ciclista/)).toBeInTheDocument();
  });

  it('muestra el error del servidor', async () => {
    const api = fakeApi();
    api.list = vi.fn().mockRejectedValue(new Error('No tienes permiso para ver las sesiones de este ciclista.'));
    renderWorkspace(api);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso'));
  });
});

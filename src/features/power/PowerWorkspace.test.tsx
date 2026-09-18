import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisContext, type AnalysisContextValue } from '../../analysis/AnalysisContext';
import type { PowerApi, PowerSnapshot } from './powerApi';
import { PowerWorkspace } from './PowerWorkspace';

vi.mock('chart.js', () => ({
  Chart: class Chart { static register() {} destroy() {} },
  LineController: class LineController {},
  LineElement: class LineElement {},
  PointElement: class PointElement {},
  LinearScale: class LinearScale {},
  LogarithmicScale: class LogarithmicScale {},
  Tooltip: class Tooltip {},
  Legend: class Legend {},
}));

const jaumeId = '96a0a55f-bf3a-41d0-a2df-567548bff081';
const otherId = '9c3d8157-99a0-4ae6-83be-ad15c4e56f9f';

function snapshot(overrides: Partial<PowerSnapshot> = {}): PowerSnapshot {
  return {
    id: 'ab77d6b7-cbcf-49a4-920c-519f9e29e895',
    athleteId: jaumeId,
    oldest: '2026-06-08',
    newest: '2026-09-05',
    environment: 'all',
    points: [
      { seconds: 5, watts: 950 },
      { seconds: 60, watts: 520 },
      { seconds: 180, watts: 400 },
      { seconds: 300, watts: 360 },
      { seconds: 1200, watts: 300 },
    ],
    sourceModels: [],
    synchronizedAt: '2026-09-05T10:00:00.000Z',
    ftp: { value: 285, observedAt: '2026-09-05T09:00:00.000Z', quality: 'imported_estimate' },
    ...overrides,
  };
}

function context(overrides: Partial<AnalysisContextValue> = {}): AnalysisContextValue {
  return {
    athletes: [{ id: jaumeId, intervalsId: 'i202', name: 'Jaume Santamaria' }],
    athleteId: jaumeId,
    athlete: { id: jaumeId, intervalsId: 'i202', name: 'Jaume Santamaria', observations: [] },
    period: { preset: 90 },
    environment: 'all',
    today: '2026-09-05',
    sync: { status: 'complete', synchronizedAt: '2026-09-05T10:00:00.000Z', message: 'Sincronización completada' },
    loadingRoster: false,
    loadingAthlete: false,
    error: '',
    selectAthlete: vi.fn(),
    setPeriod: vi.fn(),
    setEnvironment: vi.fn(),
    synchronize: vi.fn().mockResolvedValue(undefined),
    reloadRoster: vi.fn().mockResolvedValue(undefined),
    addObservation: vi.fn().mockResolvedValue(undefined),
    clearError: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(api: PowerApi, value = context()) {
  return render(
    <AnalysisContext.Provider value={value}>
      <PowerWorkspace api={api} />
    </AnalysisContext.Provider>,
  );
}

function apiReturning(result: PowerSnapshot | Error): PowerApi {
  return {
    load: vi.fn().mockImplementation(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    confirm: vi.fn(),
  };
}

describe('PowerWorkspace', () => {
  it('does not request power without a cyclist or a valid period', async () => {
    const api = apiReturning(snapshot());
    const { rerender } = renderWorkspace(api, context({ athleteId: '', athlete: null }));

    expect(screen.getByRole('heading', { name: 'Selecciona un ciclista' })).toBeVisible();
    expect(api.load).not.toHaveBeenCalled();

    rerender(
      <AnalysisContext.Provider value={context({
        period: { preset: 'custom', oldest: '2026-09-06', newest: '2026-09-05' },
      })}>
        <PowerWorkspace api={api} />
      </AnalysisContext.Provider>,
    );
    expect(await screen.findByText(/fecha inicial no puede ser posterior/i)).toBeVisible();
    expect(api.load).not.toHaveBeenCalled();
  });

  it('shows loading independently and requests the selected context', async () => {
    let resolve!: (value: PowerSnapshot) => void;
    const pending = new Promise<PowerSnapshot>((done) => { resolve = done; });
    const api: PowerApi = { load: vi.fn().mockReturnValue(pending), confirm: vi.fn() };
    renderWorkspace(api);

    expect(screen.getByRole('status')).toHaveTextContent('Cargando curva de potencia');
    expect(api.load).toHaveBeenCalledWith({
      athleteId: jaumeId,
      oldest: '2026-06-08',
      newest: '2026-09-05',
      environment: 'all',
      window: 'rolling',
    }, expect.any(AbortSignal));

    await act(async () => resolve(snapshot()));
    expect(await screen.findByRole('heading', { name: 'Potencia y duración' })).toBeVisible();
  });

  it('renders a recoverable empty state when the period has no snapshot', async () => {
    const synchronize = vi.fn().mockResolvedValue(undefined);
    renderWorkspace(apiReturning(new Error('No hay una curva sincronizada para el periodo y entorno seleccionados.')), context({ synchronize }));

    expect(await screen.findByRole('heading', { name: 'No hay curva para este periodo' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Sincronizar ahora' }));
    expect(synchronize).toHaveBeenCalledOnce();
  });

  it('keeps the last compatible snapshot visible when a refresh fails', async () => {
    const api: PowerApi = {
      load: vi.fn()
        .mockResolvedValueOnce(snapshot())
        .mockRejectedValueOnce(new Error('Intervals.icu no respondió')),
      confirm: vi.fn(),
    };
    const rendered = renderWorkspace(api, context({
      sync: { status: 'complete', synchronizedAt: '2026-09-05T10:00:00.000Z', message: 'Sincronización completada' },
    }));
    expect((await screen.findAllByText('950 W'))[0]).toBeVisible();

    rendered.rerender(
      <AnalysisContext.Provider value={context({
        sync: { status: 'complete', synchronizedAt: '2026-09-05T11:00:00.000Z', message: 'Sincronización completada' },
      })}>
        <PowerWorkspace api={api} />
      </AnalysisContext.Provider>,
    );

    expect(await screen.findByText(/no se pudo actualizar.*última instantánea guardada/i)).toBeVisible();
    expect(screen.getAllByText('950 W')[0]).toBeVisible();
  });

  it.each([
    [{ status: 'failed', synchronizedAt: '2026-08-30T09:00:00.000Z', message: 'Intervals.icu no respondió' } as const, /instantánea guardada/i],
    [{ status: 'partial', synchronizedAt: '2026-09-05T10:00:00.000Z', message: 'Sincronización parcial: actividades' } as const, /sincronización parcial/i],
  ])('keeps usable data visible with a synchronization warning', async (sync, warning) => {
    renderWorkspace(apiReturning(snapshot()), context({ sync }));

    expect(await screen.findByText(warning)).toBeVisible();
    expect(screen.getAllByText('950 W')[0]).toBeVisible();
  });

  it('recommends Morton for complete coverage and separates FTP from CP', async () => {
    renderWorkspace(apiReturning(snapshot()));

    expect(await screen.findByRole('radio', { name: /Morton 3P/i })).toBeChecked();
    expect(screen.getByRole('heading', { name: 'FTP importado' })).toBeVisible();
    expect(screen.getByText('285 W')).toBeVisible();
    expect(await screen.findByText('CP modelada')).toBeVisible();
    expect(screen.getAllByText(/pd-morton-3p@1\.0\.0/)[0]).toBeVisible();
  });

  it('uses Morton when it is adjustable but ECP lacks two long durations', async () => {
    const mortonOnly = snapshot({
      points: [{ seconds: 5, watts: 900 }, { seconds: 60, watts: 500 }, { seconds: 300, watts: 330 }],
    });
    renderWorkspace(apiReturning(mortonOnly));

    expect(await screen.findByRole('radio', { name: /Morton 3P/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^ECP/i })).toBeDisabled();
  });

  it('selects no disabled model and explains when neither fit is possible', async () => {
    const sparse = snapshot({ points: [{ seconds: 60, watts: 500 }] });
    renderWorkspace(apiReturning(sparse));

    expect(await screen.findByRole('heading', { name: 'No se puede ajustar este modelo' })).toBeVisible();
    expect(screen.getByRole('radio', { name: /^ECP/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Morton 3P/i })).not.toBeChecked();
    expect(screen.getByText(/sincroniza.*más duraciones/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reintentar cálculo' })).not.toBeInTheDocument();
  });

  it('does not select Morton when three valid durations cannot produce a physiological fit', async () => {
    const flatCurve = snapshot({
      points: [
        { seconds: 5, watts: 200 },
        { seconds: 60, watts: 200 },
        { seconds: 300, watts: 200 },
      ],
    });
    renderWorkspace(apiReturning(flatCurve));

    expect(await screen.findByRole('heading', { name: 'No se puede ajustar este modelo' })).toBeVisible();
    expect(screen.getByRole('radio', { name: /^ECP/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Morton 3P/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /^ECP/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Morton 3P/i })).not.toBeChecked();
  });

  it('confirms the visible server-checked result and renders its immutable timestamp', async () => {
    let complete!: (value: Awaited<ReturnType<PowerApi['confirm']>>) => void;
    const pending = new Promise<Awaited<ReturnType<PowerApi['confirm']>>>((done) => { complete = done; });
    const api: PowerApi = { load: vi.fn().mockResolvedValue(snapshot()), confirm: vi.fn().mockReturnValue(pending) };
    renderWorkspace(api);

    const button = await screen.findByRole('button', { name: 'Confirmar análisis' });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(api.confirm).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: 'ab77d6b7-cbcf-49a4-920c-519f9e29e895',
      model: 'MORTON_3P',
      result: expect.objectContaining({ cpWatts: expect.any(Number), pmaxWatts: expect.any(Number) }),
    }));

    await act(async () => complete({
      id: '33dad9bf-8f42-4cff-8910-15c34ef24e6a',
      snapshotId: 'ab77d6b7-cbcf-49a4-920c-519f9e29e895',
      model: 'MORTON_3P',
      algorithmVersion: 'pd-morton-3p@1.0.0',
      cpWatts: 290,
      wPrimeJoules: 19_000,
      pmaxWatts: 1_100,
      rmseWatts: 8,
      quality: { complete: true, warnings: [] },
      confirmedAt: '2026-09-05T12:00:00.000Z',
    }));
    const confirmed = await screen.findByText(/confirmado de forma inmutable/i);
    expect(confirmed).toHaveTextContent('05/09/2026');
    expect(confirmed.querySelector('time')).toHaveTextContent(/\d{1,2}:\d{2}/);
    expect(screen.getByText(/no modifica zonas ni prescripciones/i)).toBeVisible();
  });

  it('disables synchronization while the global synchronization is running', async () => {
    const synchronize = vi.fn().mockResolvedValue(undefined);
    renderWorkspace(
      apiReturning(new Error('No hay una curva sincronizada para el periodo y entorno seleccionados.')),
      context({ sync: { status: 'running', synchronizedAt: null }, synchronize }),
    );

    const button = await screen.findByRole('button', { name: 'Sincronizando…' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(synchronize).not.toHaveBeenCalled();
  });

  it('aborts and ignores an old response after the cyclist changes', async () => {
    let resolveOld!: (value: PowerSnapshot) => void;
    let resolveNew!: (value: PowerSnapshot) => void;
    const oldRequest = new Promise<PowerSnapshot>((done) => { resolveOld = done; });
    const newRequest = new Promise<PowerSnapshot>((done) => { resolveNew = done; });
    const api: PowerApi = {
      load: vi.fn()
        .mockReturnValueOnce(oldRequest)
        .mockReturnValueOnce(newRequest),
      confirm: vi.fn(),
    };
    const rendered = renderWorkspace(api);
    const oldSignal = vi.mocked(api.load).mock.calls[0][1];

    rendered.rerender(
      <AnalysisContext.Provider value={context({
        athletes: [{ id: otherId, intervalsId: 'i303', name: 'Otro ciclista' }],
        athleteId: otherId,
        athlete: { id: otherId, intervalsId: 'i303', name: 'Otro ciclista', observations: [] },
      })}>
        <PowerWorkspace api={api} />
      </AnalysisContext.Provider>,
    );
    expect(oldSignal.aborted).toBe(true);

    await act(async () => resolveNew(snapshot({
      id: '7bb812e5-32f5-4ced-8e50-92728ea93b6f',
      athleteId: otherId,
      points: [{ seconds: 120, watts: 410 }, { seconds: 300, watts: 330 }],
      ftp: null,
    })));
    expect((await screen.findAllByText('410 W'))[0]).toBeVisible();

    await act(async () => resolveOld(snapshot()));
    await waitFor(() => expect(screen.queryAllByText('950 W')).toHaveLength(0));
  });
});

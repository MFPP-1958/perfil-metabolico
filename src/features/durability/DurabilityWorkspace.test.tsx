import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisContext, type AnalysisContextValue } from '../../analysis/AnalysisContext';
import type {
  ConfirmedDurabilityAnalysis,
  DurabilityApi,
  DurabilityRow,
  DurabilitySnapshotResponse,
} from './durabilityApi';
import { DurabilityWorkspace } from './DurabilityWorkspace';

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

const athleteA = '11111111-1111-4111-8111-111111111111';
const athleteB = '22222222-2222-4222-8222-222222222222';
const snapshotAId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const snapshotBId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function level(afterKj: number, declinePercent: number, freshWatts: number) {
  return {
    afterKj,
    afterKjPerKg: afterKj / 70,
    fatiguedWatts: freshWatts * (1 - declinePercent / 100),
    declinePercent,
    quality: 'observed' as const,
    supportingActivityCount: 2,
    supportingEffortCount: 3,
    powerSource: 'measured' as const,
  };
}

function comparisonRows(firstDecline = 10): DurabilityRow[] {
  return ([10, 60, 300, 1_200] as const).map((seconds, index) => {
    const freshWatts = [900, 420, 320, 260][index];
    const decline = index === 0 ? firstDecline : 8;
    return {
      seconds,
      freshWatts,
      levels: {
        kj0: level(700, decline, freshWatts),
        kj1: level(1_400, decline + 3, freshWatts),
      },
      onsetAfterKj: decline >= 5 ? 700 : 1_400,
      onsetAfterKjPerKg: decline >= 5 ? 10 : 20,
    };
  });
}

function snapshot(
  id = snapshotAId,
  athleteId = athleteA,
  warning = 'Datos de A',
  overrides: Partial<DurabilitySnapshotResponse> = {},
): DurabilitySnapshotResponse {
  return {
    id,
    athleteId,
    oldest: '2026-06-17',
    newest: '2026-09-14',
    environment: 'all',
    weightKg: 70,
    weightObservedAt: '2026-09-14T09:00:00.000Z',
    synchronizedAt: '2026-09-14T10:00:00.000Z',
    sourceVersion: 'intervals-openapi-v1',
    result: {
      algorithmVersion: 'durability-record-profile@2.0.0',
      coverage: 'moderate',
      warnings: [warning],
      rows: comparisonRows(),
    },
    ...overrides,
  };
}

function confirmed(rows = comparisonRows()): ConfirmedDurabilityAnalysis {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    snapshotId: snapshotAId,
    algorithmVersion: 'durability-record-profile@2.0.0',
    comparisons: rows,
    quality: { coverage: 'moderate', warnings: ['Registro recalculado en el servidor.'] },
    confirmedAt: '2026-09-14T12:00:00.000Z',
  };
}

function context(overrides: Partial<AnalysisContextValue> = {}): AnalysisContextValue {
  return {
    athletes: [],
    athleteId: athleteA,
    athlete: null,
    period: { preset: 90 },
    environment: 'all',
    today: '2026-09-14',
    sync: { status: 'complete', synchronizedAt: '2026-09-14T10:00:00.000Z', message: '' },
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

function apiReturning(result: DurabilitySnapshotResponse | Error): DurabilityApi {
  return {
    load: vi.fn().mockImplementation(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    confirm: vi.fn().mockResolvedValue(confirmed()),
  };
}

function renderWorkspace(api: DurabilityApi, analysis = context()) {
  return render(
    <AnalysisContext.Provider value={analysis}>
      <DurabilityWorkspace api={api} />
    </AnalysisContext.Provider>,
  );
}

describe('DurabilityWorkspace', () => {
  it('loads the active context automatically without synchronizing', async () => {
    const analysis = context();
    const api = apiReturning(snapshot());
    renderWorkspace(api, analysis);

    await screen.findByRole('table', { name: 'Potencia fresca y tras trabajo acumulado' });
    expect(screen.getByRole('heading', { name: 'Durabilidad' })).toBeVisible();
    expect(api.load).toHaveBeenCalledWith({
      athleteId: athleteA,
      oldest: '2026-06-17',
      newest: '2026-09-14',
      environment: 'all',
    }, expect.any(AbortSignal));
    expect(analysis.synchronize).not.toHaveBeenCalled();
  });

  it('does not request without a cyclist or a valid period and keeps the demo isolated', async () => {
    const api = apiReturning(snapshot());
    const rendered = renderWorkspace(api, context({ athleteId: '' }));

    expect(screen.getByRole('heading', { name: 'Selecciona un ciclista' })).toBeVisible();
    expect(api.load).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir demostración sintética' }));
    expect(screen.getByRole('status')).toHaveTextContent('Demostración sintética');
    expect(api.load).not.toHaveBeenCalled();
    expect(api.confirm).not.toHaveBeenCalled();

    rendered.rerender(
      <AnalysisContext.Provider value={context({
        period: { preset: 'custom', oldest: '2026-09-15', newest: '2026-09-14' },
      })}>
        <DurabilityWorkspace api={api} />
      </AnalysisContext.Provider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Volver al análisis real' }));
    expect(await screen.findByText(/fecha inicial no puede ser posterior/i)).toBeVisible();
    expect(api.load).not.toHaveBeenCalled();
  });

  it('shows loading and a recoverable generic error', async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<DurabilitySnapshotResponse>((_resolve, fail) => { reject = fail; });
    const api: DurabilityApi = { load: vi.fn().mockReturnValue(pending), confirm: vi.fn() };
    renderWorkspace(api);

    expect(screen.getByRole('status')).toHaveTextContent('Cargando Durabilidad real');
    await act(async () => reject(new Error('Fallo temporal')));
    expect(await screen.findByRole('heading', { name: 'No se pudo cargar Durabilidad' })).toBeVisible();
    expect(screen.getByText('Fallo temporal')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reintentar carga' })).toBeVisible();
  });

  it('turns a 404 into guidance for the global synchronization control only', async () => {
    const analysis = context();
    renderWorkspace(apiReturning(new Error('No hay un análisis de Durabilidad sincronizado para el periodo y entorno seleccionados.')), analysis);

    expect(await screen.findByRole('heading', { name: 'No hay datos de Durabilidad' })).toBeVisible();
    expect(screen.getByText(/usa el control.*sincronizar ciclista.*barra superior/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /sincronizar/i })).not.toBeInTheDocument();
    expect(analysis.synchronize).not.toHaveBeenCalled();
  });

  it('renders real negative decline, missing levels and missing weight', async () => {
    const incomplete = snapshot(snapshotAId, athleteA, 'Falta cobertura tras carga.', {
      weightKg: null,
      weightObservedAt: null,
      result: {
        algorithmVersion: 'durability-record-profile@2.0.0',
        coverage: 'low',
        warnings: ['Falta cobertura tras carga.'],
        rows: comparisonRows(-5).map((row) => ({ ...row, levels: { kj0: row.levels.kj0 } })),
      },
    });
    renderWorkspace(apiReturning(incomplete));

    const table = await screen.findByRole('table', { name: 'Potencia fresca y tras trabajo acumulado' });
    expect(within(table).getByRole('row', { name: /10 s/ })).toHaveTextContent('−5,0 %');
    expect(screen.getAllByText('Nivel no disponible')).toHaveLength(4);
    expect(screen.getByText('Peso no disponible')).toBeVisible();
  });

  it('keeps usable data visible with a partial synchronization warning', async () => {
    renderWorkspace(apiReturning(snapshot()), context({
      sync: { status: 'partial', synchronizedAt: '2026-09-14T10:00:00.000Z', message: 'Sincronización parcial: falta kJ1.' },
    }));

    expect(await screen.findByText('Sincronización parcial: falta kJ1.')).toBeVisible();
    expect(screen.getByRole('table', { name: 'Potencia fresca y tras trabajo acumulado' })).toBeVisible();
  });

  it('confirms using only the snapshot id and displays the immutable server recalculation', async () => {
    let complete!: (result: ConfirmedDurabilityAnalysis) => void;
    const pending = new Promise<ConfirmedDurabilityAnalysis>((resolve) => { complete = resolve; });
    const api: DurabilityApi = {
      load: vi.fn().mockResolvedValue(snapshot()),
      confirm: vi.fn().mockReturnValue(pending),
    };
    renderWorkspace(api);

    const button = await screen.findByRole('button', { name: 'Confirmar análisis' });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(api.confirm).toHaveBeenCalledWith({ snapshotId: snapshotAId });

    await act(async () => complete(confirmed(comparisonRows(12))));
    expect(await screen.findByText(/confirmado de forma inmutable/i)).toHaveTextContent('14/09/2026');
    expect(screen.getAllByText('12,0 % de descenso')[0]).toBeVisible();
    expect(screen.getByText('Registro recalculado en el servidor.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Análisis confirmado' })).toBeDisabled();
  });

  it('shows a confirmation rejection and allows retrying it', async () => {
    const api: DurabilityApi = {
      load: vi.fn().mockResolvedValue(snapshot()),
      confirm: vi.fn()
        .mockRejectedValueOnce(new Error('La instantánea quedó obsoleta.'))
        .mockResolvedValueOnce(confirmed()),
    };
    renderWorkspace(api);

    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar análisis' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La instantánea quedó obsoleta.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar confirmación' }));
    expect(api.confirm).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/confirmado de forma inmutable/i)).toBeVisible();
  });

  it('reloads the latest snapshot after a 409 conflict before allowing confirmation again', async () => {
    const latest = snapshot(snapshotBId, athleteA, 'Datos B', {
      result: {
        ...snapshot().result,
        rows: comparisonRows(14),
        warnings: ['Datos B'],
      },
    });
    const api: DurabilityApi = {
      load: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(latest),
      confirm: vi.fn().mockRejectedValueOnce(new Error('El análisis ha quedado desactualizado. Vuelve a cargarlo antes de confirmar.')).mockResolvedValueOnce(confirmed(comparisonRows(14))),
    };
    const analysis = context();
    renderWorkspace(api, analysis);

    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar análisis' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Vuelve a cargarlo antes de confirmar.');
    expect(screen.getByRole('button', { name: 'Recargar análisis' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reintentar confirmación' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Recargar análisis' }));
    expect(await screen.findByText('Datos B')).toBeVisible();
    expect(api.load).toHaveBeenCalledTimes(2);
    expect(analysis.synchronize).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirmar análisis' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar análisis' }));
    expect(api.confirm).toHaveBeenLastCalledWith({ snapshotId: snapshotBId });
    expect(await screen.findByText(/confirmado de forma inmutable/i)).toBeVisible();
  });

  it('aborts and ignores a late response after the analysis context changes', async () => {
    let resolveA!: (value: DurabilitySnapshotResponse) => void;
    let resolveB!: (value: DurabilitySnapshotResponse) => void;
    const requestA = new Promise<DurabilitySnapshotResponse>((resolve) => { resolveA = resolve; });
    const requestB = new Promise<DurabilitySnapshotResponse>((resolve) => { resolveB = resolve; });
    const api: DurabilityApi = {
      load: vi.fn().mockReturnValueOnce(requestA).mockReturnValueOnce(requestB),
      confirm: vi.fn(),
    };
    const rendered = renderWorkspace(api);
    const oldSignal = vi.mocked(api.load).mock.calls[0][1];

    rendered.rerender(
      <AnalysisContext.Provider value={context({ athleteId: athleteB })}>
        <DurabilityWorkspace api={api} />
      </AnalysisContext.Provider>,
    );
    expect(oldSignal.aborted).toBe(true);

    await act(async () => resolveB(snapshot(snapshotBId, athleteB, 'Datos de B')));
    expect(await screen.findByText('Datos de B')).toBeVisible();
    await act(async () => resolveA(snapshot()));
    await waitFor(() => expect(screen.queryByText('Datos de A')).not.toBeInTheDocument());
  });

  it('keeps the compatible snapshot visible when refresh fails', async () => {
    const api: DurabilityApi = {
      load: vi.fn()
        .mockResolvedValueOnce(snapshot())
        .mockRejectedValueOnce(new Error('Fallo temporal')),
      confirm: vi.fn(),
    };
    const rendered = renderWorkspace(api);
    expect((await screen.findAllByText('10,0 % de descenso'))[0]).toBeVisible();

    rendered.rerender(
      <AnalysisContext.Provider value={context({
        sync: { status: 'complete', synchronizedAt: '2026-09-14T11:00:00.000Z', message: '' },
      })}>
        <DurabilityWorkspace api={api} />
      </AnalysisContext.Provider>,
    );

    expect(await screen.findByText(/se muestra la última instantánea guardada/i)).toBeVisible();
    expect(screen.getAllByText('10,0 % de descenso')[0]).toBeVisible();
  });
});

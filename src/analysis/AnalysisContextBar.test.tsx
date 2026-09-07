import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AthleteApi } from '../features/athletes/athleteApi';
import { AnalysisContextBar } from './AnalysisContextBar';
import { AnalysisProvider } from './AnalysisProvider';

const athleteId = '96a0a55f-bf3a-41d0-a2df-567548bff081';
const athlete = { id: athleteId, intervalsId: 'i202', name: 'Jaume Santamaria', observations: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function createApi(sync: AthleteApi['sync'] = vi.fn().mockResolvedValue({
  status: 'complete',
  synchronizedAt: '2026-09-05T12:01:00.000Z',
  warnings: [],
})) {
  return {
    list: vi.fn().mockResolvedValue([{ id: athlete.id, intervalsId: athlete.intervalsId, name: athlete.name }]),
    load: vi.fn().mockResolvedValue(athlete),
    sync,
  } satisfies AthleteApi;
}

function renderBar(api: AthleteApi = createApi()) {
  window.localStorage.clear();
  return render(
    <AnalysisProvider
      api={api}
      storage={window.localStorage}
      now={() => new Date('2026-09-05T12:00:00Z')}
      createSyncKey={() => 'sync_context_bar'}
    >
      <AnalysisContextBar />
    </AnalysisProvider>,
  );
}

async function selectAthlete() {
  await userEvent.selectOptions(await screen.findByLabelText('Ciclista activo'), athleteId);
}

describe('AnalysisContextBar', () => {
  it('selects a period preset and environment in the shared context', async () => {
    const api = createApi();
    renderBar(api);
    await selectAthlete();

    expect(screen.getByLabelText('Periodo')).toHaveValue('90');
    await userEvent.selectOptions(screen.getByLabelText('Periodo'), '180');
    await userEvent.selectOptions(screen.getByLabelText('Entorno'), 'indoor');
    await userEvent.click(screen.getByRole('button', { name: 'Sincronizar con Intervals.icu' }));

    await waitFor(() => expect(api.sync).toHaveBeenCalledWith({
      athleteId,
      oldest: '2026-03-10',
      newest: '2026-09-05',
      environment: 'indoor',
      syncKey: 'sync_context_bar',
    }));
  });

  it('uses valid custom dates and rejects future or reversed dates', async () => {
    const api = createApi();
    renderBar(api);
    await selectAthlete();
    await userEvent.selectOptions(screen.getByLabelText('Periodo'), 'custom');
    const oldest = screen.getByLabelText('Fecha inicial');
    const newest = screen.getByLabelText('Fecha final');
    await userEvent.clear(oldest);
    await userEvent.type(oldest, '2026-08-01');
    await userEvent.clear(newest);
    await userEvent.type(newest, '2026-09-01');
    await userEvent.click(screen.getByRole('button', { name: 'Sincronizar con Intervals.icu' }));
    await waitFor(() => expect(api.sync).toHaveBeenCalledWith(expect.objectContaining({
      oldest: '2026-08-01', newest: '2026-09-01',
    })));

    await userEvent.clear(newest);
    await userEvent.type(newest, '2026-09-06');
    expect(await screen.findByRole('alert')).toHaveTextContent('futuras');
    expect(screen.getByRole('button', { name: 'Sincronizar con Intervals.icu' })).toBeDisabled();

    await userEvent.clear(oldest);
    await userEvent.type(oldest, '2026-09-02');
    await userEvent.clear(newest);
    await userEvent.type(newest, '2026-09-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('posterior');
  });

  it('disables synchronization until a cyclist is selected', async () => {
    renderBar();
    expect(await screen.findByRole('option', { name: 'Jaume Santamaria' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sincronizar con Intervals.icu' })).toBeDisabled();
    expect(screen.getByText('Todavía sin sincronizar')).toBeVisible();
  });

  it('shows running and completed synchronization states with the last timestamp', async () => {
    const request = deferred<{ status: 'complete'; synchronizedAt: string; warnings: [] }>();
    const api = createApi(vi.fn().mockReturnValue(request.promise));
    renderBar(api);
    await selectAthlete();
    await userEvent.click(screen.getByRole('button', { name: 'Sincronizar con Intervals.icu' }));
    expect(screen.getByRole('button', { name: 'Sincronizando…' })).toBeDisabled();

    request.resolve({ status: 'complete', synchronizedAt: '2026-09-05T12:01:00.000Z', warnings: [] });
    expect(await screen.findByText('Sincronización completada')).toBeVisible();
    expect(screen.getByText(/Última sincronización:/)).toBeVisible();
  });

  it.each([
    [{ status: 'partial' as const, synchronizedAt: '2026-09-05T12:01:00.000Z', warnings: ['power_curves'] }, 'Sincronización parcial: potencia'],
    [new Error('Intervals.icu no responde.'), 'Intervals.icu no responde.'],
  ])('announces partial and failed outcomes', async (outcome, message) => {
    const sync = outcome instanceof Error
      ? vi.fn().mockRejectedValue(outcome)
      : vi.fn().mockResolvedValue(outcome);
    renderBar(createApi(sync));
    await selectAthlete();
    await userEvent.click(screen.getByRole('button', { name: 'Sincronizar con Intervals.icu' }));

    const notification = await screen.findByText(message);
    expect(notification).toBeVisible();
    if (outcome instanceof Error) expect(notification).toHaveAttribute('role', 'alert');
  });
});

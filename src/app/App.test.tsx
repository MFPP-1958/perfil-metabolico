import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuthAdapter } from '../auth/AuthGate';
import type { AthleteApi } from '../features/athletes/athleteApi';
import type { DurabilityApi, DurabilityRow } from '../features/durability/durabilityApi';
import type { PowerApi } from '../features/power/powerApi';
import { App } from './App';

const athleteId = '96a0a55f-bf3a-41d0-a2df-567548bff081';

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

describe('application analysis context', () => {
  it('renders one global context bar and keeps its cyclist across routes', async () => {
    window.history.replaceState({}, '', '/');
    window.localStorage.clear();
    const auth: AuthAdapter = {
      getSession: vi.fn().mockResolvedValue({ accessToken: 'token', user: { id: 'coach-1', email: 'coach@example.com' } }),
      onAuthStateChange: vi.fn().mockReturnValue(() => undefined),
      signInWithOtp: vi.fn(),
      signOut: vi.fn(),
    };
    const api: AthleteApi = {
      list: vi.fn().mockResolvedValue([{ id: athleteId, intervalsId: 'i202', name: 'Jaume Santamaria' }]),
      load: vi.fn().mockResolvedValue({ id: athleteId, intervalsId: 'i202', name: 'Jaume Santamaria', observations: [] }),
      sync: vi.fn(),
    };
    const newest = new Date().toISOString().slice(0, 10);
    const oldestDate = new Date(`${newest}T00:00:00.000Z`);
    oldestDate.setUTCDate(oldestDate.getUTCDate() - 89);
    const powerApi: PowerApi = {
      load: vi.fn().mockResolvedValue({
        id: 'ab77d6b7-cbcf-49a4-920c-519f9e29e895',
        athleteId,
        oldest: oldestDate.toISOString().slice(0, 10),
        newest,
        environment: 'all',
        points: [{ seconds: 120, watts: 410 }, { seconds: 300, watts: 330 }],
        sourceModels: [],
        synchronizedAt: '2026-09-05T10:00:00.000Z',
        ftp: { value: 285, observedAt: '2026-09-05T09:00:00.000Z', quality: 'imported_estimate' },
      }),
      confirm: vi.fn(),
    };
    const durabilityRows: DurabilityRow[] = ([10, 60, 300, 1_200] as const).map((seconds) => ({
      seconds,
      freshWatts: 400,
      levels: {
        kj0: {
          afterKj: 700,
          afterKjPerKg: 10,
          fatiguedWatts: 360,
          declinePercent: 10,
          quality: 'observed',
          supportingActivityCount: 2,
          supportingEffortCount: 3,
          powerSource: 'measured',
        },
      },
      onsetAfterKj: 700,
      onsetAfterKjPerKg: 10,
    }));
    const durabilityApi: DurabilityApi = {
      load: vi.fn().mockResolvedValue({
        id: '31000000-0000-4000-8000-000000000001',
        athleteId,
        oldest: oldestDate.toISOString().slice(0, 10),
        newest,
        environment: 'all',
        weightKg: 70,
        weightObservedAt: '2026-09-14T09:00:00.000Z',
        synchronizedAt: '2026-09-14T10:00:00.000Z',
        sourceVersion: 'intervals-openapi-v1',
        result: {
          algorithmVersion: 'durability-record-profile@2.0.0',
          rows: durabilityRows,
          coverage: 'moderate',
          warnings: [],
        },
      }),
      confirm: vi.fn(),
    };

    render(<App auth={auth} athleteApi={api} powerApi={powerApi} durabilityApi={durabilityApi} />);
    await screen.findByRole('option', { name: 'Jaume Santamaria' });
    const selector = screen.getByLabelText('Ciclista activo');
    await userEvent.selectOptions(selector, athleteId);
    await userEvent.click(screen.getByRole('link', { name: 'Potencia' }));

    expect(screen.getAllByLabelText('Ciclista activo')).toHaveLength(1);
    expect(screen.getByLabelText('Ciclista activo')).toHaveValue(athleteId);
    expect(screen.getByRole('heading', { name: 'Potencia y duración' })).toBeVisible();
    expect(await screen.findByText('CP modelada')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Abrir demostración' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Durabilidad' }));
    expect(await screen.findByRole('table', { name: 'Potencia fresca y tras trabajo acumulado' })).toBeVisible();
    expect(durabilityApi.load).toHaveBeenCalledWith(expect.objectContaining({
      athleteId,
      environment: 'all',
    }), expect.any(AbortSignal));
    expect(api.sync).not.toHaveBeenCalled();
    expect(screen.queryByText(/demostración sintética/i)).not.toBeInTheDocument();
  });
});

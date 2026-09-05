import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AthleteWorkspace } from './AthleteWorkspace';
import { synchronizeAthlete } from './synchronizeAthlete';

describe('athlete workspace synchronization', () => {
  it('synchronizes the selected real cyclist and reloads normalized data', async () => {
    const api = {
      list: vi.fn().mockResolvedValue([{ id: 'uuid-1', intervalsId: 'i123', name: 'Ana' }]),
      load: vi.fn().mockResolvedValue({ id: 'uuid-1', intervalsId: 'i123', name: 'Ana', observations: [] }),
      sync: vi.fn().mockResolvedValue({ warnings: [] }),
    };
    render(<AthleteWorkspace api={api} />);
    await userEvent.selectOptions(await screen.findByLabelText('Ciclista'), 'uuid-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar Ana' }));
    expect(api.sync).toHaveBeenCalledWith('uuid-1');
    expect(api.load).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Sincronización completada')).toBeVisible();
  });

  it('posts the internal UUID and safe 90-day default without identifiers in the URL', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ warnings: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const fetchImpl = fetchSpy as unknown as typeof fetch;

    await synchronizeAthlete('8ca7cc82-02b0-47ca-84ca-253607a04b72', {
      getToken: vi.fn().mockResolvedValue('access-token'),
      fetchImpl,
      now: () => new Date('2026-09-05T12:00:00Z'),
      createSyncKey: () => 'sync_test_123',
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/.netlify/functions/sync-athlete');
    expect(url).not.toContain('athleteId');
    expect(JSON.parse(String(init?.body))).toEqual({
      athleteId: '8ca7cc82-02b0-47ca-84ca-253607a04b72',
      oldest: '2026-06-08',
      newest: '2026-09-05',
      environment: 'all',
      syncKey: 'sync_test_123',
    });
  });

  it('never offers synchronization for synthetic demo data', async () => {
    const api = {
      list: vi.fn().mockResolvedValue([]),
      load: vi.fn(),
      sync: vi.fn(),
    };
    render(<AthleteWorkspace api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir demostración' }));
    expect(screen.queryByRole('button', { name: /Sincronizar/ })).not.toBeInTheDocument();
    expect(api.sync).not.toHaveBeenCalled();
  });

  it('reports partial components with familiar Spanish labels', async () => {
    const api = {
      list: vi.fn().mockResolvedValue([{ id: 'uuid-1', intervalsId: 'i123', name: 'Ana' }]),
      load: vi.fn().mockResolvedValue({ id: 'uuid-1', intervalsId: 'i123', name: 'Ana', observations: [] }),
      sync: vi.fn().mockResolvedValue({ warnings: ['power_curves', 'planned_workouts'] }),
    };
    render(<AthleteWorkspace api={api} />);
    await userEvent.selectOptions(await screen.findByLabelText('Ciclista'), 'uuid-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar Ana' }));
    expect(await screen.findByText('Sincronización parcial: potencia, entrenamientos')).toBeVisible();
  });
});

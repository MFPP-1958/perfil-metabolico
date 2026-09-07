import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisContextBar } from '../../analysis/AnalysisContextBar';
import { AnalysisProvider } from '../../analysis/AnalysisProvider';
import { AthleteWorkspace } from './AthleteWorkspace';
import { synchronizeAthlete } from './synchronizeAthlete';

const realAthleteId = '8ca7cc82-02b0-47ca-84ca-253607a04b72';

function renderIntegratedWorkspace(api: Parameters<typeof AnalysisProvider>[0]['api']) {
  window.localStorage.clear();
  return render(
    <AnalysisProvider api={api} now={() => new Date('2026-09-05T12:00:00Z')}>
      <AnalysisContextBar />
      <AthleteWorkspace />
    </AnalysisProvider>,
  );
}

describe('athlete workspace synchronization', () => {
  it('uses the single global cyclist selection and removes the synthetic demo action', async () => {
    const api = {
      list: vi.fn().mockResolvedValue([{ id: realAthleteId, intervalsId: 'i123', name: 'Jaume Santamaria' }]),
      load: vi.fn().mockResolvedValue({ id: realAthleteId, intervalsId: 'i123', name: 'Jaume Santamaria', observations: [] }),
    };
    renderIntegratedWorkspace(api);

    await userEvent.selectOptions(await screen.findByLabelText('Ciclista activo'), realAthleteId);
    expect(await screen.findByRole('heading', { name: 'Jaume Santamaria' })).toBeVisible();
    expect(screen.getAllByLabelText('Ciclista activo')).toHaveLength(1);
    expect(screen.queryByLabelText('Ciclista')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir demostración' })).not.toBeInTheDocument();
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

});

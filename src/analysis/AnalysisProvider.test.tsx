import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AthleteApi, AthleteDetail } from '../features/athletes/athleteApi';
import { ANALYSIS_PREFERENCES_STORAGE_KEY } from './preferences';
import { useAnalysis } from './AnalysisContext';
import { AnalysisProvider } from './AnalysisProvider';

const anaId = '8ca7cc82-02b0-47ca-84ca-253607a04b72';
const jaumeId = '96a0a55f-bf3a-41d0-a2df-567548bff081';
const roster = [
  { id: anaId, intervalsId: 'i101', name: 'Ana Test' },
  { id: jaumeId, intervalsId: 'i202', name: 'Jaume Santamaria' },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function AnalysisHarness() {
  const analysis = useAnalysis();
  return (
    <>
      <label htmlFor="active-athlete">Ciclista activo</label>
      <select id="active-athlete" value={analysis.athleteId} onChange={(event) => analysis.selectAthlete(event.target.value)}>
        <option value="">Selecciona</option>
        {analysis.athletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name}</option>)}
      </select>
      <Link to="/potencia">Potencia</Link>
      <button type="button" onClick={() => analysis.setPeriod({ preset: 180 })}>Usar 180 días</button>
      <button type="button" onClick={() => void analysis.synchronize()}>Sincronizar prueba</button>
      <output aria-label="Detalle activo">{analysis.athlete?.name ?? 'Sin detalle'}</output>
      <Routes>
        <Route path="/" element={<p>Inicio</p>} />
        <Route path="/potencia" element={<p>Vista de potencia</p>} />
      </Routes>
    </>
  );
}

function renderProvider(api: AthleteApi, storage: Storage = window.localStorage) {
  return render(
    <MemoryRouter>
      <AnalysisProvider
        api={api}
        storage={storage}
        now={() => new Date('2026-09-05T12:00:00Z')}
        createSyncKey={() => 'sync_test_provider'}
      >
        <AnalysisHarness />
      </AnalysisProvider>
    </MemoryRouter>,
  );
}

describe('AnalysisProvider', () => {
  it('restores an authorized cyclist and preserves it while navigating', async () => {
    window.localStorage.setItem(ANALYSIS_PREFERENCES_STORAGE_KEY, JSON.stringify({
      athleteId: jaumeId,
      period: { preset: 90 },
      environment: 'all',
    }));
    const api: AthleteApi = {
      list: vi.fn().mockResolvedValue(roster),
      load: vi.fn().mockResolvedValue({ ...roster[1], observations: [] }),
    };

    renderProvider(api);

    expect(await screen.findByLabelText('Ciclista activo')).toHaveValue(jaumeId);
    await userEvent.click(screen.getByRole('link', { name: 'Potencia' }));
    expect(screen.getByLabelText('Ciclista activo')).toHaveValue(jaumeId);
    expect(window.localStorage.getItem(ANALYSIS_PREFERENCES_STORAGE_KEY)).toContain(jaumeId);
    expect(api.list).toHaveBeenCalledOnce();
  });

  it('does not restore a cyclist until the roster proves the UUID is authorized', async () => {
    const rosterRequest = deferred<typeof roster>();
    window.localStorage.setItem(ANALYSIS_PREFERENCES_STORAGE_KEY, JSON.stringify({
      athleteId: jaumeId,
      period: { preset: 180 },
      environment: 'indoor',
    }));
    const api: AthleteApi = {
      list: vi.fn().mockReturnValue(rosterRequest.promise),
      load: vi.fn().mockResolvedValue({ ...roster[1], observations: [] }),
    };

    renderProvider(api);

    expect(screen.getByLabelText('Ciclista activo')).toHaveValue('');
    rosterRequest.resolve(roster);
    await waitFor(() => expect(screen.getByLabelText('Ciclista activo')).toHaveValue(jaumeId));
  });

  it('ignores an older athlete detail response that finishes after the active one', async () => {
    window.localStorage.clear();
    const anaRequest = deferred<AthleteDetail>();
    const jaumeRequest = deferred<AthleteDetail>();
    const api: AthleteApi = {
      list: vi.fn().mockResolvedValue(roster),
      load: vi.fn((id) => id === anaId ? anaRequest.promise : jaumeRequest.promise),
    };

    renderProvider(api);
    const selector = await screen.findByLabelText('Ciclista activo');
    await userEvent.selectOptions(selector, anaId);
    await userEvent.selectOptions(selector, jaumeId);
    jaumeRequest.resolve({ ...roster[1], observations: [] });
    await waitFor(() => expect(screen.getByLabelText('Detalle activo')).toHaveTextContent('Jaume Santamaria'));
    anaRequest.resolve({ ...roster[0], observations: [] });
    await waitFor(() => expect(screen.getByLabelText('Detalle activo')).toHaveTextContent('Jaume Santamaria'));
  });

  it('synchronizes with the internal UUID and resolved shared context', async () => {
    window.localStorage.clear();
    const sync = vi.fn().mockResolvedValue({
      status: 'complete',
      synchronizedAt: '2026-09-05T12:01:00.000Z',
      warnings: [],
    });
    const api = {
      list: vi.fn().mockResolvedValue(roster),
      load: vi.fn().mockResolvedValue({ ...roster[1], observations: [] }),
      sync,
    } as unknown as AthleteApi;

    renderProvider(api);
    await userEvent.selectOptions(await screen.findByLabelText('Ciclista activo'), jaumeId);
    await userEvent.click(screen.getByRole('button', { name: 'Sincronizar prueba' }));

    await waitFor(() => expect(sync).toHaveBeenCalledWith({
      athleteId: jaumeId,
      oldest: '2026-06-08',
      newest: '2026-09-05',
      environment: 'all',
      syncKey: 'sync_test_provider',
    }));
  });

  it('keeps loading the same cyclist detail when only the analysis period changes', async () => {
    window.localStorage.clear();
    const detail = deferred<AthleteDetail>();
    const api: AthleteApi = {
      list: vi.fn().mockResolvedValue(roster),
      load: vi.fn().mockReturnValue(detail.promise),
    };

    renderProvider(api);
    await userEvent.selectOptions(await screen.findByLabelText('Ciclista activo'), jaumeId);
    await userEvent.click(screen.getByRole('button', { name: 'Usar 180 días' }));
    detail.resolve({ ...roster[1], observations: [] });

    await waitFor(() => expect(screen.getByLabelText('Detalle activo')).toHaveTextContent('Jaume Santamaria'));
  });
});

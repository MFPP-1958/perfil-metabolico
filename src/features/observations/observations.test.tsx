import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { AthleteWorkspace, type AthleteApi } from '../athletes/AthleteWorkspace';

const athletes = [
  { id: '8ca7cc82-02b0-47ca-84ca-253607a04b72', intervalsId: 'i101', name: 'Ana Test' },
  { id: '96a0a55f-bf3a-41d0-a2df-567548bff081', intervalsId: 'i202', name: 'Leo Test' },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('athlete workspace and observations', () => {
  it('starts empty without assigning demo data to a cyclist', async () => {
    const api: AthleteApi = { list: vi.fn().mockResolvedValue([]), load: vi.fn() };
    render(<AthleteWorkspace api={api} />);
    expect(await screen.findByText('No hay ciclistas vinculados')).toBeVisible();
    expect(screen.queryByText('Ciclista de demostración')).not.toBeInTheDocument();
  });

  it('keeps the latest cyclist when an earlier request finishes late', async () => {
    const first = deferred<{ id: string; intervalsId: string; name: string; observations: [] }>();
    const second = deferred<{ id: string; intervalsId: string; name: string; observations: [] }>();
    const api: AthleteApi = {
      list: vi.fn().mockResolvedValue(athletes),
      load: vi.fn((id) => id === athletes[0].id ? first.promise : second.promise),
    };
    render(<AthleteWorkspace api={api} />);
    const selector = await screen.findByLabelText('Ciclista');
    await userEvent.selectOptions(selector, athletes[0].id);
    await userEvent.selectOptions(selector, athletes[1].id);
    second.resolve({ ...athletes[1], observations: [] });
    expect(await screen.findByRole('heading', { name: 'Leo Test' })).toBeVisible();
    first.resolve({ ...athletes[0], observations: [] });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Ana Test' })).not.toBeInTheDocument());
  });

  it('shows provenance and quality for existing observations', async () => {
    const api: AthleteApi = {
      list: vi.fn().mockResolvedValue([athletes[0]]),
      load: vi.fn().mockResolvedValue({
        ...athletes[0],
        observations: [{
          id: '6b8c6a31-9a5b-40d8-8b0b-8e337268e7b9',
          athleteId: '8ca7cc82-02b0-47ca-84ca-253607a04b72',
          metricCode: 'ftp', value: 255, unit: 'W', observedAt: '2026-09-01T08:00:00.000Z',
          origin: 'intervals_icu', quality: 'imported_estimate',
          protocol: { name: 'Sport settings', version: 'v1' },
        }],
      }),
    };
    render(<AthleteWorkspace api={api} />);
    await userEvent.selectOptions(await screen.findByLabelText('Ciclista'), athletes[0].id);
    expect(await screen.findByText('Estimación importada')).toBeVisible();
    expect(screen.getByText(/Sport settings · v1/)).toBeVisible();
  });

  it('rejects invalid manual values before adding history', async () => {
    const api: AthleteApi = { list: vi.fn().mockResolvedValue([athletes[0]]), load: vi.fn().mockResolvedValue({ ...athletes[0], observations: [] }) };
    render(<AthleteWorkspace api={api} />);
    await userEvent.selectOptions(await screen.findByLabelText('Ciclista'), athletes[0].id);
    await userEvent.type(await screen.findByLabelText('Valor'), '-2');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir observación' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('fuera del rango');
  });

  it('has no automatically detectable structural accessibility violations', async () => {
    const api: AthleteApi = { list: vi.fn().mockResolvedValue([]), load: vi.fn() };
    const { container } = render(<AthleteWorkspace api={api} />);
    await screen.findByText('No hay ciclistas vinculados');
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});

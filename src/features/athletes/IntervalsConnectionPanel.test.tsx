import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IntervalsConnectionPanel } from './IntervalsConnectionPanel';

describe('Intervals connection panel', () => {
  it('does not contact Intervals until the coach asks to connect', async () => {
    const api = { discover: vi.fn().mockResolvedValue([]), importSelected: vi.fn() };
    render(<IntervalsConnectionPanel api={api} onImported={vi.fn()} />);
    expect(api.discover).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Conectar Intervals.icu' }));
    expect(api.discover).toHaveBeenCalledOnce();
  });

  it('imports only checked cyclists and refreshes the workspace', async () => {
    const api = {
      discover: vi.fn().mockResolvedValue([{ id: 'i123', name: 'Ana' }, { id: 'i456', name: 'Luis' }]),
      importSelected: vi.fn().mockResolvedValue({ added: 1, existing: 0, failed: [] }),
    };
    const onImported = vi.fn().mockResolvedValue(undefined);
    render(<IntervalsConnectionPanel api={api} onImported={onImported} />);
    await userEvent.click(screen.getByRole('button', { name: 'Conectar Intervals.icu' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Ana' }));
    await userEvent.click(screen.getByRole('button', { name: 'Incorporar 1 ciclista' }));
    expect(api.importSelected).toHaveBeenCalledWith(['i123']);
    expect(onImported).toHaveBeenCalledOnce();
    expect(await screen.findByText('1 ciclista incorporado')).toBeVisible();
  });

  it('explains when the server connection is not configured', async () => {
    const api = {
      discover: vi.fn().mockRejectedValue(new Error('La conexión todavía no está configurada.')),
      importSelected: vi.fn(),
    };
    render(<IntervalsConnectionPanel api={api} onImported={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Conectar Intervals.icu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La conexión todavía no está configurada.');
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AthleteWorkspace } from './AthleteWorkspace';

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
    expect(api.sync).toHaveBeenCalledWith('i123');
    expect(api.load).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Sincronización completada')).toBeVisible();
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

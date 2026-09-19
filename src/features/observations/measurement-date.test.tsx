import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ObservationForm } from './ObservationForm';

const athleteId = '8ca7cc82-02b0-47ca-84ca-253607a04b72';

describe('fecha de la medición', () => {
  it('guarda el día en que se midió el valor, no el día en que se escribe', async () => {
    const onAdd = vi.fn();
    render(<ObservationForm athleteId={athleteId} onAdd={onAdd} today="2026-09-19" />);
    await userEvent.type(screen.getByLabelText('Valor'), '239');
    fireEvent.change(screen.getByLabelText('Fecha de la medición'), { target: { value: '2026-09-02' } });
    await userEvent.click(screen.getByRole('button', { name: 'Añadir observación' }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const observedAt = new Date(onAdd.mock.calls[0][0].observedAt);
    expect([observedAt.getFullYear(), observedAt.getMonth() + 1, observedAt.getDate()]).toEqual([2026, 9, 2]);
  });

  it('propone la fecha de hoy', () => {
    render(<ObservationForm athleteId={athleteId} onAdd={vi.fn()} today="2026-09-19" />);
    expect(screen.getByLabelText('Fecha de la medición')).toHaveValue('2026-09-19');
  });

  it('no admite una fecha futura', async () => {
    const onAdd = vi.fn();
    render(<ObservationForm athleteId={athleteId} onAdd={onAdd} today="2026-09-19" />);
    await userEvent.type(screen.getByLabelText('Valor'), '239');
    fireEvent.change(screen.getByLabelText('Fecha de la medición'), { target: { value: '2026-09-25' } });
    await userEvent.click(screen.getByRole('button', { name: 'Añadir observación' }));

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('La fecha de la medición no puede ser posterior a hoy.');
  });
});

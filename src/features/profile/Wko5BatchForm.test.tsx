import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Observation } from '../../domain/observation';
import { Wko5BatchForm } from './Wko5BatchForm';

const athleteId = '96a0a55f-bf3a-41d0-a2df-567548bff081';

function setup(onSubmit = vi.fn().mockResolvedValue(true)) {
  render(<Wko5BatchForm athleteId={athleteId} today="2026-09-19" onSubmit={onSubmit} />);
  return onSubmit;
}

describe('Wko5BatchForm', () => {
  it('guarda de una vez todos los valores escritos, con su programa y la fecha del cálculo', async () => {
    const onSubmit = setup();
    fireEvent.change(screen.getByLabelText('Fecha del cálculo en WKO5'), { target: { value: '2026-09-18' } });
    await userEvent.type(screen.getByLabelText('Versión del programa'), '5.0.16');
    await userEvent.type(screen.getByLabelText('mFTP (W)'), '241');
    await userEvent.type(screen.getByLabelText('VO₂max (ml/kg/min)'), '71,5');
    await userEvent.type(screen.getByLabelText('VLa máx (mmol/l/s)'), '0,30');
    await userEvent.type(screen.getByLabelText('TTE (min)'), '41');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar valores de WKO5' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const saved = onSubmit.mock.calls[0][0] as Observation[];
    expect(saved.map((item) => [item.metricCode, item.value, item.unit])).toEqual([
      ['mftp', 241, 'W'],
      ['tte', 2460, 's'],
      ['vo2max', 71.5, 'ml·kg⁻¹·min⁻¹'],
      ['vlamax', 0.3, 'mmol·l⁻¹·s⁻¹'],
    ]);
    for (const item of saved) {
      expect(item).toMatchObject({ athleteId, origin: 'external_model', quality: 'calculated', sourceReference: { software: 'WKO5', version: '5.0.16' } });
      const day = new Date(item.observedAt);
      expect([day.getFullYear(), day.getMonth() + 1, day.getDate()]).toEqual([2026, 9, 18]);
    }
    expect(await screen.findByRole('status')).toHaveTextContent('Guardados 4 valores de WKO5');
    expect(screen.getByLabelText('mFTP (W)')).toHaveValue('');
  });

  it('pide al menos un valor', async () => {
    const onSubmit = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar valores de WKO5' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe al menos un valor.');
  });

  it('rechaza un valor fuera de rango sin guardar ninguno', async () => {
    const onSubmit = setup();
    await userEvent.type(screen.getByLabelText('mFTP (W)'), '241');
    await userEvent.type(screen.getByLabelText('VLa máx (mmol/l/s)'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar valores de WKO5' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/VLa máx/);
  });

  it('conserva lo escrito si el servidor no lo guarda', async () => {
    setup(vi.fn().mockResolvedValue(false));
    await userEvent.type(screen.getByLabelText('mFTP (W)'), '241');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar valores de WKO5' }));
    expect(screen.getByLabelText('mFTP (W)')).toHaveValue('241');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('permite indicar otro programa', async () => {
    const onSubmit = setup();
    const program = screen.getByLabelText('Programa');
    await userEvent.clear(program);
    await userEvent.type(program, 'INSCYD');
    await userEvent.type(screen.getByLabelText('VO₂max (ml/kg/min)'), '70');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar valores de INSCYD' }));
    expect((onSubmit.mock.calls[0][0] as Observation[])[0].sourceReference).toEqual({ software: 'INSCYD' });
  });
});

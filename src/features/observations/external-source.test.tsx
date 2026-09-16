import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ObservationForm } from './ObservationForm';
import { ObservationCard } from './ObservationCard';
import type { Observation } from '../../domain/observation';

const athleteId = '8ca7cc82-02b0-47ca-84ca-253607a04b72';

describe('observations modelled by third-party software', () => {
  it('records the software that produced the value and marks it as calculated', async () => {
    const onAdd = vi.fn();
    render(<ObservationForm athleteId={athleteId} onAdd={onAdd} />);

    await userEvent.selectOptions(screen.getByLabelText('Métrica'), 'vlamax');
    await userEvent.type(screen.getByLabelText('Valor'), '0.72');
    await userEvent.selectOptions(screen.getByLabelText('Origen'), 'external_model');
    await userEvent.type(await screen.findByLabelText('Programa'), 'WKO5');
    await userEvent.type(screen.getByLabelText('Versión del programa'), '5.0.16');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir observación' }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      metricCode: 'vlamax',
      value: 0.72,
      origin: 'external_model',
      quality: 'calculated',
      sourceReference: { software: 'WKO5', version: '5.0.16' },
    });
  });

  it('refuses to accept the value until the software is named', async () => {
    const onAdd = vi.fn();
    render(<ObservationForm athleteId={athleteId} onAdd={onAdd} />);

    await userEvent.selectOptions(screen.getByLabelText('Métrica'), 'vlamax');
    await userEvent.type(screen.getByLabelText('Valor'), '0.72');
    await userEvent.selectOptions(screen.getByLabelText('Origen'), 'external_model');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir observación' }));

    expect(onAdd).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/nombrar el programa/i);
  });

  it('keeps a directly measured observation marked as measured', async () => {
    const onAdd = vi.fn();
    render(<ObservationForm athleteId={athleteId} onAdd={onAdd} />);

    await userEvent.type(screen.getByLabelText('Valor'), '310');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir observación' }));

    expect(onAdd.mock.calls[0][0]).toMatchObject({ origin: 'field_test', quality: 'measured' });
    expect(onAdd.mock.calls[0][0]).not.toHaveProperty('sourceReference');
  });

  it('names the software on the observation card so the coach can see it at a glance', () => {
    const observation: Observation = {
      id: '6b8c6a31-9a5b-40d8-8b0b-8e337268e7b9', athleteId, metricCode: 'vlamax', value: 0.72,
      unit: 'mmol·l⁻¹·s⁻¹', observedAt: '2026-09-16T08:00:00.000Z', origin: 'external_model',
      quality: 'calculated', sourceReference: { software: 'WKO5', version: '5.0.16' },
      protocol: { name: 'Entrada manual', version: '1' },
    };
    render(<ObservationCard observation={observation} />);
    expect(screen.getByText(/WKO5 5\.0\.16/)).toBeVisible();
    expect(screen.queryByText(/external_model/)).not.toBeInTheDocument();
  });
});

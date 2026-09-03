import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReportBuilder } from './ReportBuilder';

const data = { athleteId: 'a1', athleteName: 'Ciclista de prueba', generatedAt: '2026-09-03T16:00:00Z', results: [{ id: 'r1', metric: 'CP', value: 305, unit: 'W', status: 'approved' as const, modelVersion: 'ecp@1.0.0', source: 'Campo', limitation: 'Modelo sujeto a error.' }], prescription: { id: 'p1', status: 'approved' as const, summary: 'Sesión aprobada.', approvedBy: 'coach-1' } };

describe('ReportBuilder', () => {
  it('switches audience and offers a print-only report', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<ReportBuilder data={data} />);
    await user.selectOptions(screen.getByLabelText(/audiencia/i), 'family');
    expect(screen.getByRole('heading', { name: /Informe para la familia/i })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /imprimir o guardar PDF/i }));
    expect(print).toHaveBeenCalled();
  });
});

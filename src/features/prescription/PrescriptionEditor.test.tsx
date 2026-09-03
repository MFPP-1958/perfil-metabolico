import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PrescriptionEditor } from './PrescriptionEditor';

const context = { athleteId: 'a1', age: 30, goal: 'Mejorar potencia aeróbica', phase: 'desarrollo' as const, availableDays: 4, evidence: [{ metricCode: 'p_vo2max', value: 400, unit: 'W', observationId: 'o1', quality: 'measured' as const }] };

describe('PrescriptionEditor', () => {
  it('shows evidence and records explicit coach approval', async () => {
    const user = userEvent.setup();
    render(<PrescriptionEditor context={context} coachId="coach-1" />);
    expect(screen.getByText(/Borrador pendiente/i)).toBeVisible();
    expect(screen.getByText(/obs\. o1/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /aprobar prescripción/i }));
    expect(screen.getByText(/Aprobada por coach-1/i)).toBeVisible();
  });
});

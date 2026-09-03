import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionReview } from './SessionReview';

describe('SessionReview', () => {
  it('renders block metrics, warnings and coach notes', () => {
    render(<SessionReview planned={{ title: 'Tempo', blocks: [{ id: 'a', kind: 'work', durationSeconds: 600, target: { type: 'power', min: 250, max: 270 } }] }} completed={{ title: 'Tempo', blocks: [{ plannedKind: 'work', durationSeconds: 570, averagePower: 245, variabilityIndex: 1.05, averageHeartRate: 160, averageCadence: 88, rpe: 7 }] }} />);
    expect(screen.getByRole('table', { name: /bloques prescritos y realizados/i })).toBeVisible();
    expect(screen.getByLabelText(/notas del entrenador/i)).toBeVisible();
    expect(screen.getByText(/245 W/)).toBeVisible();
  });
});

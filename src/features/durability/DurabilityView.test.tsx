import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DurabilityView } from './DurabilityView';

it('renders matched decline with workload context and no generic score', () => {
  render(<DurabilityView fresh={{ sport: 'Ride', indoor: false, observations: 5, points: [{ seconds: 300, watts: 350 }] }} fatigued={{ sport: 'Ride', indoor: false, observations: 5, points: [{ seconds: 300, watts: 315 }] }} workload={{ priorKjPerKg: 22, priorWorkAboveCpKj: 8, intensityDistribution: { low: 70, moderate: 20, high: 10 } }} />);
  expect(screen.getByText('10,0 %')).toBeVisible();
  expect(screen.getByText(/22 kJ\/kg/)).toBeVisible();
  expect(screen.queryByText(/puntuación/)).not.toBeInTheDocument();
});

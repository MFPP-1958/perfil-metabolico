import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EvolutionView } from './EvolutionView';

const observations = [
  { value: 300, unit: 'W', metricCode: 'cp', protocol: 'ecp@1', observedAt: '2026-06-01', modelVersion: 'ecp@1.0.0', source: 'Intervals.icu' },
  { value: 308, unit: 'W', metricCode: 'cp', protocol: 'ecp@1', observedAt: '2026-08-01', modelVersion: 'ecp@1.0.0', source: 'Intervals.icu' },
  { value: 315, unit: 'W', metricCode: 'cp', protocol: 'morton@1', observedAt: '2026-09-01', modelVersion: 'morton@1.0.0', source: 'Campo' },
];

describe('EvolutionView', () => {
  it('shows provenance and uncertainty for each point', () => {
    render(<EvolutionView observations={observations} typicalError={5} />);
    expect(screen.getByRole('table', { name: /evolución de CP/i })).toBeVisible();
    expect(screen.getAllByText('Intervals.icu')).toHaveLength(2);
    expect(screen.getByText(/aumento probable/i)).toBeVisible();
  });

  it('suppresses a directional claim for a changed protocol', () => {
    render(<EvolutionView observations={observations} typicalError={5} />);
    expect(screen.getByText(/protocolos incompatibles/i)).toBeVisible();
  });
});

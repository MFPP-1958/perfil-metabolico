import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PowerDurationView } from './PowerDurationView';

describe('PowerDurationView', () => {
  it('provides a table equivalent for model and observed values', () => {
    render(<PowerDurationView input={{
      points: [{ seconds: 120, watts: 450 }, { seconds: 300, watts: 360 }, { seconds: 1200, watts: 315 }],
      sport: 'Ride', period: '90d', indoor: false,
    }} model="ECP" />);
    expect(screen.getByRole('table', { name: 'Potencia observada y modelada' })).toBeVisible();
    expect(screen.getByText('CP')).toBeVisible();
    expect(screen.getByText(/Cobertura incompleta/)).toBeVisible();
  });
});

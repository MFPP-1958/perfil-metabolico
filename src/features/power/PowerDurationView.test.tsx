import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('chart.js', () => ({
  Chart: class Chart { static register() {} destroy() {} },
  LineController: class LineController {},
  LineElement: class LineElement {},
  PointElement: class PointElement {},
  LinearScale: class LinearScale {},
  LogarithmicScale: class LogarithmicScale {},
  Tooltip: class Tooltip {},
  Legend: class Legend {},
}));
import { PowerDurationView } from './PowerDurationView';

describe('PowerDurationView', () => {
  it('provides a table equivalent for model and observed values', () => {
    render(<PowerDurationView input={{
      points: [{ seconds: 120, watts: 450 }, { seconds: 300, watts: 360 }, { seconds: 1200, watts: 315 }],
      sport: 'Ride', period: '90d', indoor: false,
    }} model="ECP" />);
    expect(screen.getByRole('table', { name: 'Potencia observada y modelada' })).toBeVisible();
    expect(screen.getByText('CP modelada')).toBeVisible();
    expect(screen.getByText(/Cobertura incompleta/)).toBeVisible();
    expect(screen.getByText('Pmax modelada')).toBeVisible();
    expect(screen.getByText('No estimada por ECP')).toBeVisible();
  });

  it('shows exact observed bests, imported FTP and model diagnostics as separate evidence', () => {
    render(<PowerDurationView input={{
      points: [{ seconds: 5, watts: 910 }, { seconds: 60, watts: 510 }, { seconds: 180, watts: 410 }, { seconds: 300, watts: 370 }, { seconds: 1200, watts: 310 }],
      sport: 'Ride', period: '08/06/2026–05/09/2026', indoor: null,
    }} model="MORTON_3P" ftp={{ value: 286, observedAt: '2026-09-05T09:00:00.000Z', quality: 'imported_estimate' }} />);

    expect(screen.getByText('Mejor 5 s')).toBeVisible();
    expect(screen.getAllByText('910 W')[0]).toBeVisible();
    expect(screen.getByText('Mejor 1 min')).toBeVisible();
    expect(screen.getByText('Mejor 5 min')).toBeVisible();
    expect(screen.getByText('Mejor 20 min')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'FTP importado' })).toBeVisible();
    expect(screen.getByText('286 W')).toBeVisible();
    expect(screen.getByText('CP modelada')).toBeVisible();
    expect(screen.getByText('RMSE')).toBeVisible();
    expect(screen.getByText('Residuos')).toBeVisible();
    expect(screen.getByText('Todas las actividades')).toBeVisible();
  });

  it('omits missing exact durations and recovers from a failed fit', () => {
    render(<PowerDurationView input={{
      points: [{ seconds: 10, watts: 850 }], sport: 'Ride', period: '30 días', indoor: true,
    }} model="ECP" />);

    expect(screen.queryByText('Mejor 5 s')).not.toBeInTheDocument();
    expect(screen.queryByText('Mejor 1 min')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No se puede ajustar este modelo' })).toBeVisible();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('chart.js', () => ({
  Chart: class Chart { static register = vi.fn(); destroy() {} },
  LineController: class LineController {},
  LineElement: class LineElement {},
  PointElement: class PointElement {},
  LinearScale: class LinearScale {},
  Tooltip: class Tooltip {},
  Legend: class Legend {},
}));

import { MaderView } from './MaderView';

const inputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹' as const, quality: 'measured' as const, observationId: 'vo2-1' },
  vlamax: { value: 0.8, unit: 'mmol·l⁻¹·s⁻¹' as const, quality: 'measured' as const, observationId: 'vla-1' },
  bodyMass: { value: 70, unit: 'kg' as const, quality: 'measured' as const, observationId: 'mass-1' },
  pVo2max: { value: 400, unit: 'W' as const, quality: 'measured' as const, observationId: 'pvo2-1' },
  comparison: { ftpWatts: 295, cpWatts: 305, lt2Watts: 290, mlssMeasuredWatts: 282 },
};

describe('MaderView', () => {
  it('labels the model experimental and keeps comparison metrics separate', () => {
    render(<MaderView inputs={inputs} />);
    expect(screen.getByRole('heading', { name: /Mader experimental/i })).toBeVisible();
    expect(screen.getByText(/no equivale a LT1/i)).toBeVisible();
    expect(screen.getByRole('table', { name: /comparación independiente/i })).toBeVisible();
    expect(screen.getByText('FTP')).toBeVisible();
    expect(screen.getByText('CP')).toBeVisible();
  });

  it('requires acknowledgement before enabling report inclusion', async () => {
    const user = userEvent.setup();
    render(<MaderView inputs={inputs} />);
    const reportButton = screen.getByRole('button', { name: /incluir en informe/i });
    expect(reportButton).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /comprendo las limitaciones/i }));
    expect(reportButton).toBeEnabled();
  });
});

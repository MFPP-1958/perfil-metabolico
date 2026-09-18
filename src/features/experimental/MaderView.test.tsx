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

  // Antes hab\u00eda aqu\u00ed un bot\u00f3n \u00abIncluir en informe\u00bb sin ninguna acci\u00f3n asociada: se
  // habilitaba al marcar la casilla y al pulsarlo no ocurr\u00eda nada ni se guardaba
  // nada. Mientras los informes no existan, la pantalla debe decirlo.
  it('no ofrece un bot\u00f3n de informe mientras el m\u00f3dulo no exista', () => {
    render(<MaderView inputs={inputs} />);
    expect(screen.queryByRole('button', { name: /incluir en informe/i })).not.toBeInTheDocument();
    expect(screen.getByText(/informes todav\u00eda est\u00e1n en construcci\u00f3n/i)).toBeInTheDocument();
  });

  it('la casilla de contraste cambia lo que se anuncia, sin prometer un guardado', async () => {
    const user = userEvent.setup();
    render(<MaderView inputs={inputs} />);
    expect(screen.getByText(/solo podr\u00e1n incluir resultados que hayas contrastado/i)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /comprendo las limitaciones/i }));

    const aviso = screen.getByText(/queda apto para incluirse/i);
    expect(aviso).toBeInTheDocument();
    expect(aviso).toHaveTextContent(/todav\u00eda no se guarda/i);
  });
});

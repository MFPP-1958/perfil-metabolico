import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PowerDurationFit } from '../../physiology/power-duration/types';

const chartState = vi.hoisted(() => ({
  configurations: [] as unknown[],
  destroy: vi.fn(),
  register: vi.fn(),
}));

vi.mock('chart.js', () => ({
  Chart: class Chart {
    static register = chartState.register;
    constructor(_canvas: HTMLCanvasElement, configuration: unknown) {
      chartState.configurations.push(configuration);
    }
    destroy() { chartState.destroy(); }
  },
  LineController: class LineController {},
  LineElement: class LineElement {},
  PointElement: class PointElement {},
  LinearScale: class LinearScale {},
  LogarithmicScale: class LogarithmicScale {},
  Tooltip: class Tooltip {},
  Legend: class Legend {},
}));

import { PowerCurveChart } from './PowerCurveChart';

const fit: PowerDurationFit = {
  model: 'ECP',
  algorithmVersion: 'pd-ecp-2p@1.0.0',
  cpWatts: 300,
  wPrimeJoules: 20_000,
  pmaxWatts: null,
  observedFiveSecondWatts: null,
  rmseWatts: 4,
  points: [
    { seconds: 120, watts: 450, modelledWatts: 447, residualWatts: 3 },
    { seconds: 300, watts: 365, modelledWatts: 368, residualWatts: -3 },
  ],
  quality: { complete: false, warnings: ['Falta un esfuerzo máximo de 15 s o menos.'] },
  context: { sport: 'Ride', period: '90 días', indoor: false },
};

describe('PowerCurveChart', () => {
  beforeEach(() => {
    chartState.configurations.length = 0;
    chartState.destroy.mockClear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('uses logarithmic time with separately labelled observed and modelled series', () => {
    render(<PowerCurveChart fit={fit} />);

    const configuration = chartState.configurations[0] as {
      data: { datasets: { label: string }[] };
      options: { scales: { x: { type: string } } };
    };
    expect(configuration.options.scales.x.type).toBe('logarithmic');
    expect(configuration.data.datasets.map((dataset) => dataset.label)).toEqual(['Potencia observada', 'Potencia modelada']);
    expect(screen.getByRole('table', { name: 'Potencia observada y modelada' })).toBeVisible();
    expect(screen.getByText('2 min')).toBeVisible();
  });

  it('disables chart animation for reduced motion and destroys the instance on unmount', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const rendered = render(<PowerCurveChart fit={fit} />);

    const configuration = chartState.configurations[0] as { options: { animation: boolean } };
    expect(configuration.options.animation).toBe(false);
    rendered.unmount();
    expect(chartState.destroy).toHaveBeenCalledOnce();
  });
});

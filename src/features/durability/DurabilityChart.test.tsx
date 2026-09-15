import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurabilityRow } from './durabilityApi';

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
  Tooltip: class Tooltip {},
  Legend: class Legend {},
}));

import { DurabilityChart } from './DurabilityChart';

const level = (afterKj: number, declinePercent: number, fatiguedWatts: number) => ({
  afterKj,
  afterKjPerKg: afterKj / 70,
  fatiguedWatts,
  declinePercent,
  quality: 'observed' as const,
  supportingActivityCount: 2,
  supportingEffortCount: 3,
  powerSource: 'measured' as const,
});

const rows: DurabilityRow[] = [
  {
    seconds: 10,
    freshWatts: 900,
    levels: { kj0: level(700, -5, 945), kj1: level(1_400, 10, 810) },
    onsetAfterKj: 1_400,
    onsetAfterKjPerKg: 20,
  },
  {
    seconds: 60,
    freshWatts: 420,
    levels: { kj0: level(700, 5, 399) },
    onsetAfterKj: 700,
    onsetAfterKjPerKg: 10,
  },
  { seconds: 300, freshWatts: 320, levels: {}, onsetAfterKj: null, onsetAfterKjPerKg: null },
  { seconds: 1_200, freshWatts: null, levels: {}, onsetAfterKj: null, onsetAfterKjPerKg: null },
];

describe('DurabilityChart', () => {
  beforeEach(() => {
    chartState.configurations.length = 0;
    chartState.destroy.mockClear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('plots accumulated work against signed decline and keeps improvement below zero', () => {
    render(<DurabilityChart rows={rows} />);

    const configuration = chartState.configurations[0] as {
      data: { datasets: Array<{ label: string; data: Array<{ x: number; y: number }> }> };
      options: { scales: { x: { beginAtZero: boolean }; y: { beginAtZero: boolean } } };
    };
    expect(configuration.options.scales.x.beginAtZero).toBe(true);
    expect(configuration.options.scales.y.beginAtZero).toBe(true);
    expect(configuration.data.datasets[0]).toMatchObject({
      label: '10 s',
      data: [{ x: 0, y: 0 }, { x: 700, y: -5 }, { x: 1_400, y: 10 }],
    });
    expect(screen.getByRole('img', { name: /descenso de potencia.*trabajo acumulado/i })).toBeVisible();
  });

  it('provides exact table values, signs and missing-level language', () => {
    render(<DurabilityChart rows={rows} />);

    const table = screen.getByRole('table', { name: 'Potencia fresca y tras trabajo acumulado' });
    const tenSeconds = within(table).getByRole('row', { name: /10 s/ });
    expect(tenSeconds).toHaveTextContent('900 W');
    expect(tenSeconds).toHaveTextContent('700 kJ');
    expect(tenSeconds).toHaveTextContent('−5,0 %');
    expect(tenSeconds).toHaveTextContent('1400 kJ');
    expect(tenSeconds).toHaveTextContent('10,0 %');
    expect(tenSeconds).toHaveTextContent('2 actividades, 3 esfuerzos');

    const fiveMinutes = within(table).getByRole('row', { name: /5 min/ });
    expect(fiveMinutes).toHaveTextContent('Nivel no disponible');
    const twentyMinutes = within(table).getByRole('row', { name: /20 min/ });
    expect(twentyMinutes).toHaveTextContent('Sin valor fresco');
  });

  it('disables animation for reduced motion and destroys the chart', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const rendered = render(<DurabilityChart rows={rows} />);

    const configuration = chartState.configurations[0] as { options: { animation: boolean } };
    expect(configuration.options.animation).toBe(false);
    rendered.unmount();
    expect(chartState.destroy).toHaveBeenCalledOnce();
  });
});

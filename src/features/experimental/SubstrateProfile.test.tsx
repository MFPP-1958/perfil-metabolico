import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chartState = vi.hoisted(() => ({
  configurations: [] as Array<{ data: { datasets: Array<{ label: string; data: Array<{ x: number; y: number }> }> } }>,
  destroy: vi.fn(),
}));

vi.mock('chart.js', () => ({
  Chart: class Chart {
    static register = vi.fn();
    constructor(_canvas: HTMLCanvasElement, configuration: never) {
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

import { MaderView } from './MaderView';

const inputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹' as const, quality: 'measured' as const, observationId: 'vo2-1' },
  vlamax: { value: 0.8, unit: 'mmol·l⁻¹·s⁻¹' as const, quality: 'measured' as const, observationId: 'vla-1' },
  bodyMass: { value: 70, unit: 'kg' as const, quality: 'measured' as const, observationId: 'mass-1' },
  pVo2max: { value: 400, unit: 'W' as const, quality: 'measured' as const, observationId: 'pvo2-1' },
};

describe('substrate profile in the Mader view', () => {
  beforeEach(() => { chartState.configurations.length = 0; });

  it('shows fat and carbohydrate use at the model anchors', () => {
    render(<MaderView inputs={inputs} />);
    expect(screen.getByRole('heading', { name: /metabolismo de sustratos/i })).toBeVisible();
    const table = screen.getByRole('table', { name: /sustratos en los puntos del modelo/i });
    const fatmax = within(table).getByRole('row', { name: /FATmax/ });
    expect(within(fatmax).getByText(/g\/min/)).toBeVisible();
    expect(within(fatmax).getByText(/g\/h/)).toBeVisible();
    expect(within(fatmax).getByText(/kcal\/h/)).toBeVisible();
    expect(within(table).getByRole('row', { name: /MLSS/ })).toBeVisible();
  });

  it('plots fat oxidation and carbohydrate cost against power', () => {
    render(<MaderView inputs={inputs} />);
    const labels = chartState.configurations.at(-1)?.data.datasets.map((dataset) => dataset.label);
    expect(labels).toEqual(['Grasa (g/min)', 'Carbohidrato (g/h)']);
    expect(screen.getByRole('img', { name: /oxidación de grasa y consumo de carbohidrato/i })).toBeInTheDocument();
  });

  it('states that the split is not indirect calorimetry', () => {
    render(<MaderView inputs={inputs} />);
    expect(screen.getByText(/no de calorimetría indirecta/i)).toBeVisible();
  });

  it('warns when VLa-max comes from third-party software', () => {
    render(<MaderView inputs={{
      ...inputs,
      vlamax: { ...inputs.vlamax, quality: 'calculated', sourceReference: { software: 'WKO5' } },
    }} />);
    expect(screen.getByText(/VLa máx procede de WKO5/i)).toBeVisible();
  });

  it('hides the substrate profile when the model is blocked', () => {
    render(<MaderView inputs={{ ...inputs, vlamax: { ...inputs.vlamax, quality: 'imported_estimate' } }} />);
    expect(screen.queryByRole('heading', { name: /metabolismo de sustratos/i })).not.toBeInTheDocument();
  });
});

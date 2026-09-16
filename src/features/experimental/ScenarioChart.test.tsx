import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildMetabolicScenario } from '../../physiology/scenarios/scenario';
import type { MaderInputs } from '../../physiology/mader/model';

// jsdom no implementa el lienzo: chart.js se sustituye por dobles, siguiendo el
// patrón de SubstrateProfile.test.tsx. Lo que se prueba es el texto alrededor
// del gráfico, no los píxeles.
const chartState = vi.hoisted(() => ({
  configurations: [] as Array<{ data: { datasets: Array<{ label: string }> } }>,
  destroy: vi.fn(),
}));

vi.mock('chart.js', () => ({
  Chart: class Chart {
    static register = vi.fn();
    chartArea = { top: 0, bottom: 0 };
    scales = {};
    ctx = {};
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

import { ScenarioChart } from './ScenarioChart';

const inputs: MaderInputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'o-vo2' },
  vlamax: { value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'o-vla' },
  bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'o-masa' },
  pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'o-pvo2' },
};

function scenario() {
  const result = buildMetabolicScenario(inputs, { restingVo2: 5 }, { vlamax: 0.8 });
  if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
  return result;
}

describe('ScenarioChart', () => {
  it('describe las dos curvas con sus cifras en la alternativa textual', () => {
    const result = scenario();
    render(<ScenarioChart scenario={result} ftpWatts={295} />);
    const image = screen.getByRole('img');
    const description = image.getAttribute('aria-label') ?? '';
    expect(description).toMatch(/perfil actual/i);
    expect(description).toMatch(/perfil objetivo/i);
    expect(description).toMatch(new RegExp(`${Math.round(result.current.fatmax.powerWatts)} W`));
    expect(description).toMatch(new RegExp(`${Math.round(result.target.fatmax.powerWatts)} W`));
  });

  it('genera el título desde los mismos valores que dibuja', () => {
    const result = scenario();
    render(<ScenarioChart scenario={result} ftpWatts={295} />);
    const heading = screen.getByRole('heading', { level: 3 }).textContent ?? '';
    expect(heading).toContain(`${Math.round(result.current.fatmax.powerWatts)} W`);
    expect(heading).toContain(`${Math.round(result.target.fatmax.powerWatts)} W`);
  });

  it('distingue el perfil objetivo por algo más que el color', () => {
    render(<ScenarioChart scenario={scenario()} ftpWatts={295} />);
    expect(screen.getByText(/trazo discontinuo/i)).toBeInTheDocument();
  });

  it('advierte cuando la curva objetivo agota la grasa dentro del rango dibujado', () => {
    render(<ScenarioChart scenario={scenario()} ftpWatts={295} />);
    expect(screen.getByText(/artefacto de la formulación/i)).toBeInTheDocument();
  });

  it('avisa de que no hay FTP medido cuando no se pasa', () => {
    render(<ScenarioChart scenario={scenario()} />);
    expect(screen.getByText(/sin FTP medido/i)).toBeInTheDocument();
  });
});

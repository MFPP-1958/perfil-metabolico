import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MaderInputs } from '../../physiology/mader/model';
import { ScenarioPanel } from './ScenarioPanel';

vi.mock('chart.js', () => ({
  Chart: class Chart {
    static register = vi.fn();
    constructor() {}
    destroy() {}
  },
  LineController: class LineController {},
  LineElement: class LineElement {},
  PointElement: class PointElement {},
  LinearScale: class LinearScale {},
  Tooltip: class Tooltip {},
  Legend: class Legend {},
}));

const inputs: MaderInputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'o-vo2' },
  vlamax: { value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'o-vla' },
  bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'o-masa' },
  pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'o-pvo2' },
  comparison: { ftpWatts: 295 },
};

describe('ScenarioPanel', () => {
  it('no calcula nada hasta que se propone una VLa máx objetivo', () => {
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/Propón una VLa máx objetivo/i)).toBeInTheDocument();
  });

  it('compara los dos perfiles al introducir el objetivo', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
    expect(await screen.findByRole('img')).toBeInTheDocument();
    expect(screen.getByText(/Qué cuesta el cambio/i)).toBeInTheDocument();
  });

  it('marca cada cifra objetivo con la palabra objetivo', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
    const tabla = await screen.findByRole('table', { name: /comparación de perfiles/i });
    expect(tabla).toHaveTextContent(/objetivo/i);
  });

  it('avisa fuera del rango del catálogo sin llegar a calcular', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '7');
    expect(await screen.findByRole('alert')).toHaveTextContent(/fuera del rango/i);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('acepta la coma decimal española y calcula el escenario', async () => {
    // La propia pantalla devuelve las cifras con coma (`toLocaleString`
    // 'es-ES'); un entrenador que escribe "0,8" está usando la misma
    // notación que ve, no cometiendo un error.
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0,8');
    expect(await screen.findByRole('img')).toBeInTheDocument();
    expect(screen.getByText(/Qué cuesta el cambio/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('distingue un valor que no es un número de uno que está fuera de rango', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), 'abc');
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/no es un número válido/i);
    expect(alerta).not.toHaveTextContent(/fuera del rango/i);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('muestra la banda orientativa con su población y su cita para un perfil que sí la tiene', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.selectOptions(screen.getByLabelText(/Perfil de la prueba/i), 'explosiva');
    const banda = screen.getByTestId('banda-orientativa');
    expect(banda).toHaveTextContent(/doi/i);
    expect(banda).toHaveTextContent(/orientación/i);
  });

  it('declara que no hay banda publicada para un perfil que no la tiene', async () => {
    // Tres de los cuatro perfiles de prueba no tienen banda sustentada en las
    // fuentes del proyecto: es el caso común, no la excepción. `rodador` es
    // uno de ellos y además el valor por defecto del selector.
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.selectOptions(screen.getByLabelText(/Perfil de la prueba/i), 'rodador');
    expect(screen.queryByTestId('banda-orientativa')).not.toBeInTheDocument();
    expect(screen.getByText(/no tiene banda publicada en las fuentes del proyecto/i)).toBeInTheDocument();
  });

  it('añade el aviso de maduración en un menor', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor />);
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
    expect(await screen.findByText(/maduración/i)).toBeInTheDocument();
  });

  it('declara siempre que el perfil objetivo es una hipótesis', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
    expect(await screen.findByText(/hipótesis de trabajo del entrenador/i)).toBeInTheDocument();
  });
});

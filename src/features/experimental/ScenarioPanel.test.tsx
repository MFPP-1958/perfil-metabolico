import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisContext, type AnalysisContextValue } from '../../analysis/AnalysisContext';
import type { MaderInputs } from '../../physiology/mader/model';
import { ScenarioPanel } from './ScenarioPanel';
import type { SavedScenario, ScenarioApi } from './scenarioApi';

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

const athleteId = '11111111-1111-4111-8111-111111111111';

const inputs: MaderInputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'o-vo2' },
  vlamax: { value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'o-vla' },
  bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'o-masa' },
  pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'o-pvo2' },
  comparison: { ftpWatts: 295 },
};

function analysisContext(overrides: Partial<AnalysisContextValue> = {}): AnalysisContextValue {
  return {
    athletes: [], athleteId, athlete: null, period: { preset: 90 }, environment: 'all',
    today: '2026-09-16', sync: { status: 'idle' }, loadingRoster: false, loadingAthlete: false,
    error: '', selectAthlete: () => undefined, setPeriod: () => undefined, setEnvironment: () => undefined,
    synchronize: async () => undefined, reloadRoster: async () => undefined,
    addObservation: async () => undefined, clearError: () => undefined,
    ...overrides,
  } as unknown as AnalysisContextValue;
}

function savedScenarioFixture(overrides: Partial<SavedScenario> = {}): SavedScenario {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    athleteId,
    createdBy: '22222222-2222-4222-8222-222222222222',
    scenarioName: 'Techo glucolítico para el esprint',
    rationale: 'Sube la VLa máx para el esprint final del campeonato.',
    eventProfile: 'rodador',
    realInputs: inputs,
    targets: { vlamax: 0.8 },
    referencePowerWatts: 295,
    config: { restingVo2: 5 },
    modelVersions: { mader: 'mader@1', scenario: 'scenario@1' },
    outcome: { status: 'blocked', reasons: [], version: 'scenario@1' },
    contentHash: 'hash-1',
    createdAt: '2026-09-16T12:00:00.000Z',
    ...overrides,
  } as SavedScenario;
}

function fakeApi(overrides: Partial<ScenarioApi> = {}): ScenarioApi {
  return {
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(savedScenarioFixture()),
    ...overrides,
  };
}

function renderPanel(options: { api?: ScenarioApi; minor?: boolean; context?: Partial<AnalysisContextValue> } = {}) {
  return render(
    <AnalysisContext.Provider value={analysisContext(options.context)}>
      <ScenarioPanel inputs={inputs} minor={options.minor ?? false} api={options.api ?? fakeApi()} />
    </AnalysisContext.Provider>,
  );
}

describe('ScenarioPanel', () => {
  it('no calcula nada hasta que se propone una VLa máx objetivo', async () => {
    renderPanel();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(await screen.findByText(/Propón una VLa máx objetivo/i)).toBeInTheDocument();
  });

  it('compara los dos perfiles al introducir el objetivo', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
    expect(await screen.findByRole('img')).toBeInTheDocument();
    expect(screen.getByText(/Qué cuesta el cambio/i)).toBeInTheDocument();
  });

  it('marca cada cifra objetivo con la palabra objetivo', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
    const tabla = await screen.findByRole('table', { name: /comparación de perfiles/i });
    expect(tabla).toHaveTextContent(/objetivo/i);
  });

  it('avisa fuera del rango del catálogo sin llegar a calcular', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '7');
    expect(await screen.findByRole('alert')).toHaveTextContent(/fuera del rango/i);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('acepta la coma decimal española y calcula el escenario', async () => {
    // La propia pantalla devuelve las cifras con coma (`toLocaleString`
    // 'es-ES'); un entrenador que escribe "0,8" está usando la misma
    // notación que ve, no cometiendo un error.
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0,8');
    expect(await screen.findByRole('img')).toBeInTheDocument();
    expect(screen.getByText(/Qué cuesta el cambio/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('distingue un valor que no es un número de uno que está fuera de rango', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), 'abc');
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/no es un número válido/i);
    expect(alerta).not.toHaveTextContent(/fuera del rango/i);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('muestra la banda orientativa con su población y su cita para un perfil que sí la tiene', async () => {
    const user = userEvent.setup();
    renderPanel();
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
    renderPanel();
    await user.selectOptions(screen.getByLabelText(/Perfil de la prueba/i), 'rodador');
    expect(screen.queryByTestId('banda-orientativa')).not.toBeInTheDocument();
    expect(screen.getByText(/no tiene banda publicada en las fuentes del proyecto/i)).toBeInTheDocument();
  });

  it('añade el aviso de maduración en un menor', async () => {
    const user = userEvent.setup();
    renderPanel({ minor: true });
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
    expect(await screen.findByText(/maduración/i)).toBeInTheDocument();
  });

  it('declara siempre que el perfil objetivo es una hipótesis', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
    expect(await screen.findByText(/hipótesis de trabajo del entrenador/i)).toBeInTheDocument();
  });

  describe('guardar el escenario', () => {
    it('mantiene el botón de guardar deshabilitado mientras falte nombre o justificación', async () => {
      const user = userEvent.setup();
      renderPanel();
      await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
      const guardar = await screen.findByRole('button', { name: /guardar escenario/i });
      expect(guardar).toBeDisabled();

      await user.type(screen.getByLabelText(/nombre del escenario/i), 'Techo glucolítico');
      expect(guardar).toBeDisabled();

      await user.type(screen.getByLabelText(/justificaci/i), 'Sube la VLa máx para el esprint final.');
      expect(guardar).toBeEnabled();
    });

    it('deshabilita el guardado cuando el objetivo coincide con el perfil real y no hay nada que comparar', async () => {
      const user = userEvent.setup();
      renderPanel();
      // 0.4 es exactamente la VLa máx real del ciclista de prueba: no hay diferencia que comparar.
      await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.4');
      await user.type(screen.getByLabelText(/nombre del escenario/i), 'Techo glucolítico');
      await user.type(screen.getByLabelText(/justificaci/i), 'Sube la VLa máx para el esprint final.');
      expect(await screen.findByRole('button', { name: /guardar escenario/i })).toBeDisabled();
    });

    it('al guardar envía las entradas reales, los objetivos y la potencia de referencia', async () => {
      const user = userEvent.setup();
      const api = fakeApi();
      renderPanel({ api });
      await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
      await user.type(screen.getByLabelText(/nombre del escenario/i), 'Techo glucolítico');
      await user.type(screen.getByLabelText(/justificaci/i), 'Sube la VLa máx para el esprint final.');
      await user.click(await screen.findByRole('button', { name: /guardar escenario/i }));

      await screen.findByText(/Techo glucolítico/i);
      expect(api.save).toHaveBeenCalledWith({
        athleteId,
        scenarioName: 'Techo glucolítico',
        rationale: 'Sube la VLa máx para el esprint final.',
        eventProfile: 'rodador',
        realInputs: inputs,
        targets: { vlamax: 0.8 },
        referencePowerWatts: expect.any(Number),
        config: { restingVo2: 5 },
      });
    });

    it('un escenario guardado aparece en la lista con su fecha y su nombre', async () => {
      const user = userEvent.setup();
      const api = fakeApi({
        save: vi.fn().mockResolvedValue(savedScenarioFixture({
          scenarioName: 'Techo glucolítico para el esprint',
          createdAt: '2026-09-16T12:00:00.000Z',
        })),
      });
      renderPanel({ api });
      await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
      await user.type(screen.getByLabelText(/nombre del escenario/i), 'Techo glucolítico para el esprint');
      await user.type(screen.getByLabelText(/justificaci/i), 'Sube la VLa máx para el esprint final.');
      await user.click(await screen.findByRole('button', { name: /guardar escenario/i }));

      const lista = await screen.findByRole('list', { name: /escenarios guardados/i });
      expect(lista).toHaveTextContent('Techo glucolítico para el esprint');
      expect(lista).toHaveTextContent('16/09/2026');
    });

    it('un fallo del servidor deja el formulario intacto y muestra el mensaje', async () => {
      const user = userEvent.setup();
      const api = fakeApi({
        save: vi.fn().mockRejectedValue(new Error('No se pudo completar la operación con el escenario.')),
      });
      renderPanel({ api });
      await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
      await user.type(screen.getByLabelText(/nombre del escenario/i), 'Techo glucolítico');
      await user.type(screen.getByLabelText(/justificaci/i), 'Sube la VLa máx para el esprint final.');
      await user.click(await screen.findByRole('button', { name: /guardar escenario/i }));

      expect(await screen.findByText('No se pudo completar la operación con el escenario.')).toBeInTheDocument();
      expect(screen.getByLabelText(/nombre del escenario/i)).toHaveValue('Techo glucolítico');
      expect(screen.getByLabelText(/justificaci/i)).toHaveValue('Sube la VLa máx para el esprint final.');
    });

    it('recupera los escenarios guardados del ciclista al montar el panel', async () => {
      const api = fakeApi({
        list: vi.fn().mockResolvedValue([savedScenarioFixture()]),
      });
      renderPanel({ api });
      const lista = await screen.findByRole('list', { name: /escenarios guardados/i });
      expect(lista).toHaveTextContent('Techo glucolítico para el esprint');
      expect(api.list).toHaveBeenCalledWith(athleteId, expect.any(AbortSignal));
    });
  });
});

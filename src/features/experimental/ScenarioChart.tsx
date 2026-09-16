import { useEffect, useRef } from 'react';
import {
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import type { ChartOptions } from 'chart.js';
import type { SubstratePoint } from '../../physiology/substrates/metabolism';
import type { MetabolicScenarioResult } from '../../physiology/scenarios/scenario';

export type CalculatedScenario = Extract<MetabolicScenarioResult, { status: 'calculated' }>;

interface Marker { x: number; y: number; label: string }

interface AnnotationOptions {
  markers: Marker[];
  ftp?: number;
  colours: { current: string; target: string; muted: string };
}

// Chart.js no conoce este complemento en su registro de tipos (no se instala
// chartjs-plugin-annotation). Este tipo local añade la clave de configuración
// sin tocar el espacio de nombres global de la librería.
type PluginsWithAnnotations = NonNullable<ChartOptions<'line'>['plugins']> & {
  'escenario-anotaciones': AnnotationOptions;
};

// Complemento propio: no se instala chartjs-plugin-annotation. Dibuja la
// referencia vertical de FTP y los marcadores de FATmax sobre el lienzo ya
// trazado por Chart.js, leyendo el eje `fat` que declaran los dos conjuntos.
const annotationPlugin = {
  id: 'escenario-anotaciones',
  afterDatasetsDraw(chart: Chart, _args: unknown, options: AnnotationOptions) {
    const { ctx, scales } = chart;
    ctx.save();
    if (options.ftp != null) {
      const x = scales.x.getPixelForValue(options.ftp);
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = options.colours.muted;
      ctx.beginPath();
      ctx.moveTo(x, chart.chartArea.top);
      ctx.lineTo(x, chart.chartArea.bottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const marker of options.markers) {
      const x = scales.x.getPixelForValue(marker.x);
      const y = scales.fat.getPixelForValue(marker.y);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(marker.label, x + 10, y - 10);
    }
    ctx.restore();
  },
};

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend, annotationPlugin);

function format(value: number, decimals = 0) {
  return value.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const anchorLabel = (prefix: string, point: SubstratePoint) =>
  `${prefix} ${format(point.powerWatts)} W (${format(point.fatOxidationGramsPerMin, 2)} g/min)`;

function scenarioTitle(scenario: CalculatedScenario) {
  const { realValues, appliedTargets } = scenario;
  const verb = appliedTargets.vlamax === realValues.vlamax
    ? 'Mantener'
    : appliedTargets.vlamax > realValues.vlamax
      ? 'Subir'
      : 'Bajar';
  return `${verb} la VLa máx de ${format(realValues.vlamax, 2)} a ${format(appliedTargets.vlamax, 2)} desplaza el FATmax de ${format(scenario.current.fatmax.powerWatts)} W a ${format(scenario.target.fatmax.powerWatts)} W`;
}

function chartAlternative(scenario: CalculatedScenario) {
  return [
    'Gráfico comparado de oxidación de grasa según la potencia, perfil actual frente a perfil objetivo.',
    `Perfil actual: ${anchorLabel('FATmax', scenario.current.fatmax)}, ${anchorLabel('MLSS', scenario.current.mlss)}.`,
    `Perfil objetivo: ${anchorLabel('FATmax', scenario.target.fatmax)}, ${anchorLabel('MLSS', scenario.target.mlss)}.`,
  ].join(' ');
}

/**
 * El MLSS objetivo llega a cero gramos de grasa por minuto por construcción del
 * modelo (deficit de piruvato nulo). Avisar de ese artefacto solo tiene sentido
 * cuando ese punto cae dentro de la ventana de potencia que el lienzo dibuja.
 */
function targetMlssWithinDrawnRange(scenario: CalculatedScenario): boolean {
  let min = Infinity;
  let max = -Infinity;
  for (const curve of [scenario.current.curve, scenario.target.curve]) {
    for (const point of curve) {
      if (point.powerWatts < min) min = point.powerWatts;
      if (point.powerWatts > max) max = point.powerWatts;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
  const mlssWatts = scenario.target.mlss.powerWatts;
  return mlssWatts >= min && mlssWatts <= max;
}

export function ScenarioChart({ scenario, ftpWatts }: { scenario: CalculatedScenario; ftpWatts?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    const muted = token('--muted', '#526970');
    const grid = token('--line', '#c9d6da');
    const ink = token('--ink', '#142c35');
    // El perfil actual es lo medido; el objetivo es la hipótesis. Se reutilizan
    // los mismos tokens de "validado" e "incierto" que el resto del panel.
    const currentColour = token('--validated', '#1c776a');
    const targetColour = token('--uncertain', '#b96a08');

    const plugins: PluginsWithAnnotations = {
      legend: { position: 'bottom', labels: { color: ink, usePointStyle: true } },
      tooltip: {
        callbacks: {
          title: (items) => `${format(Number(items[0]?.parsed.x ?? 0))} W`,
          label: (item) => `${item.dataset.label}: ${format(Number(item.parsed.y), 2)} g/min`,
        },
      },
      'escenario-anotaciones': {
        markers: [
          {
            x: scenario.current.fatmax.powerWatts,
            y: scenario.current.fatmax.fatOxidationGramsPerMin,
            label: anchorLabel('FATmax actual', scenario.current.fatmax),
          },
          {
            x: scenario.target.fatmax.powerWatts,
            y: scenario.target.fatmax.fatOxidationGramsPerMin,
            label: anchorLabel('FATmax objetivo', scenario.target.fatmax),
          },
        ],
        ftp: ftpWatts,
        colours: { current: currentColour, target: targetColour, muted },
      },
    };

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Perfil actual',
            data: scenario.current.curve.map((point) => ({ x: point.powerWatts, y: point.fatOxidationGramsPerMin })),
            borderColor: currentColour,
            backgroundColor: currentColour,
            yAxisID: 'fat',
            pointRadius: 0,
            borderWidth: 2,
            borderDash: [],
          },
          {
            label: 'Perfil objetivo',
            data: scenario.target.curve.map((point) => ({ x: point.powerWatts, y: point.fatOxidationGramsPerMin })),
            borderColor: targetColour,
            backgroundColor: targetColour,
            yAxisID: 'fat',
            pointRadius: 0,
            borderWidth: 2,
            borderDash: [8, 4],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion ? false : { duration: 250 },
        parsing: false,
        normalized: true,
        interaction: { intersect: false, mode: 'index' },
        plugins,
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Potencia (W)', color: muted },
            ticks: { color: muted },
            grid: { color: grid },
          },
          fat: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            title: { display: true, text: 'Grasa (g/min)', color: muted },
            ticks: { color: muted },
            grid: { color: grid },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [scenario, ftpWatts]);

  const title = scenarioTitle(scenario);

  return (
    <section className="scenario-chart" aria-labelledby="scenario-chart-title">
      <h3 id="scenario-chart-title">{title}</h3>
      <p className="scenario-chart__legend">Perfil actual, trazo continuo. Perfil objetivo, trazo discontinuo.</p>
      <div className="substrate-profile__canvas">
        <canvas ref={canvasRef} role="img" aria-label={chartAlternative(scenario)} />
      </div>
      {targetMlssWithinDrawnRange(scenario) && (
        <p className="model-warning">
          La curva objetivo llega a cero gramos por minuto en su MLSS modelado, de {format(scenario.target.mlss.powerWatts)} W.
          {' '}La extinción completa de la oxidación de grasas es un artefacto de la formulación, no una afirmación fisiológica.
        </p>
      )}
      {ftpWatts == null && (
        <p className="model-warning">Sin FTP medido: el gráfico se dibuja sin la referencia de FTP.</p>
      )}
    </section>
  );
}

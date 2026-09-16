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
import type { SubstratePoint, SubstrateProfileResult } from '../../physiology/substrates/metabolism';
import { SUBSTRATE_REFERENCES } from '../../physiology/substrates/references';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend);

type CalculatedProfile = Extract<SubstrateProfileResult, { status: 'calculated' }>;

function number(value: number, decimals = 0) {
  return value.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function chartAlternative(profile: CalculatedProfile) {
  const anchor = (label: string, point: SubstratePoint) =>
    `${label} a ${number(point.powerWatts)} W: grasa ${number(point.fatOxidationGramsPerMin, 2)} g/min, carbohidrato ${number(point.carbohydrateGramsPerHour)} g/h`;
  return `Gráfico de oxidación de grasa y consumo de carbohidrato según la potencia. ${anchor('FATmax', profile.fatmax)}. ${anchor('MLSS', profile.mlss)}.`;
}

export function SubstrateProfile({ profile }: { profile: CalculatedProfile }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    const muted = token('--muted', '#526970');
    const grid = token('--line', '#c9d6da');
    const fatColour = token('--validated', '#1c776a');
    const carbohydrateColour = token('--uncertain', '#b96a08');

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Grasa (g/min)',
            data: profile.curve.map((point) => ({ x: point.powerWatts, y: point.fatOxidationGramsPerMin })),
            borderColor: fatColour,
            backgroundColor: fatColour,
            yAxisID: 'fat',
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: 'Carbohidrato (g/h)',
            data: profile.curve.map((point) => ({ x: point.powerWatts, y: point.carbohydrateGramsPerHour })),
            borderColor: carbohydrateColour,
            backgroundColor: carbohydrateColour,
            yAxisID: 'carbohydrate',
            pointRadius: 0,
            borderWidth: 2,
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
        plugins: {
          legend: { position: 'bottom', labels: { color: token('--ink', '#142c35'), usePointStyle: true } },
          tooltip: {
            callbacks: {
              title: (items) => `${number(Number(items[0]?.parsed.x ?? 0))} W`,
              label: (item) => item.dataset.yAxisID === 'fat'
                ? `Grasa: ${number(Number(item.parsed.y), 2)} g/min`
                : `Carbohidrato: ${number(Number(item.parsed.y))} g/h`,
            },
          },
        },
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
            title: { display: true, text: 'Grasa (g/min)', color: fatColour },
            ticks: { color: muted },
            grid: { color: grid },
          },
          carbohydrate: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            title: { display: true, text: 'Carbohidrato (g/h)', color: carbohydrateColour },
            ticks: { color: muted },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [profile]);

  const anchors: Array<[string, SubstratePoint]> = [['FATmax', profile.fatmax], ['MLSS', profile.mlss]];

  return (
    <section className="substrate-profile" aria-labelledby="substrate-title">
      <div className="substrate-profile__heading">
        <h2 id="substrate-title">Metabolismo de sustratos</h2>
        <span className="model-version">{profile.version}</span>
      </div>
      <p>Uso de grasa y carbohidrato por vatio, derivado del mismo barrido que MLSS y FATmax.</p>
      <div className="substrate-profile__canvas">
        <canvas ref={canvasRef} role="img" aria-label={chartAlternative(profile)} />
      </div>
      <div className="durability-table-scroll" tabIndex={0} aria-label="Tabla desplazable de sustratos">
        <table aria-label="Sustratos en los puntos del modelo">
          <thead>
            <tr><th>Punto</th><th>Potencia</th><th>% VO₂max</th><th>Grasa</th><th>Carbohidrato</th><th>Gasto energético</th></tr>
          </thead>
          <tbody>{anchors.map(([label, point]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{number(point.powerWatts)} W</td>
              <td>{number(point.percentVo2max)} %</td>
              <td>{number(point.fatOxidationGramsPerMin, 2)} g/min</td>
              <td>{number(point.carbohydrateGramsPerHour)} g/h</td>
              <td>{number(point.energyKcalPerHour)} kcal/h</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <ul className="substrate-profile__limits" aria-label="Limitaciones del reparto de sustratos">
        {profile.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
      </ul>
      <details><summary>Fuentes del reparto de sustratos</summary><ul>{SUBSTRATE_REFERENCES.map((reference) => <li key={reference}>{reference}</li>)}</ul></details>
    </section>
  );
}

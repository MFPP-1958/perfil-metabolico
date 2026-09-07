import { useEffect, useRef } from 'react';
import {
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  LogarithmicScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import type { PowerDurationFit } from '../../physiology/power-duration/types';

Chart.register(LineController, LineElement, PointElement, LinearScale, LogarithmicScale, Tooltip, Legend);

function durationLabel(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

export function PowerCurveChart({ fit }: { fit: PowerDurationFit }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Potencia observada',
            data: fit.points.map((point) => ({ x: point.seconds, y: point.watts })),
            borderColor: token('--data', '#2459d3'),
            backgroundColor: token('--data', '#2459d3'),
            pointRadius: 4,
            borderWidth: 2,
            showLine: true,
          },
          {
            label: 'Potencia modelada',
            data: fit.points.map((point) => ({ x: point.seconds, y: point.modelledWatts })),
            borderColor: token('--uncertain', '#b96a08'),
            backgroundColor: token('--uncertain', '#b96a08'),
            pointRadius: 2,
            borderDash: [7, 5],
            borderWidth: 2,
            showLine: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion ? false : { duration: 250 },
        parsing: false,
        normalized: true,
        interaction: { intersect: false, mode: 'nearest' },
        plugins: {
          legend: { position: 'bottom', labels: { color: token('--ink', '#142c35'), usePointStyle: true } },
          tooltip: {
            callbacks: {
              title: (items) => durationLabel(Number(items[0]?.parsed.x ?? 0)),
              label: (item) => `${item.dataset.label}: ${Number(item.parsed.y).toFixed(0)} W`,
            },
          },
        },
        scales: {
          x: {
            type: 'logarithmic',
            title: { display: true, text: 'Duración', color: token('--muted', '#526970') },
            ticks: { color: token('--muted', '#526970') },
            grid: { color: token('--line', '#c9d6da') },
          },
          y: {
            type: 'linear',
            beginAtZero: false,
            title: { display: true, text: 'Potencia (W)', color: token('--muted', '#526970') },
            ticks: { color: token('--muted', '#526970') },
            grid: { color: token('--line', '#c9d6da') },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [fit]);

  return (
    <section className="power-curve" aria-labelledby="power-curve-title">
      <h2 id="power-curve-title">Curva observada y modelada</h2>
      <div className="power-curve__canvas">
        <canvas ref={canvasRef} role="img" aria-label="Curva de potencia observada y modelada según duración" />
      </div>
      <div className="power-table-scroll" tabIndex={0} aria-label="Tabla desplazable de potencia">
        <table aria-label="Potencia observada y modelada">
          <thead><tr><th>Duración</th><th>Observada</th><th>Modelada</th><th>Residuo</th></tr></thead>
          <tbody>{fit.points.map((point) => (
            <tr key={point.seconds}>
              <td>{durationLabel(point.seconds)}</td>
              <td>{point.watts.toFixed(0)} W</td>
              <td>{point.modelledWatts.toFixed(0)} W</td>
              <td>{point.residualWatts.toFixed(1)} W</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

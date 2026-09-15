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
import type { DurabilityLevelResult, DurabilityRow } from './durabilityApi';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend);

const durations = new Map<number, string>([
  [10, '10 s'],
  [60, '1 min'],
  [300, '5 min'],
  [1_200, '20 min'],
]);

function durationLabel(seconds: number) {
  return durations.get(seconds) ?? `${seconds} s`;
}

function watts(value: number | null) {
  return value === null ? 'Sin valor fresco' : `${value.toLocaleString('es-ES', { maximumFractionDigits: 0 })} W`;
}

function percentage(value: number | null) {
  if (value === null) return 'Sin descenso calculado';
  const formatted = Math.abs(value).toLocaleString('es-ES', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${value < 0 ? '−' : ''}${formatted} %`;
}

function work(afterKj: number, afterKjPerKg: number | null) {
  const absolute = `${afterKj.toLocaleString('es-ES', { maximumFractionDigits: 0 })} kJ`;
  if (afterKjPerKg === null) return absolute;
  return `${absolute}; ${afterKjPerKg.toLocaleString('es-ES', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} kJ/kg`;
}

function qualityLabel(quality: DurabilityLevelResult['quality']) {
  if (quality === 'observed') return 'Observado';
  if (quality === 'incompatible') return 'Contexto incompatible';
  return 'Datos insuficientes';
}

function sourceLabel(source: DurabilityLevelResult['powerSource']) {
  return source === 'measured' ? 'Potencia medida' : 'Procedencia desconocida';
}

function LevelCell({ level }: { level?: DurabilityLevelResult }) {
  if (!level) return <span className="durability-unavailable">Nivel no disponible</span>;
  return (
    <div className="durability-cell">
      <strong>{level.fatiguedWatts === null ? 'Sin potencia' : `${level.fatiguedWatts.toLocaleString('es-ES', { maximumFractionDigits: 0 })} W`}</strong>
      <span className={level.declinePercent !== null && level.declinePercent < 0 ? 'durability-change durability-change--gain' : 'durability-change'}>
        {percentage(level.declinePercent)} de descenso
      </span>
      <small>{work(level.afterKj, level.afterKjPerKg)}</small>
      <small>{qualityLabel(level.quality)}. {sourceLabel(level.powerSource)}.</small>
      <small>{level.supportingActivityCount} actividades, {level.supportingEffortCount} esfuerzos</small>
    </div>
  );
}

export function DurabilityChart({ rows }: { rows: readonly DurabilityRow[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    const palette = [
      token('--data', '#2459d3'),
      token('--validated', '#1c776a'),
      token('--uncertain', '#b96a08'),
      token('--danger', '#b43b3b'),
    ];
    const datasets = rows.flatMap((row, index) => {
      const points = (['kj0', 'kj1'] as const)
        .flatMap((level) => {
          const value = row.levels[level];
          return value?.declinePercent === null || value?.declinePercent === undefined
            ? []
            : [{ x: value.afterKj, y: value.declinePercent }];
        })
        .sort((left, right) => left.x - right.x);
      if (!points.length) return [];
      return [{
        label: durationLabel(row.seconds),
        data: [{ x: 0, y: 0 }, ...points],
        borderColor: palette[index % palette.length],
        backgroundColor: palette[index % palette.length],
        pointRadius: 4,
        borderWidth: 2,
        tension: 0,
        showLine: true,
      }];
    });

    const chart = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion ? false : { duration: 250 },
        parsing: false,
        normalized: true,
        interaction: { intersect: false, mode: 'nearest' },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: token('--ink', '#142c35'), usePointStyle: true },
          },
          tooltip: {
            callbacks: {
              title: (items) => `${Number(items[0]?.parsed.x ?? 0).toLocaleString('es-ES')} kJ acumulados`,
              label: (item) => `${item.dataset.label}: ${percentage(Number(item.parsed.y))}`,
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            beginAtZero: true,
            title: { display: true, text: 'Trabajo acumulado (kJ)', color: token('--muted', '#526970') },
            ticks: { color: token('--muted', '#526970') },
            grid: { color: token('--line', '#c9d6da') },
          },
          y: {
            type: 'linear',
            beginAtZero: true,
            title: { display: true, text: 'Descenso de potencia (%)', color: token('--muted', '#526970') },
            ticks: { color: token('--muted', '#526970') },
            grid: {
              color: (context) => context.tick.value === 0
                ? token('--ink', '#142c35')
                : token('--line', '#c9d6da'),
              lineWidth: (context) => context.tick.value === 0 ? 2 : 1,
            },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [rows]);

  return (
    <section className="durability-profile" aria-labelledby="durability-profile-title">
      <div className="durability-profile__heading">
        <div>
          <h2 id="durability-profile-title">Perfil de caída por trabajo acumulado</h2>
          <p>Los valores bajo cero indican una mejora frente al registro fresco.</p>
        </div>
        <div className="durability-zero-key"><span aria-hidden="true" />Línea sin cambio</div>
      </div>
      <div className="durability-profile__canvas">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Gráfico del descenso de potencia según trabajo acumulado; los valores positivos son pérdida y los negativos mejora"
        />
      </div>
      <div className="durability-table-scroll" tabIndex={0} aria-label="Tabla desplazable de Durabilidad">
        <table aria-label="Potencia fresca y tras trabajo acumulado">
          <thead>
            <tr>
              <th>Duración</th>
              <th>Fresca</th>
              <th>Tras kJ0</th>
              <th>Tras kJ1</th>
              <th>Comienzo ≥5 %</th>
            </tr>
          </thead>
          <tbody>{rows.map((row) => (
            <tr key={row.seconds}>
              <th scope="row">{durationLabel(row.seconds)}</th>
              <td><strong>{watts(row.freshWatts)}</strong></td>
              <td><LevelCell level={row.levels.kj0} /></td>
              <td><LevelCell level={row.levels.kj1} /></td>
              <td>{row.onsetAfterKj === null ? 'No detectado' : work(row.onsetAfterKj, row.onsetAfterKjPerKg)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

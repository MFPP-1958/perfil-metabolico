import type { DurabilityLevelResult, DurabilitySnapshotResponse } from './durabilityApi';
import { DurabilityChart } from './DurabilityChart';

const coverageLabels: Record<DurabilitySnapshotResponse['result']['coverage'], string> = {
  high: 'Cobertura alta',
  moderate: 'Cobertura moderada',
  low: 'Cobertura baja',
  insufficient: 'Cobertura insuficiente',
};

function environmentLabel(environment: DurabilitySnapshotResponse['environment']) {
  if (environment === 'indoor') return 'Rodillo';
  if (environment === 'outdoor') return 'Exterior';
  return 'Todas las actividades';
}

function dateLabel(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('es-ES', { timeZone: 'UTC' });
}

function workLabel(level: DurabilityLevelResult | undefined) {
  if (!level) return 'No disponible';
  const relative = level.afterKjPerKg === null
    ? 'sin carga relativa'
    : `${level.afterKjPerKg.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kJ/kg`;
  return `${level.afterKj.toLocaleString('es-ES', { maximumFractionDigits: 0 })} kJ; ${relative}`;
}

function firstLevel(
  snapshot: DurabilitySnapshotResponse,
  key: 'kj0' | 'kj1',
) {
  return snapshot.result.rows.find((row) => row.levels[key])?.levels[key];
}

export function DurabilityView({ snapshot }: { snapshot: DurabilitySnapshotResponse }) {
  const kj0 = firstLevel(snapshot, 'kj0');
  const kj1 = firstLevel(snapshot, 'kj1');
  const noFatiguedLevels = !kj0 && !kj1;

  return (
    <section className="model-view durability-view" aria-labelledby="durability-title">
      <header>
        <div>
          <h1 id="durability-title">Durabilidad</h1>
          <p className="durability-context-line">
            <span>{dateLabel(snapshot.oldest)} a {dateLabel(snapshot.newest)}</span>
            <span>{environmentLabel(snapshot.environment)}</span>
          </p>
        </div>
        <span className="model-version">{snapshot.result.algorithmVersion}</span>
      </header>

      <div className="durability-context-strip" aria-label="Contexto de la instantánea">
        <p>
          <span>Cobertura</span>
          <strong className={`coverage-value coverage-value--${snapshot.result.coverage}`}>
            {coverageLabels[snapshot.result.coverage]}
          </strong>
        </p>
        <p><span>kJ0</span><strong>{workLabel(kj0)}</strong></p>
        <p><span>kJ1</span><strong>{workLabel(kj1)}</strong></p>
        <p>
          <span>Peso de referencia</span>
          <strong>{snapshot.weightKg === null ? 'Peso no disponible' : `${snapshot.weightKg.toLocaleString('es-ES')} kg`}</strong>
        </p>
      </div>

      {noFatiguedLevels && (
        <div className="durability-notice" role="status">
          <strong>Sin curvas tras trabajo acumulado</strong>
          <p>La potencia fresca está disponible, pero faltan los niveles kJ0 y kJ1 para medir el cambio.</p>
        </div>
      )}

      <DurabilityChart rows={snapshot.result.rows} />

      <div className="durability-evidence-layout">
        <section className="durability-limitations" aria-labelledby="durability-limitations-title">
          <h2 id="durability-limitations-title">Limitaciones</h2>
          {snapshot.result.warnings.length ? (
            <ul>{snapshot.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          ) : <p>No hay limitaciones adicionales registradas.</p>}
        </section>
        <aside className="durability-provenance" aria-label="Procedencia del análisis">
          <h2>Procedencia</h2>
          <dl>
            <div><dt>Fuente</dt><dd>{snapshot.sourceVersion}</dd></div>
            <div>
              <dt>Instantánea</dt>
              <dd><time dateTime={snapshot.synchronizedAt}>{new Date(snapshot.synchronizedAt).toLocaleString('es-ES')}</time></dd>
            </div>
            <div>
              <dt>Peso observado</dt>
              <dd>{snapshot.weightObservedAt
                ? <time dateTime={snapshot.weightObservedAt}>{new Date(snapshot.weightObservedAt).toLocaleDateString('es-ES')}</time>
                : 'Fecha no disponible'}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  );
}

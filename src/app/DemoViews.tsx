import { useState, type ReactNode } from 'react';
import { DurabilityView } from '../features/durability/DurabilityView';
import type { DurabilityRow, DurabilitySnapshotResponse } from '../features/durability/durabilityApi';
import { PowerDurationView } from '../features/power/PowerDurationView';

function ExplicitDemo({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return <><div className="demo-banner" role="status">Demostración sintética. No corresponde a ningún ciclista.</div>{children}</>;
  // No pide elegir ciclista: estos módulos todavía no leen sus datos, y pedirlo
  // mandaba al entrenador a repetir algo que ya había hecho en la barra superior.
  return (
    <section className="workspace workspace-empty">
      <h1>{label}</h1>
      <p>Este módulo está en construcción: todavía no usa los datos del ciclista activo.</p>
      <p>La demostración funciona con datos inventados y solo sirve para ver la forma que tendrá.</p>
      <button type="button" className="primary-action" onClick={() => setOpen(true)}>Abrir demostración</button>
    </section>
  );
}

const powerPoints = [{ seconds: 10, watts: 940 }, { seconds: 60, watts: 560 }, { seconds: 180, watts: 405 }, { seconds: 300, watts: 365 }, { seconds: 1200, watts: 315 }];

export function PowerDemo() { return <ExplicitDemo label="Potencia y duración"><PowerDurationView input={{ points: powerPoints, sport: 'Ride', period: '90 días', indoor: false }} model="MORTON_3P" /></ExplicitDemo>; }

const demoDurabilityRows: DurabilityRow[] = ([10, 60, 300, 1_200] as const).map((seconds, index) => {
  const freshWatts = [940, 560, 365, 315][index];
  return {
    seconds,
    freshWatts,
    levels: {
      kj0: {
        afterKj: 700,
        afterKjPerKg: 10,
        fatiguedWatts: Math.round(freshWatts * .95),
        declinePercent: 5,
        quality: 'observed',
        supportingActivityCount: 3,
        supportingEffortCount: 5,
        powerSource: 'measured',
      },
      kj1: {
        afterKj: 1_400,
        afterKjPerKg: 20,
        fatiguedWatts: Math.round(freshWatts * .9),
        declinePercent: 10,
        quality: 'observed',
        supportingActivityCount: 2,
        supportingEffortCount: 4,
        powerSource: 'measured',
      },
    },
    onsetAfterKj: 700,
    onsetAfterKjPerKg: 10,
  };
});

const demoDurabilitySnapshot: DurabilitySnapshotResponse = {
  id: '51000000-0000-4000-8000-000000000001',
  athleteId: '61000000-0000-4000-8000-000000000001',
  oldest: '2026-06-17',
  newest: '2026-09-14',
  environment: 'all',
  weightKg: 70,
  weightObservedAt: '2026-09-14T09:00:00.000Z',
  synchronizedAt: '2026-09-14T10:00:00.000Z',
  sourceVersion: 'datos-sinteticos@1.0.0',
  result: {
    algorithmVersion: 'durability-record-profile@2.0.0',
    rows: demoDurabilityRows,
    coverage: 'high',
    warnings: ['Ejemplo sintético para revisar la lectura del perfil.'],
  },
};

export function DurabilityDemo({ onClose }: { onClose?: () => void }) {
  return (
    <>
      <div className="demo-banner" role="status">Demostración sintética. No corresponde al ciclista activo.</div>
      {onClose && (
        <div className="demo-toolbar">
          <button type="button" className="secondary-action" onClick={onClose}>Volver al análisis real</button>
        </div>
      )}
      <DurabilityView snapshot={demoDurabilitySnapshot} />
    </>
  );
}

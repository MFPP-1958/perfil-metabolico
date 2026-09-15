import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DurabilitySnapshotResponse } from './durabilityApi';

vi.mock('chart.js', () => ({
  Chart: class Chart { static register() {} destroy() {} },
  LineController: class LineController {},
  LineElement: class LineElement {},
  PointElement: class PointElement {},
  LinearScale: class LinearScale {},
  Tooltip: class Tooltip {},
  Legend: class Legend {},
}));

import { DurabilityView } from './DurabilityView';

const row = (seconds: 10 | 60 | 300 | 1_200, freshWatts: number) => ({
  seconds,
  freshWatts,
  levels: {
    kj0: {
      afterKj: 700,
      afterKjPerKg: 10,
      fatiguedWatts: Math.round(freshWatts * 0.9),
      declinePercent: 10,
      quality: 'observed' as const,
      supportingActivityCount: 2,
      supportingEffortCount: 3,
      powerSource: 'measured' as const,
    },
  },
  onsetAfterKj: 700,
  onsetAfterKjPerKg: 10,
});

function snapshot(overrides: Partial<DurabilitySnapshotResponse> = {}): DurabilitySnapshotResponse {
  return {
    id: '31000000-0000-4000-8000-000000000001',
    athleteId: '21000000-0000-4000-8000-000000000001',
    oldest: '2026-06-16',
    newest: '2026-09-14',
    environment: 'all',
    weightKg: 70,
    weightObservedAt: '2026-09-14T09:00:00.000Z',
    synchronizedAt: '2026-09-14T10:00:00.000Z',
    sourceVersion: 'intervals-openapi-v1',
    result: {
      algorithmVersion: 'durability-record-profile@2.0.0',
      rows: [row(10, 900), row(60, 420), row(300, 320), row(1_200, 260)],
      coverage: 'moderate',
      warnings: ['Solo hay un nivel de trabajo acumulado.'],
    },
    ...overrides,
  };
}

describe('DurabilityView', () => {
  it('shows exact public evidence, coverage and provenance without a generic score', () => {
    render(<DurabilityView snapshot={snapshot()} />);

    expect(screen.getByRole('heading', { name: 'Durabilidad' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Potencia fresca y tras trabajo acumulado' })).toBeVisible();
    expect(screen.getAllByText('10,0 % de descenso')[0]).toBeVisible();
    expect(screen.getByText('Cobertura moderada')).toBeVisible();
    expect(screen.getByText('durability-record-profile@2.0.0')).toBeVisible();
    expect(screen.getByText('intervals-openapi-v1')).toBeVisible();
    expect(screen.getByText('Todas las actividades')).toBeVisible();
    expect(screen.getByText('Solo hay un nivel de trabajo acumulado.')).toBeVisible();
    expect(screen.queryByText(/confianza/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/puntuación/i)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('21000000-0000-4000-8000-000000000001');
  });

  it('explains missing weight and threshold levels in coach language', () => {
    const withoutWeight = snapshot({
      weightKg: null,
      weightObservedAt: null,
      result: {
        ...snapshot().result,
        coverage: 'low',
        rows: snapshot().result.rows.map((candidate) => ({ ...candidate, levels: {} })),
        warnings: ['No hay un peso válido para expresar el trabajo en kJ/kg.'],
      },
    });

    render(<DurabilityView snapshot={withoutWeight} />);

    expect(screen.getByText('Cobertura baja')).toBeVisible();
    expect(screen.getByText('Peso no disponible')).toBeVisible();
    expect(screen.getByText(/sin curvas tras trabajo acumulado/i)).toBeVisible();
    expect(screen.getAllByText('Nivel no disponible')).toHaveLength(8);
  });
});

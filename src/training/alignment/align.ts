export type { CompletedWorkout, PlannedWorkoutStructure } from './types';
import type { AlignedBlock, CompletedBlock, CompletedWorkout, PlannedBlock, PlannedWorkoutStructure, SessionAlignment } from './types';

function compliance(value: number | undefined, min: number, max: number) {
  if (value == null) return undefined;
  if (value >= min && value <= max) return 100;
  const midpoint = (min + max) / 2;
  const distance = value < min ? min - value : value - max;
  return Math.max(0, 100 - distance / midpoint * 100);
}

function matched(planned: PlannedBlock, completed: CompletedBlock): AlignedBlock {
  return {
    planned, completed, status: 'matched', targetType: planned.target.type,
    durationCompliancePercent: Math.min(100, completed.durationSeconds / planned.durationSeconds * 100),
    powerCompliancePercent: planned.target.type === 'power' ? compliance(completed.averagePower, planned.target.min, planned.target.max) : undefined,
    heartRateCompliancePercent: planned.target.type === 'heart_rate' ? compliance(completed.averageHeartRate, planned.target.min, planned.target.max) : undefined,
  };
}

export function alignWorkout(plannedWorkout: PlannedWorkoutStructure, completedWorkout: CompletedWorkout): SessionAlignment {
  if (!plannedWorkout.blocks.length || !completedWorkout.blocks.length) {
    return { confidence: 'low', blocks: [], warnings: ['Comparación manual por título: faltan bloques estructurados y no se calcula cumplimiento.'] };
  }
  const blocks: AlignedBlock[] = [];
  let plannedIndex = 0;
  let completedIndex = 0;
  while (plannedIndex < plannedWorkout.blocks.length && completedIndex < completedWorkout.blocks.length) {
    const planned = plannedWorkout.blocks[plannedIndex];
    const completed = completedWorkout.blocks[completedIndex];
    if (completed.plannedKind == null || completed.plannedKind === planned.kind) {
      blocks.push(matched(planned, completed)); plannedIndex += 1; completedIndex += 1; continue;
    }
    if (plannedWorkout.blocks[plannedIndex + 1]?.kind === completed.plannedKind) {
      blocks.push({ planned, status: 'skipped', targetType: planned.target.type }); plannedIndex += 1; continue;
    }
    blocks.push({ completed, status: 'extra' }); completedIndex += 1;
  }
  while (plannedIndex < plannedWorkout.blocks.length) {
    const planned = plannedWorkout.blocks[plannedIndex++];
    blocks.push({ planned, status: 'skipped', targetType: planned.target.type });
  }
  while (completedIndex < completedWorkout.blocks.length) blocks.push({ completed: completedWorkout.blocks[completedIndex++], status: 'extra' });
  const warnings: string[] = [];
  if (blocks.some((block) => block.status === 'skipped')) warnings.push('Hay bloques prescritos no realizados.');
  if (blocks.some((block) => block.status === 'extra')) warnings.push('Hay bloques realizados no prescritos.');
  if (blocks.some((block) => block.status === 'matched' && block.completed?.averagePower == null)) warnings.push('Faltan datos de potencia en parte de la sesión.');
  return { confidence: 'high', blocks, warnings };
}

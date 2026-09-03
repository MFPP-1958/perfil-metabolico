import { describe, expect, it } from 'vitest';
import { alignWorkout, type CompletedWorkout, type PlannedWorkoutStructure } from './align';

const planned: PlannedWorkoutStructure = {
  title: '3 x 5 min VO2',
  blocks: [
    { id: 'w', kind: 'warmup', durationSeconds: 600, target: { type: 'power', min: 150, max: 210 } },
    { id: 'r1', kind: 'work', durationSeconds: 300, target: { type: 'power', min: 330, max: 350 } },
    { id: 'e1', kind: 'recovery', durationSeconds: 180, target: { type: 'power', min: 100, max: 180 } },
    { id: 'r2', kind: 'work', durationSeconds: 300, target: { type: 'power', min: 330, max: 350 } },
    { id: 'e2', kind: 'recovery', durationSeconds: 180, target: { type: 'power', min: 100, max: 180 } },
    { id: 'r3', kind: 'work', durationSeconds: 300, target: { type: 'power', min: 330, max: 350 } },
    { id: 'c', kind: 'cooldown', durationSeconds: 600, target: { type: 'heart_rate', min: 90, max: 130 } },
  ],
};

const completed: CompletedWorkout = {
  title: 'VO2 martes',
  blocks: planned.blocks.map((block) => ({ plannedKind: block.kind, durationSeconds: block.durationSeconds, averagePower: block.target.type === 'power' ? (block.target.min + block.target.max) / 2 : 140, variabilityIndex: 1.03, averageHeartRate: 150, averageCadence: 92, rpe: 7 })),
};

describe('structured workout alignment', () => {
  it('matches a completed structured workout block by block', () => {
    const result = alignWorkout(planned, completed);
    expect(result.confidence).toBe('high');
    expect(result.blocks.every((block) => block.status === 'matched')).toBe(true);
    expect(result.blocks[1].powerCompliancePercent).toBe(100);
  });

  it('detects a skipped repetition', () => {
    const shortened = { ...completed, blocks: completed.blocks.filter((_, index) => index !== 3) };
    expect(alignWorkout(planned, shortened).blocks.some((block) => block.status === 'skipped')).toBe(true);
  });

  it('detects an early stop and an extra repetition', () => {
    const stopped = { ...completed, blocks: completed.blocks.slice(0, 4) };
    expect(alignWorkout(planned, stopped).blocks.filter((block) => block.status === 'skipped').length).toBeGreaterThan(0);
    const extra = { ...completed, blocks: [...completed.blocks, completed.blocks[1]] };
    expect(alignWorkout(planned, extra).blocks.some((block) => block.status === 'extra')).toBe(true);
  });

  it('supports mixed power and heart-rate targets', () => {
    const result = alignWorkout(planned, completed);
    expect(result.blocks.at(-1)?.targetType).toBe('heart_rate');
    expect(result.blocks.at(-1)?.heartRateCompliancePercent).toBeDefined();
  });

  it('marks title-only fallback as low confidence', () => {
    const result = alignWorkout({ title: '3 x 5 min VO2', blocks: [] }, { title: '3x5 VO2', blocks: [] });
    expect(result.confidence).toBe('low');
    expect(result.warnings.join(' ')).toMatch(/título/i);
  });
});

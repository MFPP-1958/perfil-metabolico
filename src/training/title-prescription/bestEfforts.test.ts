import { describe, expect, it } from 'vitest';
import { findBestEfforts, type PowerStream } from './bestEfforts';

function stream(segments: Array<[seconds: number, watts: number]>, pauses: Record<number, number> = {}): PowerStream {
  const time: number[] = [];
  const watts: number[] = [];
  let clock = 0;
  for (const [seconds, value] of segments) {
    for (let second = 0; second < seconds; second += 1) {
      clock += pauses[time.length] ?? 0;
      time.push(clock);
      watts.push(value);
      clock += 1;
    }
  }
  return { time, watts, heartRate: watts.map(() => 150), cadence: watts.map(() => 90) };
}

describe('findBestEfforts', () => {
  it('encuentra los bloques de la duración pautada, en orden cronológico', () => {
    const data = stream([[600, 150], [180, 300], [180, 120], [180, 310], [600, 150]]);
    const efforts = findBestEfforts(data, 180, 2);
    expect(efforts.map((effort) => [effort.startSeconds, Math.round(effort.averageWatts ?? 0)])).toEqual([[600, 300], [960, 310]]);
    expect(efforts[0]).toMatchObject({ index: 0, type: 'WORK', movingSeconds: 180, averageHeartRate: 150, averageCadence: 90 });
  });

  it('elige el mejor conjunto, no el mejor bloque primero', () => {
    // El mejor bloque suelto de 25 min (222 W) cae en el centro y deja 15 min
    // libres a cada lado: elegirlo primero impediría encontrar el segundo.
    const data = stream([[1000, 190], [500, 220], [300, 250], [500, 220], [1000, 190]]);
    const efforts = findBestEfforts(data, 1500, 2);
    expect(efforts.map((effort) => [effort.startSeconds, Math.round(effort.averageWatts ?? 0)])).toEqual([[0, 200], [1500, 212]]);
  });

  it('no junta dos esfuerzos a través de una parada larga', () => {
    const data = stream([[120, 300], [120, 300]], { 120: 90 });
    expect(findBestEfforts(data, 240, 1)).toEqual([]);
    const shortStop = stream([[120, 300], [120, 300]], { 120: 20 });
    expect(findBestEfforts(shortStop, 240, 1)).toHaveLength(1);
  });

  it('cuenta los huecos sin potencia como cero, igual que un potenciómetro', () => {
    const data: PowerStream = { time: [0, 1, 2, 3], watts: [200, null, 200, 200], heartRate: null, cadence: null };
    expect(findBestEfforts(data, 4, 1)[0]).toMatchObject({ averageWatts: 150, averageHeartRate: null, averageCadence: null });
  });

  it('devuelve solo los bloques que caben', () => {
    const data = stream([[400, 250]]);
    expect(findBestEfforts(data, 180, 5)).toHaveLength(2);
  });

  it('no calcula con datos imposibles', () => {
    const data = stream([[400, 250]]);
    expect(findBestEfforts(data, 0, 2)).toEqual([]);
    expect(findBestEfforts(data, 180, 0)).toEqual([]);
    expect(findBestEfforts({ time: [0, 1], watts: [1], heartRate: null, cadence: null }, 1, 1)).toEqual([]);
  });
});

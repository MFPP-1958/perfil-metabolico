import { describe, expect, it } from 'vitest';
import { snapshotFitsPeriod, snapshotLagDays, staleWindowNotice, windowSpanDays } from './snapshotWindow';

const ninetyDays = { oldest: '2026-06-21', newest: '2026-09-18', days: 90 };

describe('windowSpanDays', () => {
  it('cuenta ambos extremos', () => {
    expect(windowSpanDays({ oldest: '2026-09-18', newest: '2026-09-18' })).toBe(1);
    expect(windowSpanDays({ oldest: '2026-06-21', newest: '2026-09-18' })).toBe(90);
  });
});

describe('snapshotLagDays', () => {
  it('es cero cuando la instantánea llega hasta el final pedido', () => {
    expect(snapshotLagDays({ oldest: '2026-06-21', newest: '2026-09-18' }, ninetyDays)).toBe(0);
  });

  it('cuenta los días que le faltan al final de la instantánea', () => {
    expect(snapshotLagDays({ oldest: '2026-06-19', newest: '2026-09-16' }, ninetyDays)).toBe(2);
  });
});

describe('snapshotFitsPeriod, ventana deslizante', () => {
  it('acepta la instantánea del mismo día', () => {
    const snapshot = { oldest: '2026-06-21', newest: '2026-09-18' };
    expect(snapshotFitsPeriod(snapshot, ninetyDays, 'rolling')).toBe(true);
  });

  // El fallo que motiva este módulo: sincronizada el 16, consultada el 18.
  it('acepta una instantánea de los mismos 90 días tomada dos días antes', () => {
    const snapshot = { oldest: '2026-06-19', newest: '2026-09-16' };
    expect(snapshotFitsPeriod(snapshot, ninetyDays, 'rolling')).toBe(true);
  });

  it('rechaza una instantánea de otra duración', () => {
    const treintaDias = { oldest: '2026-08-20', newest: '2026-09-18' };
    expect(snapshotFitsPeriod(treintaDias, ninetyDays, 'rolling')).toBe(false);
  });

  it('rechaza una instantánea que termina después de lo pedido', () => {
    const futura = { oldest: '2026-06-23', newest: '2026-09-20' };
    expect(snapshotFitsPeriod(futura, ninetyDays, 'rolling')).toBe(false);
  });

  it('rechaza una instantánea demasiado vieja para representar el periodo', () => {
    const vieja = { oldest: '2026-03-23', newest: '2026-06-20' };
    expect(snapshotFitsPeriod(vieja, ninetyDays, 'rolling')).toBe(false);
  });
});

describe('snapshotFitsPeriod, ventana fija', () => {
  const custom = { oldest: '2026-06-01', newest: '2026-08-29', days: 90 };

  it('acepta solo la coincidencia exacta', () => {
    expect(snapshotFitsPeriod({ oldest: '2026-06-01', newest: '2026-08-29' }, custom, 'fixed')).toBe(true);
  });

  it('rechaza una ventana desplazada aunque dure lo mismo', () => {
    expect(snapshotFitsPeriod({ oldest: '2026-05-30', newest: '2026-08-27' }, custom, 'fixed')).toBe(false);
  });
});

describe('staleWindowNotice', () => {
  it('calla cuando la instantánea llega hasta el final pedido', () => {
    expect(staleWindowNotice({ oldest: '2026-06-21', newest: '2026-09-18' }, ninetyDays)).toBeNull();
  });

  it('dice qué días cubre de verdad y cuántos le faltan', () => {
    const aviso = staleWindowNotice({ oldest: '2026-06-19', newest: '2026-09-16' }, ninetyDays);
    expect(aviso).toContain('19/6/2026');
    expect(aviso).toContain('16/9/2026');
    expect(aviso).toContain('2 días');
  });

  it('concuerda el singular', () => {
    const aviso = staleWindowNotice({ oldest: '2026-06-20', newest: '2026-09-17' }, ninetyDays);
    expect(aviso).toContain('un día');
  });
});

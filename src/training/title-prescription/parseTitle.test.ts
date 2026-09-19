import { describe, expect, it } from 'vitest';
import { parseTitlePrescription } from './parseTitle';

// Títulos reales de las actividades de los ciclistas: la pauta se escribe en el
// nombre porque todavía no se prescribe dentro de Intervals.icu.
describe('parseTitlePrescription', () => {
  it('lee series anidadas, duración, porcentaje y referencia explícita', () => {
    const result = parseTitlePrescription("Segorbe - VO2 max (12')-1 x ( 4 x 3' @ 100% P@VO2max R-3' 60");
    expect(result).toMatchObject({
      place: 'Segorbe', block: 'VO2 max', workMinutes: 12, workMinutesDerived: false,
      sets: 1, reps: 4, repSeconds: 180,
      target: { kind: 'percent', percent: 100, reference: 'P@VO2max', referenceAssumed: false, progressive: false },
    });
  });

  it('toma como objetivo el primero que aparece tras la estructura, no la recuperación', () => {
    const result = parseTitlePrescription("Segorbe - FRC/FTP. (15')- 1 x ( 5 x 3' @ 106 % R-3' @ 60 % )");
    expect(result.target).toMatchObject({ kind: 'percent', percent: 106, reference: 'FTP' });
    expect(result).toMatchObject({ sets: 1, reps: 5, repSeconds: 180, workMinutes: 15 });
  });

  it('normaliza comillas tipográficas y guiones largos', () => {
    const result = parseTitlePrescription('Nules - FTP Muscular Endurance (10’) - 10x(1’ @105% FT');
    expect(result).toMatchObject({ block: 'FTP Muscular Endurance', workMinutes: 10, sets: 1, reps: 10, repSeconds: 60 });
    expect(result.target).toMatchObject({ kind: 'percent', percent: 105, reference: 'FTP' });
  });

  it('lee objetivos en vatios absolutos', () => {
    const result = parseTitlePrescription("Segorbe - P.Umbral (50') 1 x (2 x 25' @ 200 w R-10' @ 150 w)");
    expect(result).toMatchObject({ sets: 1, reps: 2, repSeconds: 1500, workMinutes: 50 });
    expect(result.target).toEqual({ kind: 'watts', watts: 200 });
  });

  it('no confunde una potencia de referencia desconocida con el FTP', () => {
    const result = parseTitlePrescription("Segorbe - Cap.Ana.↓Watios - 1 x (10 x 1' @ 100% P1' R-4' @");
    expect(result.target).toMatchObject({ kind: 'percent', percent: 100, reference: null, unknownReference: "P1'" });
  });

  it('usa el punto medio de una progresión y lo señala', () => {
    const result = parseTitlePrescription("Segorbe - Lanzadera 1 x( 7 x 3' progresivos 80% al 110% @ FT");
    expect(result).toMatchObject({ sets: 1, reps: 7, repSeconds: 180 });
    expect(result.target).toMatchObject({ kind: 'percent', percent: 95, progressive: true, reference: 'FTP' });
  });

  it('usa el punto medio de un rango', () => {
    const result = parseTitlePrescription("Moncofa - Endurance Neuromuscular (126') - 1x(126' @68-73% F");
    expect(result).toMatchObject({ reps: 1, repSeconds: 7560 });
    expect(result.target).toMatchObject({ kind: 'percent', percent: 70.5, progressive: false });
  });

  it('lee zonas, también con subzona', () => {
    expect(parseTitlePrescription("Ontinyent - Endurance (60') - 1x(60' @Z2 RPE 3-5) RPE 3-5").target).toEqual({ kind: 'zone', zone: 2 });
    expect(parseTitlePrescription('Ontinyent - Sweet Spot Subida (48’) – 2x(4x6’ @Z4a caden')).toMatchObject({
      sets: 2, reps: 4, repSeconds: 360, target: { kind: 'zone', zone: 4 },
    });
  });

  it('prefiere el objetivo de la serie aunque luego haya otro', () => {
    const result = parseTitlePrescription('Segorbe - VO2 Max / TTE (35’) - 5x(30” @Z6 + 1’ @120%');
    expect(result).toMatchObject({ sets: 1, reps: 5, repSeconds: 30, target: { kind: 'zone', zone: 6 } });
  });

  it('busca en todo el título si tras la estructura no hay objetivo', () => {
    const result = parseTitlePrescription("Ontinyent - Z 4.3 3x6' R3' 100-105%");
    expect(result).toMatchObject({ reps: 3, repSeconds: 360 });
    expect(result.target).toMatchObject({ kind: 'percent', percent: 102.5 });
  });

  it('marca como supuesta la referencia cuando el título no la nombra', () => {
    const result = parseTitlePrescription("Ontinyent - Sweetspot (20')- 1 x ( 4 x 5' @ 91 % R-5' @ 60 % )");
    expect(result.target).toMatchObject({ kind: 'percent', percent: 91, reference: 'FTP', referenceAssumed: true });
    expect(parseTitlePrescription("Segorbe - Sweetspot (30')- 1 x ( 3 x 10' @ 91% FTP R-10' @ 6").target)
      .toMatchObject({ reference: 'FTP', referenceAssumed: false });
  });

  it('lee minutos y segundos con dos puntos', () => {
    expect(parseTitlePrescription("Segorbe - Tempo 1 x (4:40' @ 75% y Esprines 20\" @ 170%)")).toMatchObject({ reps: 1, repSeconds: 280 });
  });

  it('deduce los minutos de trabajo cuando el título no los dice', () => {
    const result = parseTitlePrescription("Segorbe - Paseo suave 1 x (3 x 5\" sprint All-Out R-3' @ 55%)");
    expect(result).toMatchObject({ sets: 1, reps: 3, repSeconds: 5, workMinutes: 0.3, workMinutesDerived: true });
  });

  it('no inventa nada en un título sin pauta', () => {
    const result = parseTitlePrescription('Castellfort Ciclismo en ruta');
    expect(result).toMatchObject({ block: null, sets: null, reps: null, repSeconds: null, target: null, workMinutes: null });
    expect(result.hasStructure).toBe(false);
  });

  it('no saca objetivo de un título cortado antes del porcentaje', () => {
    const result = parseTitlePrescription('Segorbe - MicroIntervalos-VO2 máx-(12\')- 1 x (8 x 90" @ 100');
    expect(result).toMatchObject({ block: 'MicroIntervalos-VO2 máx', sets: 1, reps: 8, repSeconds: 90, target: null });
  });
});

import { assessCurveCompleteness } from './quality';
import type { PowerDurationFit, PowerDurationInput, PowerDurationModel, PowerDurationPoint } from './types';

function linearFit(points: readonly PowerDurationPoint[], transform: (seconds: number) => number) {
  const xs = points.map((point) => transform(point.seconds));
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = points.reduce((sum, point) => sum + point.watts, 0) / points.length;
  const denominator = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  if (!denominator) throw new Error('Las duraciones no permiten ajustar el modelo.');
  const slope = xs.reduce((sum, value, index) => sum + (value - meanX) * (points[index].watts - meanY), 0) / denominator;
  return { intercept: meanY - slope * meanX, slope };
}

function rmse(points: readonly PowerDurationPoint[], predict: (seconds: number) => number) {
  return Math.sqrt(points.reduce((sum, point) => sum + (point.watts - predict(point.seconds)) ** 2, 0) / points.length);
}

/**
 * Los modelos hiperbólicos solo describen el dominio severo: por encima de unos
 * 20 min la potencia cae por debajo de la hipérbola y, si se incluyen esas
 * duraciones, CP baja y W′ sube artificialmente (Jones y Vanhatalo 2017).
 */
const MAX_FIT_SECONDS = 1200;

function fitEcp(points: readonly PowerDurationPoint[]) {
  const fittingPoints = points.filter((point) => point.seconds >= 120 && point.seconds <= MAX_FIT_SECONDS);
  if (fittingPoints.length < 2) throw new Error('ECP requiere al menos dos esfuerzos de entre 2 y 20 minutos.');
  const fit = linearFit(fittingPoints, (seconds) => 1 / seconds);
  return { cp: fit.intercept, wPrime: fit.slope, pmax: null, fittingPoints, predict: (seconds: number) => fit.intercept + fit.slope / seconds };
}

function fitMorton(allPoints: readonly PowerDurationPoint[]) {
  const points = allPoints.filter((point) => point.seconds <= MAX_FIT_SECONDS);
  if (points.length < 3) throw new Error('Morton 3P requiere al menos tres duraciones distintas de hasta 20 minutos.');
  let best: { error: number; cp: number; wPrime: number; k: number } | null = null;
  for (let index = 0; index < 2400; index += 1) {
    const k = 0.1 * Math.exp((index / 2399) * Math.log(3000));
    const fit = linearFit(points, (seconds) => 1 / (seconds + k));
    if (fit.intercept <= 0 || fit.slope <= 0) continue;
    const predict = (seconds: number) => fit.intercept + fit.slope / (seconds + k);
    const error = rmse(points, predict);
    if (!best || error < best.error) best = { error, cp: fit.intercept, wPrime: fit.slope, k };
  }
  if (!best) throw new Error('No se pudo ajustar un modelo Morton fisiológicamente válido.');
  const selected = best;
  return {
    cp: selected.cp,
    wPrime: selected.wPrime,
    pmax: selected.cp + selected.wPrime / selected.k,
    fittingPoints: points,
    predict: (seconds: number) => selected.cp + selected.wPrime / (seconds + selected.k),
  };
}

export function fitPowerDuration(input: PowerDurationInput, model: PowerDurationModel): PowerDurationFit {
  const points = [...input.points].filter((point) => Number.isFinite(point.seconds) && point.seconds > 0 && Number.isFinite(point.watts) && point.watts > 0).sort((a, b) => a.seconds - b.seconds);
  if (points.length < 2) throw new Error('Faltan puntos válidos para ajustar la curva.');
  const fit = model === 'ECP' ? fitEcp(points) : fitMorton(points);
  const fittedPoints = points.map((point) => {
    const modelledWatts = fit.predict(point.seconds);
    return { ...point, modelledWatts, residualWatts: point.watts - modelledWatts };
  });
  return {
    model,
    algorithmVersion: model === 'ECP' ? 'pd-ecp-2p@1.1.0' : 'pd-morton-3p@1.1.0',
    cpWatts: fit.cp,
    wPrimeJoules: fit.wPrime,
    pmaxWatts: fit.pmax,
    observedFiveSecondWatts: points.find((point) => point.seconds === 5)?.watts ?? null,
    // El error se mide en el dominio del ajuste; fuera de él se muestran los residuos.
    rmseWatts: rmse(fit.fittingPoints, fit.predict),
    points: fittedPoints,
    quality: assessCurveCompleteness(points),
    context: { sport: input.sport, period: input.period, indoor: input.indoor },
  };
}

export { assessCurveCompleteness } from './quality';

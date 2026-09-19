// Pauta leída del título de la actividad.
//
// Los entrenamientos no se prescriben todavía en Intervals.icu: la pauta viene
// escrita en el propio nombre, con formatos del tipo
//   "Moncofa - FRC/FTP. (15')- 1 x ( 5 x 3' @ 106 % R-3' @ 60 % )"
// Porta `interpretarTitulo()` del dashboard heredado, validado contra los títulos
// reales de los diez ciclistas, con tres correcciones: los vatios absolutos
// ("@ 200 w"), las referencias que no sabemos resolver ("@ 100% P1'") ya no se
// toman por FTP, y las progresiones ("80% al 110%") usan su punto medio.

export type PrescriptionReference = 'FTP' | 'P@VO2max' | 'Pmáx';

export type TitleTarget =
  | {
    kind: 'percent';
    percent: number;
    /** Nula cuando el título nombra una referencia que la aplicación no sabe resolver. */
    reference: PrescriptionReference | null;
    /** Cierta cuando el título no nombra la referencia y se asume FTP. */
    referenceAssumed: boolean;
    unknownReference: string | null;
    progressive: boolean;
  }
  | { kind: 'watts'; watts: number }
  | { kind: 'zone'; zone: number };

export interface TitlePrescription {
  place: string | null;
  block: string | null;
  workMinutes: number | null;
  workMinutesDerived: boolean;
  sets: number | null;
  reps: number | null;
  repSeconds: number | null;
  target: TitleTarget | null;
  hasStructure: boolean;
}

export function normalizeTitle(title: string) {
  return title
    .replace(/[´‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function durationSeconds(value: string, unit: string) {
  if (value.includes(':')) {
    const [minutes, seconds] = value.split(':');
    return Number.parseInt(minutes, 10) * 60 + Number.parseInt(seconds, 10);
  }
  return Number.parseInt(value, 10) * (unit === "'" ? 60 : 1);
}

const decimal = (value: string) => Number.parseFloat(value.replace(',', '.'));
const NUMBER = String.raw`\d+(?:[.,]\d+)?`;

// "R-3' @ 60 %", "R-10' @ 150 w", "R3'": la recuperación nunca es el objetivo de la serie.
const RECOVERY = new RegExp(String.raw`\bR\s*-?\s*\d+(?::\d+)?\s*['"](?:\s*@\s*(?:Z\s*\d\w*|${NUMBER}\s*(?:-\s*${NUMBER})?\s*(?:%|w\b)))?`, 'gi');

const TARGET_PATTERNS = {
  zone: /(?<![A-Za-z])Z\s*(\d)/i,
  range: new RegExp(String.raw`(${NUMBER})\s*%?\s*(-|al|a)\s*(${NUMBER})\s*%`, 'i'),
  percent: new RegExp(String.raw`(${NUMBER})\s*%`),
  watts: /@\s*(\d{2,4})\s*w(?:atts|atios)?\b/i,
};

function explicitReference(following: string): { reference: PrescriptionReference | null; unknown: string | null } | null {
  if (/^\s*@?\s*P\s*@?\s*VO2\s*m[aá]x/i.test(following)) return { reference: 'P@VO2max', unknown: null };
  if (/^\s*@?\s*Pm[aá]x/i.test(following)) return { reference: 'Pmáx', unknown: null };
  if (/^\s*@?\s*FTP?(?![A-Za-z])/i.test(following)) return { reference: 'FTP', unknown: null };
  const other = following.match(/^\s*(P\s*\d+\s*['"])/i);
  if (other) return { reference: null, unknown: other[1].replace(/\s+/g, '') };
  return null;
}

function titleReference(title: string): PrescriptionReference | null {
  if (/P\s*@\s*VO2\s*m[aá]x/i.test(title)) return 'P@VO2max';
  if (/Pm[aá]x/i.test(title)) return 'Pmáx';
  if (/FTP/i.test(title)) return 'FTP';
  return null;
}

/** El primer objetivo que aparece en `text`; si empatan, gana el rango sobre el porcentaje suelto. */
function firstTarget(text: string, title: string): TitleTarget | null {
  const candidates: Array<{ index: number; priority: number; build(): TitleTarget }> = [];
  const zone = text.match(TARGET_PATTERNS.zone);
  if (zone?.index !== undefined) candidates.push({ index: zone.index, priority: 0, build: () => ({ kind: 'zone', zone: Number(zone[1]) }) });
  const watts = text.match(TARGET_PATTERNS.watts);
  if (watts?.index !== undefined) candidates.push({ index: watts.index, priority: 0, build: () => ({ kind: 'watts', watts: Number(watts[1]) }) });

  const percentTarget = (percent: number, end: number, progressive: boolean): TitleTarget => {
    const explicit = explicitReference(text.slice(end, end + 16));
    const fromTitle = titleReference(title);
    const reference = explicit ? explicit.reference : fromTitle ?? 'FTP';
    return {
      kind: 'percent',
      percent,
      reference,
      referenceAssumed: !explicit && !fromTitle,
      unknownReference: explicit?.unknown ?? null,
      progressive,
    };
  };

  const range = text.match(TARGET_PATTERNS.range);
  if (range?.index !== undefined) {
    const low = decimal(range[1]);
    const high = decimal(range[3]);
    const progressive = /^a/i.test(range[2]) || /progresiv/i.test(title);
    candidates.push({
      index: range.index,
      priority: 0,
      build: () => percentTarget((low + high) / 2, range.index! + range[0].length, progressive),
    });
  }
  const single = text.match(TARGET_PATTERNS.percent);
  if (single?.index !== undefined) {
    candidates.push({
      index: single.index,
      priority: 1,
      build: () => percentTarget(decimal(single[1]), single.index! + single[0].length, /progresiv/i.test(title)),
    });
  }
  const winner = candidates.sort((left, right) => left.index - right.index || left.priority - right.priority)[0];
  return winner ? winner.build() : null;
}

export function parseTitlePrescription(rawTitle: string): TitlePrescription {
  const title = normalizeTitle(rawTitle);
  const place = title.match(/^(.+?)\s-\s/)?.[1] ?? null;
  const blockMatch = title.match(/\s-\s*(.+?)\s*(?:\(|\d+\s*x)/i);
  const block = blockMatch ? blockMatch[1].replace(/^[\s.-]+|[\s.-]+$/g, '') || null : null;
  const minutesMatch = title.match(/\((\d+)\s*'\)/);
  let workMinutes = minutesMatch ? Number.parseInt(minutesMatch[1], 10) : null;

  let sets: number | null = null;
  let reps: number | null = null;
  let repSeconds: number | null = null;
  let structureEnd = -1;
  // Anidada: 3 x ( 2 x 2' ...  y también  1x(5x(30" ...
  const nested = title.match(/(\d+)\s*x\s*\(\s*(\d+)\s*x\s*\(?\s*(\d+(?::\d+)?)\s*(['"])/i);
  const simple = nested ? null : title.match(/(\d+)\s*x\s*\(?\s*(\d+(?::\d+)?)\s*(['"])/i);
  if (nested?.index !== undefined) {
    sets = Number.parseInt(nested[1], 10);
    reps = Number.parseInt(nested[2], 10);
    repSeconds = durationSeconds(nested[3], nested[4]);
    structureEnd = nested.index + nested[0].length;
  } else if (simple?.index !== undefined) {
    sets = 1;
    reps = Number.parseInt(simple[1], 10);
    repSeconds = durationSeconds(simple[2], simple[3]);
    structureEnd = simple.index + simple[0].length;
  }

  // El objetivo de la serie es el primero que sigue a la estructura; si no hay
  // ninguno allí, se busca en todo el título. Las recuperaciones se descartan.
  const afterStructure = structureEnd >= 0 ? title.slice(structureEnd).replace(RECOVERY, ' ') : '';
  const target = (afterStructure && firstTarget(afterStructure, title)) || firstTarget(title.replace(RECOVERY, ' '), title);

  let workMinutesDerived = false;
  if (workMinutes === null && sets !== null && reps !== null && repSeconds !== null) {
    workMinutes = Math.round(sets * reps * repSeconds / 60 * 10) / 10;
    workMinutesDerived = true;
  }

  return { place, block, workMinutes, workMinutesDerived, sets, reps, repSeconds, target, hasStructure: reps !== null };
}

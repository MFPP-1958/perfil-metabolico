import type { EventProfile } from './scenario';

export const VLAMAX_BANDS_VERSION = 'vlamax-reference-bands@1.0.0';

export const EVENT_PROFILE_LABELS: Readonly<Record<EventProfile, string>> = {
  explosiva: 'Prueba explosiva, de esfuerzos repetidos',
  rodador: 'Rodador, esfuerzo sostenido',
  escalador: 'Escalador, ascensiones largas',
  fondo: 'Fondo, larga duración',
};

export interface VlamaxBand {
  profile: EventProfile;
  /** Límite inferior publicado, en mmol·l⁻¹·s⁻¹. */
  lower: number;
  /** Límite superior publicado, en mmol·l⁻¹·s⁻¹. */
  upper: number;
  /** Población exacta sobre la que se midió el intervalo. Viaja siempre junto a la banda. */
  population: string;
  /** Referencia completa con DOI de la que se leyó el intervalo. */
  reference: string;
}

/**
 * Orientación bibliográfica, nunca objetivo. Un perfil de prueba sin intervalo
 * sustentado se queda fuera de esta lista: la pantalla lo muestra sin banda.
 *
 * Fuentes consultadas (paso 1): las dos revisiones ya citadas en
 * `docs/model-register.md`:
 *   1. Quittmann OJ et al. Maximal lactate accumulation rate: current evidence
 *      and future directions. Eur J Appl Physiol (2025).
 *      DOI 10.1007/s00421-025-06022-7. Acceso abierto (CC-BY) vía
 *      PMC12881007. Su Tabla 1 reúne valores de VLa máx de estudios previos
 *      con población, prueba y, cuando el estudio original lo publicó, un
 *      rango de valores individuales junto a la media ± DE.
 *   2. Sablain M et al. Evaluating maximal lactate accumulation rate and
 *      estimated MLSS in cycling. Eur J Appl Physiol (2025).
 *      DOI 10.1007/s00421-025-05751-z. Cierre de acceso (Unpaywall: closed,
 *      sin copia en PMC); solo el resumen en PubMed (PMID 40338332) fue
 *      legible. Ese resumen describe un único grupo de "trece hombres
 *      físicamente activos" evaluado con un protocolo incremental y cuatro
 *      pruebas de esprín, centrado en la fiabilidad (ICC) de VLa máx y de la
 *      MLSS estimada; no reporta un intervalo distinto por perfil de prueba,
 *      así que no aporta ninguna banda.
 *
 * De la Tabla 1 de Quittmann et al. (2025), la única fila cuya población
 * coincide sin ambigüedad con uno de los cuatro perfiles es la de
 * Dunst et al. (2023a): "9 (f = 0) Elite track cycling sprinters", con
 * perfil de fuerza-velocidad mediante esprines máximos de 3, 8, 12 y 60 s,
 * columna x̄ ± DE (rango) = "0,95 ± 0,18 (∼0,88-1,40) mmol·l⁻¹·s⁻¹". Esa
 * población de pista, de esprín puro, es la que mejor describe una prueba
 * explosiva de esfuerzos repetidos.
 *
 * El resto de filas de ciclismo de la misma tabla (p. ej. Poffé et al. 2024:
 * "29 (f = 10) profesionales, amateurs y recreativos"; Hauser et al. 2014:
 * ciclistas entrenados "con distintos niveles de resistencia"; Archacki
 * et al. 2024: "62 (f = 31) deportistas de resistencia y de velocidad-
 * fuerza") no distinguen rodador, escalador ni fondista: son muestras
 * generales de ciclistas entrenados o, cuando sí separan por capacidad
 * (Archacki), no publican un rango de valores individuales, solo media ± DE.
 * Forzar esas filas sobre uno de los tres perfiles restantes sería una
 * lectura de población que la fuente no respalda, así que `rodador`,
 * `escalador` y `fondo` se quedan sin banda.
 */
export const VLAMAX_REFERENCE_BANDS: readonly VlamaxBand[] = [
  {
    profile: 'explosiva',
    lower: 0.88,
    upper: 1.4,
    population:
      'Ciclistas de pista de nivel élite especializados en esprín, varones (n = 9, f = 0), evaluados con perfil de fuerza-velocidad mediante esprines máximos de 3, 8, 12 y 60 s (Dunst et al. 2023a).',
    reference:
      'Quittmann OJ et al. Maximal lactate accumulation rate: current evidence and future directions. Eur J Appl Physiol (2025). DOI 10.1007/s00421-025-06022-7. Tabla 1, fila Dunst et al. (2023a).',
  },
];

export function bandFor(profile: EventProfile): VlamaxBand | undefined {
  return VLAMAX_REFERENCE_BANDS.find((band) => band.profile === profile);
}

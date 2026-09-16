export const SCENARIO_MODEL_VERSION = 'metabolic-scenario@1.0.0';

export const SCENARIO_HYPOTHESIS_NOTICE =
  'El perfil objetivo es una hipótesis de trabajo del entrenador. No es una medición, no predice el resultado del entrenamiento y no afirma que el objetivo sea alcanzable.';

export const SCENARIO_MINOR_NOTICE =
  'En un ciclista en maduración el perfil se desplaza por el propio crecimiento. Un objetivo de VLa máx describe una hipótesis fechada, nunca una asignación de especialidad.';

export const SCENARIO_LIMITATIONS = [
  'El modelo trata la VLa máx y el VO₂max como parámetros independientes. El entrenamiento que mueve uno rara vez deja el otro intacto, así que un escenario que solo mueve uno describe un cambio aislado que el organismo no suele conceder por separado.',
  'La comparación conserva la masa corporal y la P@VO₂max reales. Un cambio de peso alteraría la conversión a vatios y haría que las dos curvas dejaran de ser comparables.',
] as const;

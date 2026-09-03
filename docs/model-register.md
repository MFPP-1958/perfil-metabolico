# Registro de modelos y reglas fisiológicas

| Versión | Entradas | Salidas | Estado | Límites principales |
|---|---|---|---|---|
| `ecp@1.0.0` | Mejores potencias y duraciones | CP, W′, residuos, RMSE | Analítico | Necesita esfuerzos representativos; CP no es FTP ni MLSS. |
| `morton-3p@1.0.0` | Mejores potencias y duraciones | CP, W′, Pmax modelada, residuos | Analítico | Pmax modelada no equivale a potencia observada de 5 s. |
| `durability@1.0.0` | Curvas fresca y fatigada, kJ/kg, trabajo sobre CP e intensidad | Pérdida por duración e inicio ≥5 % | Analítico | Exige condiciones y duraciones compatibles; no crea una puntuación genérica. |
| `lactate-sprint@1.0.0` | Lactato basal, esprint, tiempo aláctico y muestras minutadas | Tasa pico o VLa máx estimada | Condicionado | VLa máx solo se etiqueta si existe pico seguido de meseta o descenso. |
| `mader-reproduction@1.0.0` | VO₂max, VLa máx, masa, P@VO₂max y VO₂ basal | MLSS y FATmax modelados, sensibilidad | Experimental | Coste de O₂ deducido, cadencia no modelada, validez discutida. Nunca actualiza LT1 o zonas. |
| `meaningful-change@1.0.0` | Dos resultados y error típico | Compatibilidad y clase de cambio | Analítico | No compara métricas, unidades o protocolos distintos; no atribuye causalidad. |
| `aerobic-power-intervals@1.0.0` | Objetivo, fase, disponibilidad y P@VO₂max | Borrador de sesión | Regla | Requiere ajuste y aprobación del entrenador; no es consejo médico. |

## Base científica inicial

- Leo P et al. Power profiling and the power-duration relationship in cycling. *European Journal of Applied Physiology* (2022). DOI: 10.1007/s00421-021-04833-y.
- Jones AM et al. The Critical Power Concept. *Sports Medicine* (2017). DOI: 10.1007/s40279-017-0688-0.
- Maunder E et al. The Importance of Durability in the Physiological Profiling of Endurance Athletes. *Sports Medicine* (2021). DOI: 10.1007/s40279-021-01459-0.
- Quittmann OJ et al. Maximal lactate accumulation rate: current evidence and future directions. *European Journal of Applied Physiology* (2025). DOI: 10.1007/s00421-025-06022-7.
- Sablain M et al. Evaluating maximal lactate accumulation rate and estimated MLSS in cycling. *European Journal of Applied Physiology* (2025). DOI: 10.1007/s00421-025-05751-z.
- Dunst AK, Hesse C, Ueberschär O. Movement velocity in metabolic simulations and cycling cadence. *European Journal of Applied Physiology* (2025). DOI: 10.1007/s00421-024-05663-4.
- Poffé C et al. Validity of a physiological performance model to determine MLSS in cyclists. *Frontiers in Sports and Active Living* (2024). DOI: 10.3389/fspor.2024.1376876.

Cada cambio de ecuación, constante, filtro o etiqueta requiere una versión nueva, caso numérico de referencia, revisión de limitaciones y registro de migración. Las versiones previas se conservan para reproducir informes existentes.

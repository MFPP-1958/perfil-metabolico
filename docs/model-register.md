# Registro de modelos y reglas fisiológicas

| Versión | Entradas | Salidas | Estado | Límites principales |
|---|---|---|---|---|
| `ecp@1.0.0` | Mejores potencias y duraciones | CP, W′, residuos, RMSE | Analítico | Necesita esfuerzos representativos; CP no es FTP ni MLSS. |
| `morton-3p@1.0.0` | Mejores potencias y duraciones | CP, W′, Pmax modelada, residuos | Analítico | Pmax modelada no equivale a potencia observada de 5 s. |
| `durability-record-profile@2.0.0` | Curvas récord de campo fresca, `kJ0` y `kJ1`; peso con fecha observada; procedencia y recuentos de soporte | Descenso firmado por duración exacta, carga de inicio en kJ y kJ/kg, calidad de cobertura | Analítico | Compara solo 10, 60, 300 y 1.200 s, sin interpolar; su alcance se limita a esas curvas, cargas y descensos. |
| `lactate-sprint@1.0.0` | Lactato basal, esprint, tiempo aláctico y muestras minutadas | Tasa pico o VLa máx estimada | Condicionado | VLa máx solo se etiqueta si existe pico seguido de meseta o descenso. |
| `mader-reproduction@1.0.0` | VO₂max, VLa máx, masa, P@VO₂max y VO₂ basal | MLSS y FATmax modelados, sensibilidad | Experimental | Coste de O₂ deducido, cadencia no modelada, validez discutida. Nunca actualiza LT1 o zonas. |
| `substrate-metabolism@1.0.0` | Barrido de Mader, masa corporal y P@VO₂max | Déficit de piruvato, acumulación neta de lactato, FatOx g/min, CHO g/h, kcal/h y % de VO₂max por vatio | Experimental | Reparto derivado de la propia glucólisis del modelo, no de calorimetría indirecta. Infravalora el CHO por debajo de FATmax y agota la grasa en el MLSS. No publica concentración de lactato. |
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
- Frayn KN. Calculation of substrate oxidation rates in vivo from gaseous exchange. *Journal of Applied Physiology* (1983). DOI: 10.1152/jappl.1983.55.2.628.
- Jeukendrup AE, Wallis GA. Measurement of substrate oxidation during exercise by means of gas exchange measurements. *International Journal of Sports Medicine* (2005). DOI: 10.1055/s-2004-830512.

Cada cambio de ecuación, constante, filtro o etiqueta requiere una versión nueva, caso numérico de referencia, revisión de limitaciones y registro de migración. Las versiones previas se conservan para reproducir informes existentes.

## Durabilidad `durability-record-profile@2.0.0`

El modelo compara la mejor potencia fresca con los récords que Intervals.icu devuelve para `kJ0` y `kJ1`. Usa coincidencias exactas de 10, 60, 300 y 1.200 segundos. Una duración repetida dentro de una curva y un nivel repetido son ambiguos y no se eligen por orden de llegada. Los demás niveles y duraciones inequívocos siguen siendo utilizables.

El descenso conserva el signo: `(potencia fresca - potencia tras trabajo) / potencia fresca × 100`. Un valor negativo indica que el récord tras trabajo es superior al fresco. La carga de inicio de una duración es el menor umbral observado cuya caída alcanza el 5 %. `kJ/kg` se calcula si existe un peso numérico positivo, aunque su procedencia temporal no permita elevar la cobertura.

La fecha de peso es contemporánea únicamente si el instante observado cae dentro del intervalo cerrado desde `oldest` a las 00:00:00 UTC hasta `newest` a las 23:59:59.999 UTC. La cobertura es alta con al menos tres duraciones observadas en ambos niveles. Es moderada con al menos dos duraciones compartidas o tres en un nivel. Ambas exigen peso válido y contemporáneo, potencia medida y dos actividades independientes en cada celda válida. Cualquier incumplimiento limita la cobertura a baja. Sin comparaciones exactas, es insuficiente.

El campo `weight` de las curvas actuales de Intervals.icu no incluye una fecha de observación. La sincronización conserva el valor numérico y guarda `weight_observed_at = null`; así puede mostrar kJ/kg, pero limita la cobertura a baja y avisa de la ausencia de fecha. El perfil sigue siendo evidencia récord de campo: no demuestra por sí solo una respuesta fisiológica causal ni sustituye una prueba controlada.

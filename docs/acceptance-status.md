# Estado de aceptación

Fecha de revisión: 15 de septiembre de 2026.

| # | Criterio | Evidencia | Estado |
|---|---|---|---|
| 1 | Autenticación y atletas autorizados | Acceso por enlace local, autorización previa en funciones y pruebas 401/403 | Verificado con el propietario local y un ciclista real |
| 2 | Secretos fuera de navegador, URL e informes | Gateway servidor, CSP, escáner de secretos y prueba del bundle | Verificado localmente |
| 3 | Sin mezcla al cambiar de atleta | Cancelación, clave de solicitud y pruebas de respuesta obsoleta | Verificado localmente |
| 4 | Fuente, fecha, calidad y protocolo | Contrato `Observation`, origen `external_model` con programa nombrado y avisos de procedencia en los modelos | Verificado localmente |
| 5 | Estados de calidad visibles y persistibles | Catálogo, chips, PostgreSQL local y una estimación importada trazable | Verificado localmente con datos reales; migración de `external_model` aplicada el 16 de septiembre de 2026 |
| 6 | Métricas fisiológicas separadas | Catálogo tipado y pruebas de no sustitución | Verificado localmente |
| 7 | Modelos versionados y probados | Casos numéricos y `docs/model-register.md` | Verificado localmente |
| 8 | Mader experimental sin actualizar zonas | Resultado sin LT1/zonas, aviso y confirmación | Verificado localmente |
| 9 | Durabilidad por perfil récord de campo | `durability-record-profile@2.0.0`; curvas fresca, `kJ0` y `kJ1`; descensos firmados en 10, 60, 300 y 1.200 s; cobertura y procedencia visibles | Verificado localmente con fixtures; el alcance se limita a las curvas y cargas importadas |
| 10 | Prescrito/ejecutado estructurado | Alineación por bloques y alternativa por título de baja confianza | Verificado localmente |
| 11 | Prescripción con aprobación | Transición explícita con entrenador, fecha y auditoría | Verificado localmente |
| 12 | Informe reproducible | Instantánea aprobada, fuente, modelo, límite y autor | Verificado localmente y en A4 |
| 13 | Pruebas funcionales, seguridad y accesibilidad | 331 Vitest; 21 Playwright; axe; teclado; foco con contraste; objetivos de 44 px; móvil de 360 px; escala real de Chromium al 200 % | Verificado localmente |
| 14 | Copia restaurable, exportación y borrado | Procedimiento en `docs/operations.md` | Pendiente ejecutar en Supabase real |
| 15 | Documentación de protección de datos | `docs/privacy-checklist.md` | Pendiente decisiones del responsable y revisión jurídica |
| 16 | Conexión inicial con Intervals.icu | Clave en Llavero, plantilla real, selección explícita, importación y sincronización autenticada | Verificado: 16 ciclistas accesibles, uno incorporado, 43 actividades y una observación importadas |
| 17 | Contexto común y Potencia real | Dos ciclistas ficticios con respuestas inversas; axe; teclado; móvil, tableta y escala real de Chromium al 200 %; aceptación local autenticada | Verificado localmente |
| 18 | Persistencia idempotente de Potencia | Dos sincronizaciones y dos confirmaciones sobre la misma ventana: recuentos estables de 1 instantánea y 1 análisis; procedimiento anonimizado y parametrizado en `docs/operations.md` | Verificado el 7 de septiembre de 2026 con ventana de 90 días |
| 19 | Sincronización global única para Potencia y Durabilidad | Fixture autorizado: un POST para atleta, 90 días y entorno; navegación Potencia ↔ Durabilidad, recarga y confirmación de Durabilidad sin otra sincronización | Verificado automáticamente |
| 20 | Durabilidad real con Jaume Santamaria | Una sincronización autenticada; una instantánea de Potencia y una de Durabilidad; recarga persistente; 198 puntos frescos; peso numérico sin fecha observada; ausencia explícita de kJ0/kJ1 | Aceptación parcial por cobertura insuficiente; confirmación bloqueada |
| 21 | Escenarios metabólicos con datos reales de Jaume Santamaria | Observaciones propias: VO₂max 71,5 ml·kg⁻¹·min⁻¹, VLa máx 0,30 mmol·l⁻¹·s⁻¹ y P@VO₂max 392 W, las tres calculadas en WKO5 (origen `external_model`), y masa 54,8 kg pesada (origen manual). El modelo calcula MLSS 338 W (sensibilidad 325–354 W) y FATmax 249 W al 66 % del VO₂max, con un aviso de procedencia por cada valor de WKO5. Objetivo VLa máx 0,45: FATmax −24 W, MLSS −19 W, carbohidrato −17 g/h en la potencia de referencia. Escenario «Más chispa para el esprint» guardado, recuperado tras recargar y presente en `metabolic_scenarios` | Aceptado el 18/09/2026 |

## Alcance pendiente

La aceptación de Durabilidad se ejecutó con Jaume Santamaria, periodo del 18 de junio al 15 de septiembre de 2026 y todas las actividades. La única sincronización real terminó con estado parcial porque Intervals.icu no devolvió curvas fatigadas para los umbrales configurados. PostgreSQL conserva una instantánea de Potencia y una de Durabilidad. La instantánea de Durabilidad contiene 198 puntos frescos, peso numérico sin fecha observada y ninguna curva `kJ0` o `kJ1`. Los descensos no están disponibles, la cobertura de `durability-record-profile@2.0.0` es insuficiente y la confirmación permanece bloqueada.

La recarga conservó ciclista, periodo, entorno, hora de sincronización y resultado. Navegar Potencia ↔ Durabilidad no cambió la hora ni generó otra llamada de sincronización: el contador observado permaneció en uno. No se confirmó el resultado real, porque el control estaba deshabilitado por cobertura insuficiente. El valor numérico de peso permite calcular kJ/kg cuando existen umbrales; al carecer de fecha observada válida dentro del periodo, nunca eleva la cobertura por sí solo. La prueba automatizada confirma que el POST de confirmación envía solo `snapshotId`, que el servidor recalcula y que una única RPC decide en transacción si la instantánea sigue vigente y crea o recupera la confirmación inmutable.

La base local estaba vacía al iniciar esta revisión. Se restauró el propietario configurado, con correo local sintético, y se importó únicamente a Jaume mediante el flujo autorizado antes de la sincronización. No se registraron secretos ni identificadores externos. El despliegue público, las copias restaurables y las decisiones jurídicas de protección de datos siguen pendientes.

- **Guarda de procedencia del modelo de Mader (18/09/2026):** el VO₂max y la P@VO₂max se aceptan con calidad `calculated` además de `measured`, igual que la VLa máx, porque el entrenador trabaja con valores de WKO5. Cada valor así emite un aviso de procedencia que llega a la pantalla y al informe. Las estimaciones importadas (`imported_estimate`) siguen bloqueadas.

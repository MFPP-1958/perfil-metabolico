# Estado de aceptación

Fecha de revisión: 4 de septiembre de 2026.

| # | Criterio | Evidencia | Estado |
|---|---|---|---|
| 1 | Autenticación y atletas autorizados | `AuthGate`, autorización previa en funciones y pruebas 401/403 | Verificado en pruebas; pendiente prueba con cuentas reales |
| 2 | Secretos fuera de navegador, URL e informes | Gateway servidor, CSP, escáner de secretos y prueba del bundle | Verificado localmente |
| 3 | Sin mezcla al cambiar de atleta | Cancelación, clave de solicitud y pruebas de respuesta obsoleta | Verificado localmente |
| 4 | Fuente, fecha, calidad y protocolo | Contrato `Observation` y componentes de historial | Verificado localmente |
| 5 | Estados de calidad visibles y persistibles | Catálogo, chips y esquema PostgreSQL | Verificado en contrato; pendiente migración real |
| 6 | Métricas fisiológicas separadas | Catálogo tipado y pruebas de no sustitución | Verificado localmente |
| 7 | Modelos versionados y probados | Casos numéricos y `docs/model-register.md` | Verificado localmente |
| 8 | Mader experimental sin actualizar zonas | Resultado sin LT1/zonas, aviso y confirmación | Verificado localmente |
| 9 | Durabilidad tras trabajo acumulado | kJ/kg, trabajo sobre CP, distribución y curvas emparejadas | Verificado localmente |
| 10 | Prescrito/ejecutado estructurado | Alineación por bloques y alternativa por título de baja confianza | Verificado localmente |
| 11 | Prescripción con aprobación | Transición explícita con entrenador, fecha y auditoría | Verificado localmente |
| 12 | Informe reproducible | Instantánea aprobada, fuente, modelo, límite y autor | Verificado localmente y en A4 |
| 13 | Pruebas funcionales, seguridad y accesibilidad | Vitest, Playwright, axe, teclado, cabeceras y CI | Verificado localmente |
| 14 | Copia restaurable, exportación y borrado | Procedimiento en `docs/operations.md` | Pendiente ejecutar en Supabase real |
| 15 | Documentación de protección de datos | `docs/privacy-checklist.md` | Pendiente decisiones del responsable y revisión jurídica |
| 16 | Conexión inicial con Intervals.icu | Función exclusiva del propietario, selección explícita, Llavero de macOS y pruebas de navegador | Verificado con dobles; pendiente aceptación con una clave y un ciclista reales |

## Bloqueos externos

Docker Desktop y Supabase local están disponibles. La integración de Intervals.icu se ha verificado con respuestas anonimizadas y dobles de prueba. Falta ejecutar `npm run configure:real`, introducir la clave en el cuadro protegido, elegir un ciclista y completar una sincronización real. Hasta entonces no se registran recuentos de datos reales ni se declara cerrada la aceptación de la conexión.

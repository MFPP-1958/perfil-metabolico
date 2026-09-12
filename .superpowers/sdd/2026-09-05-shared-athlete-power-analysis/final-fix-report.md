# Informe de corrección final — contexto compartido y análisis de potencia

Fecha de cierre: 12 de septiembre de 2026

Rama: `codex/shared-athlete-power`

Base revisada: `e21b42ca5765fca1a65416ebdf0cd23783fe85b6`

Autoridad de hallazgos: `.superpowers/sdd/2026-09-05-shared-athlete-power-analysis/final-review.md`

## Resultado

Se han corregido el hallazgo Critical, los Important 2–5 y los Minor 6, 7 y 9. El Minor 8 queda como riesgo residual documentado porque la prueba existente verifica reflow a anchura equivalente, pero no aplica zoom real del navegador al 200 %.

La re-revisión de `6102ee5` detectó una carrera residual entre hidratación y sincronización, y una pérdida de recuentos para respuestas cumplidas con forma inválida. Ambos hallazgos quedaron corregidos mediante un ciclo RED/GREEN adicional antes de enmendar el commit.

La solución mantiene las llamadas externas fuera de la transacción. La decisión `latest-wins`, la comprobación de autorización y todas las escrituras de una sincronización se resuelven después en una única transacción corta de PostgreSQL, serializada con bloqueo de la fila del atleta.

No se modificó la aplicación antigua, no se cambió `main`, no se borraron datos y no se ejecutó `supabase db reset`.

## Diagnóstico de causa raíz

### 1. Inserción directa de evidencia fisiológica

La protección se había diseñado solo con RLS por fila. `authenticated` conservaba el privilegio SQL `INSERT` sobre `power_curve_snapshots` y `power_analysis_runs`, y las policies de inserción aceptaban valores proporcionados por el cliente. La RLS comprobaba la relación entrenador-atleta, pero no podía demostrar que una curva procediera de Intervals.icu ni que un análisis hubiera sido recalculado en servidor.

Corrección:

- `authenticated` conserva solo `SELECT` sobre las dos tablas.
- `anon` y `authenticated` no tienen `INSERT`.
- se eliminaron las dos policies de inserción del cliente;
- `service_role` conserva `SELECT, INSERT`;
- el RPC de sincronización no es ejecutable por `PUBLIC`, `anon` ni `authenticated`.

La prueba pgTAP usa los roles reales de PostgreSQL y un `request.jwt.claim.sub` realista. Demuestra lectura autorizada para coach y viewer, rechazo efectivo de ambos `INSERT` directos, escritura efectiva como `service_role` y privilegios de ejecución del RPC. No depende de buscar texto SQL.

### 2. Carrera TOCTOU de sincronización

La versión anterior leía `latest_sync_key`, liberaba esa comprobación y persistía mediante varias peticiones REST independientes. Durante esa ventana podía comenzar otra sincronización. La persistencia antigua también volvía a escribir su clave al actualizar el perfil, por lo que A podía recuperar autoridad después de que B la hubiera sustituido.

Corrección:

- `beginSync` registra la clave antes de las llamadas externas;
- la carga desde Intervals.icu termina antes de abrir la transacción de persistencia;
- `persist_athlete_sync(...)` bloquea la fila de `athletes` con `FOR UPDATE`;
- dentro del mismo RPC compara la clave esperada con `latest_sync_key`;
- una clave obsoleta devuelve `false` antes de cualquier escritura;
- una clave vigente persiste perfil normalizado, actividades, entrenamientos, observaciones, derivados, snapshot y estado de sync dentro de la misma transacción;
- la persistencia no vuelve a escribir `latest_sync_key`.

El RPC es `SECURITY INVOKER`, tiene `search_path` vacío y solo concede `EXECUTE` a `service_role`. No existe una función `SECURITY DEFINER` accesible públicamente.

La prueba A/B fuerza el orden en el que B ya es la clave vigente cuando A intenta confirmar. A devuelve `false`, B devuelve `true` y la consulta final encuentra únicamente la actividad de B.

### 3. Integridad atleta–snapshot

Dos FKs independientes solo garantizaban que ambos UUID existieran. No garantizaban que pertenecieran al mismo atleta.

Corrección:

- `power_curve_snapshots` incorpora `UNIQUE (id, athlete_id)`;
- `power_analysis_runs` incorpora la FK compuesta `(snapshot_id, athlete_id)` hacia `(id, athlete_id)`;
- la FK antigua por `snapshot_id` se retira;
- la prueba SQL intenta una combinación cruzada y recibe `23503`.

Compatibilidad con datos previos:

La migración conserva cada análisis existente. Antes de validar la FK compuesta, suspende temporalmente el trigger de inmutabilidad, alinea el `athlete_id` redundante con el atleta de su snapshot, restaura el trigger y valida la nueva FK. No elimina filas. Una prueba de estructura de migración fija ese orden para evitar que una regeneración futura valide antes de reparar o deje desactivado el trigger.

### 4. Descartes silenciosos durante la normalización

La carga consideraba válido cualquier array y los mappers descartaban filas con `catch` sin comunicar el descarte. Un perfil satisfecho también podía figurar como actualizado aunque el nombre o los ajustes fueran inválidos.

Corrección:

- la normalización ocurre por completo antes de persistir;
- perfil y ajustes se aceptan juntos solo si pasan validación;
- actividades y entrenamientos se normalizan elemento a elemento;
- las fechas inválidas se rechazan antes de construir el payload SQL;
- cada componente publica `received`, `accepted` y `rejected`;
- la capa de transporte conserva si un componente fue recibido antes de sustituir una forma inválida;
- una curva cumplida pero inválida y una colección cumplida que no sea array producen `1/0/1`;
- todo descarte añade una advertencia por componente y convierte el resultado en `partial`/HTTP 207;
- las advertencias contienen solo códigos y cantidades, por ejemplo `activities:1_rejected`;
- nombres, valores fisiológicos y contenido bruto rechazado no aparecen en advertencias ni respuestas de error.

### 5. Estado de sincronización perdido al remontar React

El contexto React inicializaba siempre `idle` y `localStorage` contenía únicamente las preferencias de selección. La base no guardaba un resultado exacto por contexto.

Corrección:

- nueva tabla `athlete_sync_states` con clave por atleta, deporte, entorno, fecha inicial y fecha final;
- se persisten estado, fecha, advertencias sanitizadas, componentes actualizados y recuentos;
- RLS permite leer el estado solo a relaciones autorizadas;
- el endpoint de atletas autentica, obtiene el roster autorizado y solo después consulta el estado exacto;
- `AnalysisProvider` hidrata el estado del servidor para el contexto activo y descarta respuestas obsoletas mediante la generación de análisis;
- cada `synchronize()` incrementa esa generación antes de pasar a `running`, invalidando cualquier hidratación anterior;
- la respuesta de sync y la recarga posterior comprueban la misma generación, por lo que un cambio de contexto, otra sync o el desmontaje las invalida;
- una prueba desmonta y remonta el proveedor, conserva solo las preferencias no fisiológicas y recupera la fecha/estado desde la API;
- no se guarda estado fisiológico en `localStorage`.

### 6. Autenticación posterior al parseo

El manejador de sincronización medía y parseaba el body antes de resolver la sesión. Una petición anónima podía distinguir errores 400/413.

Corrección:

- se exige bearer token y se autentica antes de medir o parsear el body;
- la autorización del atleta sigue ocurriendo antes de llamar a Intervals.icu.

### 7. Cobertura Morton

La prueba numérica de Morton solo fijaba parcialmente CP/Pmax y no existía confirmación POST específica.

Corrección:

- el caso sintético comprueba CP, W′, Pmax y RMSE con tolerancias numéricas explícitas;
- el POST Morton confirma que el servidor recalcula, usa `pd-morton-3p@1.0.0`, produce calidad completa y persiste el payload recalculado.

No fue necesario cambiar el algoritmo de producción; la causa era una laguna de cobertura.

### 9. Preferencia obsoleta después de revocar roster

La selección activa se limpiaba al recargar el roster, pero la clave persistida permanecía hasta la siguiente carga de la aplicación.

Corrección:

- la misma rama que detecta la revocación elimina inmediatamente `mfpp.analysis.preferences.v1`;
- la prueba comprueba estado vacío y ausencia de la clave tras `reloadRoster`.

## Cambios de contrato y coste

### RPC privado de persistencia

Se añade `public.persist_athlete_sync(uuid, text, uuid, jsonb) -> boolean`. El nombre está en el esquema `public` para que PostgREST pueda resolverlo, pero su ejecución queda restringida a `service_role`. El booleano diferencia una confirmación vigente de una sincronización sustituida sin abrir una segunda consulta.

Coste: la persistencia de sync queda acoplada a este contrato SQL. A cambio, la garantía latest-wins y todas las escrituras comparten una sola transacción verificable.

### Lectura de estado exacto

`GET /.netlify/functions/athletes` acepta, junto con `athleteId`, `syncState=true`, `oldest`, `newest` y `environment`. Devuelve el estado exacto o `null` después de autorizar el atleta.

Coste: el endpoint de roster asume una segunda responsabilidad de lectura contextual. Se mantuvo ahí para evitar exponer una ruta nueva y conservar el flujo de autenticación/autorización existente.

### Resumen de sync

La respuesta añade `counts` por componente. El campo es opcional en el cliente para mantener compatibilidad con adaptadores existentes. Las advertencias dejan de transportar cualquier detalle bruto y pasan a códigos estables con cantidades.

## Migración

Archivo: `supabase/migrations/20260908084304_final_power_security.sql`.

Proceso seguido:

1. se modificaron primero `supabase/schemas/01_core.sql` y `supabase/schemas/02_rls.sql`;
2. se generó la migración con Supabase CLI y `--strict-coverage`;
3. se revisaron y añadieron explícitamente revocaciones/grants de tabla y función que el diff declarativo no emitió;
4. se añadió la reparación no destructiva de posibles filas cruzadas previas;
5. se aplicó incrementalmente con `supabase migration up --local`;
6. una comprobación posterior devolvió `applied: []`, confirmando que no quedaban migraciones pendientes;
7. `supabase migration list --local` muestra `20260908084304` en local y base;
8. un replay completo en base shadow aplica todas las migraciones y termina con `No schema changes found`.

No se usó reset ni se borraron datos.

## Evidencia TDD

### RED inicial de seguridad e integridad

La primera versión de `supabase/tests/power_sync_security.test.sql` falló porque:

- `authenticated` tenía `INSERT` en ambas tablas de potencia;
- el entrenador autenticado podía insertar snapshot y análisis directamente;
- la combinación cruzada atleta/snapshot era aceptada;
- no existían `athlete_sync_states` ni el RPC atómico.

### RED inicial de funciones y proveedor

Las pruebas focalizadas fallaron en los comportamientos pedidos:

- body anónimo mal formado devolvía 400 en vez de 401;
- la sincronización A respondía 200 en vez de 409 después de comenzar B;
- faltaban recuentos y advertencias al descartar filas mixtas;
- un proveedor remontado volvía a `idle`;
- la preferencia seguía en storage tras revocar el acceso;
- el endpoint no devolvía el estado exacto solicitado.

### RED adicional de compatibilidad de migración

La prueba `repairs legacy crossed analysis ownership before validating the composite foreign key` falló primero al no encontrar la reparación. Después volvió a fallar al detectar que el trigger de inmutabilidad impediría el `UPDATE` de compatibilidad. El GREEN exige ahora suspender el trigger, reparar, restaurarlo y solo después validar la FK.

### RED residual de re-revisión

La prueba de hidratación diferida reprodujo el intercalado exacto: la sincronización terminó con la fecha nueva y, al resolver después la lectura antigua, el proveedor volvió a mostrar el estado parcial anterior.

Las pruebas de transporte reprodujeron dos recuentos incorrectos:

- curva cumplida pero malformada: se obtuvo `0/0/0` en lugar de `1/0/1`;
- actividades y entrenamientos cumplidos con forma no-array: se obtuvo `0/0/0` en lugar de un rechazo de componente.

El GREEN invalida la hidratación al comenzar la sincronización y conserva recuentos internos de recepción. El contenido malformado no llega al payload normalizado ni a las advertencias.

Comando focal residual:

```text
npm run test:run -- src/analysis/AnalysisProvider.test.tsx tests/functions/sync-athlete.test.ts
```

Resultado: 2 archivos, 29 pruebas, 29 PASS.

### GREEN focalizado

Comando final:

```text
npm run test:run -- src/analysis/AnalysisProvider.test.tsx src/physiology/power-duration/fit.test.ts tests/database/schema.test.ts tests/functions/athletes.test.ts tests/functions/power-analysis.test.ts tests/functions/sync-athlete.test.ts
```

Resultado: 6 archivos, 61 pruebas, 61 PASS.

### GREEN SQL ejecutable

Comando:

```text
supabase test db supabase/tests/power_sync_security.test.sql
```

Resultado: 1 archivo, 16 pruebas, PASS. Incluye privilegios reales, RLS con JWT, escritura de servidor, FK cruzada y A/B latest-wins.

## Verificación final

### Puerta de aplicación

```text
npm run verify
```

Resultado:

- typecheck: PASS;
- ESLint con cero warnings: PASS;
- Vitest: 46 archivos, 225 pruebas, 225 PASS;
- build de producción: PASS;
- escáner de secretos versionados: PASS.

Vite mantiene el aviso no bloqueante ya existente de un chunk de 549,52 kB minificado.

### E2E

```text
npm run test:e2e
```

Resultado final: 18 pruebas, 18 PASS.

Una ejecución anterior llegó al login real porque Playwright reutilizó un servidor Vite ajeno sin `VITE_E2E_MODE`. La evidencia fue uniforme en las capturas: `AuthGate`, sin fallo de render ni de fixtures. La prueba aislada pasó y la suite completa con servidor limpio pasó dos veces. No se cambió producción para ocultar ese problema ambiental.

### Base y dependencias

```text
supabase db lint --local --level warning
```

Resultado: `No schema errors found`, cero hallazgos.

```text
supabase db diff --local --strict-coverage
```

Resultado: replay shadow correcto y `No schema changes found`.

```text
npm audit --omit=dev
```

Resultado: 0 vulnerabilidades.

### Higiene del diff

- `git diff --check`: PASS antes del informe;
- no se incluyeron secretos ni credenciales;
- los artefactos de Playwright permanecen ignorados;
- el commit final contiene esquema declarativo, migración, código, pruebas y este informe.

## Riesgos residuales

### Zoom real al 200 %

`tests/e2e/visual.spec.ts` conserva el escenario `desktop-zoom-200` con viewport efectivo estrecho. Verifica reflow, ausencia de scroll horizontal y visibilidad completa de la acción de confirmación. No cambia el factor de zoom del navegador ni amplía realmente el texto al 200 %.

Queda pendiente una comprobación manual registrada con Chrome al 200 %, o una automatización fiable que aumente la escala tipográfica y compruebe foco, reflow y recortes. Este riesgo corresponde al Minor 8 y no afecta a la seguridad, atomicidad ni integridad de datos corregidas aquí.

### Despliegue remoto

La migración se aplicó y verificó solo en la base local solicitada. El despliegue en una base remota debe ejecutar el mismo archivo incremental con copia de seguridad y observación del breve bloqueo de `power_analysis_runs` durante la reparación/FK.

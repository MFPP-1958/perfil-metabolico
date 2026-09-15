# Informe de fixes de la revisión final de Durabilidad

Fecha: 15 de septiembre de 2026

Base revisada: `8f984d71a65f5dcc92e07d1f5aef523ae243a8be`

Ámbito: única ronda conjunta de correcciones; no se repitió la sincronización real de Jaume.

## Resultado

Los cuatro hallazgos de la revisión quedaron corregidos y cubiertos por pruebas. La confirmación usa una única operación transaccional en PostgreSQL; los duplicados se tratan como datos ambiguos sin depender del orden; el peso importado sin fecha conserva el valor numérico, pero no eleva la cobertura; y la documentación describe únicamente `durability-record-profile@2.0.0` y sus límites reales.

## 1. Confirmación atómica

### RED

- Las pruebas de función mostraron que el POST hacía por separado la consulta de confirmación existente, la comprobación de última instantánea y el `INSERT`. Una sincronización podía confirmar una instantánea nueva entre la comprobación y el alta.
- La primera ejecución focal acumuló 12 fallos: 4 de mapper, 6 de motor, 1 de sincronización y 1 de API.
- Antes de definir la RPC, pgTAP produjo 5 fallos por función y privilegios ausentes.
- La migración producida por el generador no dejó explícitos los `REVOKE` de `anon` y `authenticated`; la siguiente ejecución de pgTAP detectó 3 fallos de privilegios. Se corrigió la migración antes del reset definitivo.

### GREEN

- `public.confirm_durability_analysis(uuid, uuid, text, jsonb, jsonb)` se define en `supabase/schemas/01_core.sql` como `SECURITY INVOKER`, con `search_path` vacío.
- La función resuelve por sí misma instantánea, atleta y contexto. Comprueba que el creador sigue asignado como entrenador antes de devolver o crear datos.
- Devuelve primero una confirmación ya existente para la misma instantánea, versión y creador.
- Adquiere `FOR UPDATE` sobre la fila de `public.athletes`, el mismo lock y orden usado por `persist_athlete_sync`.
- Tras el lock, repite la búsqueda idempotente para dos confirmaciones concurrentes y busca la última instantánea con orden total `synchronized_at DESC, id DESC`.
- Devuelve `stale` o `not_found` sin insertar. Solo inserta después de validar vigencia y forma mínima del payload.
- El POST calcula con datos de servidor y delega stale+insert a una sola llamada RPC. Los estados se traducen a 201 creado, 200 existente, 409 obsoleto y 404 desaparecido.
- La respuesta existente también se valida contra instantánea, versión y creador esperados.
- `PUBLIC`, `anon` y `authenticated` no tienen `EXECUTE`; solo `service_role` lo recibe. Las tablas conservan RLS y la función mantiene la comprobación BOLA incluso al ejecutarse con la cuenta de servicio.
- pgTAP representa el interleaving insertando una instantánea B entre el cálculo de A y su confirmación: A devuelve `stale` y no crea fila. También cubre idempotencia después de que la instantánea confirmada deje de ser la más reciente, desaparición del snapshot y rechazo de viewer.

## SQL y migración

Se editó primero el esquema declarativo. La migración se generó con la CLI real instalada:

```text
npx supabase db schema declarative sync --name atomic_durability_confirmation --no-apply --strict-coverage
```

La CLI exigió habilitar la función experimental y no aplicó cambios. Se repitió correctamente con:

```text
npx supabase --experimental db schema declarative sync --name atomic_durability_confirmation --no-apply --strict-coverage
```

Resultado: `supabase/migrations/20260915085024_atomic_durability_confirmation.sql`. Se revisó el delta generado, se añadieron los `REVOKE` explícitos que pgTAP reclamó y se validó desde cero con `supabase db reset --local`. El índice de contexto incorpora `id DESC` para que la selección de la instantánea más reciente tenga orden total.

## 2. Duplicados deterministas

### RED

- El mapper aceptaba varias curvas del mismo nivel según su posición y `mapPowerCurve` seleccionaba arbitrariamente el mayor punto de una duración repetida.
- El motor usaba `.find()` para duraciones y sobrescribía niveles repetidos al recorrer el array.
- Las pruebas nuevas de fresh, `kJ0`, `kJ1`, duración y permutaciones fallaron antes del cambio.
- En la revisión final del alcance se añadió el mismo contrato a `mapPowerCurve`: 1 de 18 pruebas del mapper quedó RED porque aún conservaba 5 s repetidos. Tras el cambio del mapper, 1 de 136 pruebas focales detectó el hash histórico esperado y se actualizó al contenido canónico correcto.

### GREEN

- El mapper agrupa por nivel antes de validar. Dos o más miembros fresh, `kJ0` o `kJ1` rechazan todos los miembros de ese nivel, conservan niveles inequívocos y producen `rejected` en orden fijo.
- Cada curva cuenta las duraciones antes de mapear. Si un segundo aparece más de una vez, elimina todos sus puntos; conserva y ordena solo duraciones únicas positivas.
- `mapPowerCurve` aplica la misma regla. El hash de la instantánea se calcula sobre ese resultado canónico y es idéntico al permutar los puntos de entrada.
- El motor agrupa puntos por duración y curvas por nivel. Una duración repetida produce celdas `incompatible`; un nivel repetido no se sobrescribe, queda `incompatible` y genera un aviso. Los niveles y duraciones inequívocos permanecen calculables.
- Las pruebas comparan resultados completos bajo permutación de curvas y puntos, además de cubrir fresh duplicada y ambos niveles fatigados duplicados.

## 3. Peso con procedencia temporal

### RED

- La sincronización convertía `synchronizedAt` en `weight_observed_at`, aunque Intervals.icu entrega `weight` sin fecha propia.
- El motor podía conceder cobertura alta o moderada solo con el número de peso, y la UI mostraba una fecha inventada como observación.

### GREEN

- `createDurabilitySnapshotPayload` persiste siempre `weight_observed_at: null` para este origen. El valor numérico positivo se mantiene en `weight_kg` y en las curvas.
- `DurabilityInput` incorpora `weightObservedAt` y la API lo toma de la instantánea persistida.
- Una fecha solo es contemporánea si cae dentro del intervalo UTC cerrado `oldest 00:00:00.000` a `newest 23:59:59.999`.
- Alta y moderada requieren peso válido, fecha contemporánea y los requisitos previos de potencia medida y soporte. Fecha nula, inválida o fuera del periodo limita la cobertura a baja con un aviso explícito.
- El cálculo de kJ/kg sigue disponible con peso numérico válido aunque la fecha falte.
- La UI separa el valor del peso de su fecha y muestra `No aportada por la fuente` cuando es nula.

## 4. Documentación v2

### RED

- El registro aún presentaba `durability@1.0.0` y variables que el flujo real no recibe.
- El estado de aceptación no reflejaba el bloqueo de confirmación ni la ausencia de fecha del peso real.

### GREEN

- `docs/model-register.md` registra `durability-record-profile@2.0.0`, las curvas fresh/`kJ0`/`kJ1`, las duraciones exactas 10/60/300/1.200 s, la fórmula de descenso firmado, la cobertura, el tratamiento determinista de ambigüedades y los límites de inferencia.
- `docs/acceptance-status.md` conserva la evidencia real: 198 puntos fresh, sin `kJ0` ni `kJ1`, cobertura insuficiente y confirmación bloqueada. También aclara que el peso numérico no tiene fecha observada.

## Verificación ejecutada

| Comando | Resultado |
|---|---|
| Focales mapper, motor, API, sync y UI | 7 archivos, 136 pruebas; PASS |
| `npm run typecheck` | PASS |
| `npm run verify` | typecheck, ESLint, 51 archivos/331 Vitest, build y escáner; PASS |
| `npm run test:e2e` | 21 Playwright; PASS |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| `npx supabase db reset --local` | reconstrucción completa; aplicó la migración nueva; PASS |
| `npx supabase test db` | 2 archivos, 79 pgTAP; PASS |
| `npx supabase db lint --local --level warning` | sin errores de esquema |
| `npx supabase db advisors --local --type all --level warn --fail-on error` | sin hallazgos |
| `npx supabase db diff --local --strict-coverage` | `No schema changes found` |
| `npm run security:secrets` | sin patrones detectados |
| `git diff --check` | sin errores de whitespace |

## Auto-revisión y riesgos residuales

- El reset y las pruebas de base de datos son locales. No se aplicó ninguna migración remota.
- La RPC depende de que la clave de servicio permanezca exclusivamente en el servidor; sus privilegios y la comprobación BOLA están probados.
- La representación pgTAP cubre el orden de commits que causaba la carrera y el lock compartido elimina la ventana con `persist_athlete_sync`; no se añadió una extensión de pruebas concurrentes.
- La build conserva el aviso existente de un chunk JavaScript superior a 500 kB. No afecta al resultado de este fix.
- Los pesos actuales de Intervals.icu quedan limitados a cobertura baja hasta disponer de una fecha observada fiable. Este límite es intencional y visible.
- El informe no contiene secretos ni identificadores externos. Todos los identificadores añadidos a pruebas SQL son sintéticos.

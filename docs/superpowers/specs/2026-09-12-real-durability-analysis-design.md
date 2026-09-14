# Análisis real de durabilidad

Fecha: 12 de septiembre de 2026
Estado: aprobado para revisión del usuario

## Contexto

MFPP Metabolic Lab ya comparte el ciclista, el periodo y el entorno entre rutas. La
sincronización común importa desde Intervals.icu el perfil, las actividades, los planes y
la curva de potencia, y la pantalla Potencia funciona con instantáneas trazables. La ruta
Durabilidad todavía recibe datos sintéticos escritos en `DemoViews.tsx`.

Este bloque convierte Durabilidad en una pantalla real para el ciclista activo. Todo el
trabajo se realizará exclusivamente en
`/Users/manuelfrancisperezperez/Desktop/MFPP Metabolic Lab`. La aplicación histórica de
`/Users/manuelfrancisperezperez/Desktop/Perfil metabolico` permanecerá intacta.

## Objetivo

Mostrar cómo cambia la mejor potencia observada después de acumular trabajo en el mismo
ciclista, periodo y entorno, conservando procedencia, limitaciones y confirmación
profesional. El resultado debe cargarse automáticamente en todas las visitas posteriores
sin exigir una sincronización específica de Durabilidad.

## Alcance

Incluido:

- Curva fresca y curvas fatigadas `kJ0` y `kJ1` de Intervals.icu.
- Comparación a 10 segundos, 1 minuto, 5 minutos y 20 minutos.
- Trabajo previo expresado en kJ y, cuando exista peso válido, en kJ/kg.
- Contexto global de ciclista, periodo y entorno.
- Sincronización única compartida por toda la aplicación.
- Instantáneas inmutables, cálculo reproducible y confirmación del entrenador.
- Calidad por duración y nivel de trabajo, estados parciales y advertencias explícitas.
- Carga automática del último resultado compatible tras navegar o recargar.
- Pruebas unitarias, de contrato, base de datos, seguridad, navegador y accesibilidad.

Fuera de este bloque:

- Reconstrucción de esfuerzos tardíos desde streams de actividades.
- Una puntuación única o baremo poblacional de durabilidad.
- Inferencias causales sobre glucógeno, nutrición, temperatura o estado de fatiga.
- Escritura de resultados o zonas en Intervals.icu.
- Prescripciones automáticas basadas en Durabilidad.

## Decisiones funcionales

### Sincronización global

La sincronización pertenece al ciclista y al contexto global. Al sincronizar desde la
barra común, una sola operación actualizará todos los componentes disponibles para el
ciclista, incluido el conjunto de curvas necesario para Durabilidad. Ninguna pantalla
tendrá que repetir esa operación.

Al cambiar a un ciclista previamente sincronizado, cada ruta leerá sus datos guardados.
Si no existe una instantánea para el periodo y entorno actuales, la ruta mostrará el
estado correspondiente y remitirá a la acción común. Cambiar de ruta nunca inicia una
petición externa por sí solo.

La sincronización será de último escritor válido: una respuesta anterior no podrá
sobrescribir la selección o el estado de una petición posterior. Los fallos parciales
conservarán todos los componentes válidos existentes.

### Lectura de Durabilidad

La ruta cargará automáticamente la última instantánea cuyo `athlete_id`, deporte,
entorno, `oldest` y `newest` coincidan exactamente con el contexto activo. El cliente no
recibirá identificadores externos ni será autoridad sobre atleta, autor, procedencia o
estado de confirmación.

La demostración sintética seguirá disponible como acción secundaria separada. Abrirla no
modificará el contexto global ni persistirá resultados.

## Fuente y normalización

La sincronización solicitará al endpoint de curvas de Intervals.icu, para la misma fecha
final, periodo y filtro de interior/exterior:

- curva fresca;
- curva fatigada configurada como `kJ0`;
- curva fatigada configurada como `kJ1`.

La misma petición solicitará hasta tres esfuerzos secundarios por punto mediante
`subMaxEfforts=3`. Esto permitirá contar esfuerzos y actividades distintas sin descargar
streams completos.

El normalizador no dependerá del orden de la lista devuelta. Identificará cada curva por
su variante y conservará:

- puntos positivos y finitos `{ seconds, watts }`;
- `after_kj` y umbral configurado;
- peso y fecha del peso cuando estén disponibles;
- referencias a actividad y segmento si Intervals.icu las entrega;
- número de observaciones o actividades independientes que sostienen cada punto;
- versión de la fuente y fecha de sincronización.

Los datos no válidos se rechazarán por componente y producirán recuentos de recibidos,
aceptados y rechazados. Una curva malformada no invalidará otras curvas utilizables.
Los identificadores externos usados para calcular procedencia permanecerán en el servidor;
la respuesta pública solo expondrá recuentos.

## Modelo fisiológico

### Comparación principal

Para cada nivel de trabajo previo `K` y duración `d`:

```text
descenso(K,d) = 100 × [P_fresca(d) − P_después_K(d)] / P_fresca(d)
```

El descenso conservará el signo. Un valor negativo indica que el mejor registro tardío
superó al fresco y no se corregirá a cero.

Las duraciones canónicas son 10 segundos, 60 segundos, 300 segundos y 1.200 segundos. La
comparación exige el punto exacto en ambas curvas. No se interpolará ni extrapolará en
esta fase; una duración ausente quedará identificada como insuficiente.

### Trabajo previo

Se mostrará `after_kj` en kJ. Con un peso válido y contemporáneo:

```text
trabajo_pre_kj_kg = after_kj / peso_kg
```

Si falta el peso, se mantendrán los kJ absolutos, se omitirá kJ/kg y la calidad de
cobertura no podrá ser alta. El peso utilizado quedará congelado dentro de la
instantánea.

### Inicio del deterioro

El inicio se expresará por trabajo acumulado, no por duración del esfuerzo. Será el primer
umbral de carga disponible en el que el descenso de una duración supere su criterio de
cambio relevante. El 5 % se utilizará como criterio provisional visible cuando no exista
un error típico individual. No se presentará como límite fisiológico universal.

### Interpretación

La pantalla mostrará un vector de descensos por duración y carga. No generará una
puntuación agregada. Un descenso pequeño no demostrará ausencia de fatiga: puede faltar
una oportunidad máxima tardía. El resultado se etiquetará como asociación observada en
campo, condicionada por recorrido, motivación, nutrición, temperatura, estrategia y
calidad del potenciómetro.

## Calidad

Cada celda de comparación tendrá procedencia y uno de estos estados:

- `observed`: ambos puntos proceden directamente de curvas válidas;
- `insufficient`: falta un punto o no cumple los requisitos mínimos;
- `incompatible`: deporte, periodo o entorno no coinciden.

La calidad de cobertura general podrá ser:

- alta: tres o más duraciones exactas válidas en dos niveles fatigados, peso válido,
  procedencia de potencia medida y al menos dos actividades independientes por celda;
- moderada: al menos dos duraciones exactas válidas en ambos niveles fatigados, o tres
  duraciones exactas válidas en un solo nivel, con procedencia identificada;
- baja: una o dos duraciones válidas en un solo nivel, peso ausente, una sola actividad o
  procedencia no identificada;
- insuficiente: ninguna comparación válida o contexto incompatible.

La etiqueta describirá cobertura del dato y nunca se denominará confianza fisiológica.
Hasta disponer del análisis de esfuerzos por actividad, incluso una cobertura alta seguirá
incluyendo la limitación de que el perfil récord no mide repetibilidad individual.

## Arquitectura de cliente

`DurabilityWorkspace` consumirá `AnalysisContext` y seguirá el patrón probado de
`PowerWorkspace`:

- clave de solicitud construida con atleta, periodo y entorno;
- `AbortController` al cambiar de contexto;
- rechazo de respuestas obsoletas;
- conservación del último dato válido durante una actualización;
- lectura automática al entrar en la ruta;
- demostración sintética aislada.

El contrato de cliente será:

```ts
interface DurabilitySnapshotQuery {
  athleteId: string;
  oldest: string;
  newest: string;
  environment: 'all' | 'outdoor' | 'indoor';
}

interface DurabilityApi {
  load(query: DurabilitySnapshotQuery, signal: AbortSignal): Promise<DurabilitySnapshot>;
  confirm(input: ConfirmDurabilityInput): Promise<ConfirmedDurabilityAnalysis>;
}

interface ConfirmDurabilityInput {
  snapshotId: string;
}
```

Las respuestas se validarán con esquemas estrictos antes de entrar en el estado React.

## Arquitectura de servidor

La sincronización existente se ampliará para obtener y normalizar las tres curvas dentro
de la misma operación autorizada. La persistencia utilizará una función transaccional
invocada únicamente por el servidor, de modo que curva, estado de sincronización y
recuentos se confirmen juntos.

Una función autenticada `durability-analysis` ofrecerá:

- `GET`: última instantánea compatible y cálculo normalizado;
- `POST`: confirmación profesional.

En `POST`, el servidor recibirá únicamente `snapshotId`, volverá a leer la instantánea y
repetirá el cálculo versionado. Una instantánea obsoleta o perteneciente a otro ciclista
devolverá conflicto o acceso denegado. El navegador nunca enviará resultados calculados
como fuente de verdad.

## Modelo de datos

### `durability_curve_snapshots`

- `id uuid`.
- `athlete_id uuid`.
- `created_by uuid`.
- `sport text`, inicialmente `Ride`.
- `environment text`.
- `oldest date` y `newest date`.
- `fresh_curve jsonb`.
- `fatigued_curves jsonb`, con nivel, `after_kj`, puntos y procedencia.
- `weight_kg numeric` opcional y `weight_observed_at timestamptz` opcional.
- `source_version text`.
- `content_hash text`.
- `synchronized_at timestamptz`.

Una restricción única por ciclista, contexto y huella evitará duplicados idénticos sin
perder cambios históricos.

### `durability_analysis_runs`

- `id uuid`.
- `athlete_id uuid`.
- `snapshot_id uuid`, ligado además al mismo atleta.
- `created_by uuid`.
- `algorithm_version text`.
- `comparisons jsonb`.
- `quality jsonb`.
- `confirmed_at timestamptz`.

Los análisis confirmados serán inmutables. Crear una nueva decisión generará otra fila.
Las tablas tendrán RLS de lectura por acceso al ciclista; la escritura fisiológica se
realizará exclusivamente mediante funciones de servidor con `service_role`.

## Pantalla

La jerarquía será:

1. Barra global con ciclista, periodo, entorno, última sincronización y acción común.
2. Encabezado de Durabilidad con periodo, fuente y versión del algoritmo.
3. Resumen del trabajo previo: kJ, kJ/kg, peso utilizado y niveles disponibles.
4. Gráfico de descenso por duración y nivel de trabajo.
5. Tabla accesible: duración, fresca, `kJ0`, cambio `kJ0`, `kJ1`, cambio `kJ1` y calidad.
6. Inicio del deterioro por carga para cada duración cuando pueda estimarse.
7. Procedencia, cobertura, advertencias y limitaciones.
8. Acción **Confirmar análisis**.

La gráfica nunca será la única representación. La tabla y los textos conservarán toda la
información para teclado y lector de pantalla.

## Estados y errores

- Sin ciclista: explicación sin solicitar datos.
- Cargando: estructura estable con estado anunciado.
- Sin sincronización: indicación del contexto y acceso a la acción común.
- Umbrales `kJ0` o `kJ1` no configurados: explicación para configurarlos en Intervals.icu.
- Datos parciales: tabla con valores utilizables y celdas ausentes identificadas.
- Peso ausente: kJ absolutos y calidad de cobertura reducida.
- Actualizando con caché: resultado anterior visible y marcado como anterior.
- Fallo con caché: resultado anterior, fecha y reintento común.
- Fallo sin caché: estado vacío recuperable.
- Contexto incompatible: cálculo bloqueado.
- Respuesta obsoleta: descartada sin modificar la vista.

## Seguridad y privacidad

- La sesión se autentica antes de analizar el cuerpo de la petición.
- El UUID interno se autoriza antes de resolver el identificador de Intervals.icu.
- El navegador no elige rutas externas ni estados de aprobación.
- Las tablas de instantáneas y análisis no admiten inserciones directas de
  `authenticated` o `anon`.
- Las relaciones entre análisis, instantánea y atleta se protegen con clave foránea
  compuesta.
- Los logs excluyen nombres, puntos de potencia, tokens, claves y respuestas externas.
- Los streams de actividades no se usarán en esta fase hasta verificar en servidor la
  pertenencia de cada `activity_id` al ciclista solicitado.

## Pruebas y aceptación

La implementación se acepta cuando:

- una sincronización común guarda las curvas fresca, `kJ0` y `kJ1` disponibles;
- todas las rutas comparten el mismo ciclista, periodo, entorno y estado de
  sincronización;
- cambiar a un ciclista ya sincronizado carga sus datos sin otra petición externa;
- cambiar de ruta no inicia una sincronización;
- el descenso firmado, kJ/kg y criterios de calidad reproducen fixtures
  versionados;
- contextos incompatibles, datos no finitos, duplicados y curvas parciales se manejan sin
  fabricar valores;
- respuestas antiguas no sustituyen datos del contexto activo;
- repetir datos idénticos no duplica instantáneas;
- una confirmación se recalcula en servidor y queda inmutable;
- acceso cruzado entre ciclistas, escritura directa y falsificación de instantáneas se
  rechazan;
- Jaume puede sincronizarse una vez, abrir Durabilidad, recargar y conservar datos y
  estado;
- la pantalla poblada funciona con teclado, lector de pantalla, anchura móvil y zoom real
  del 200 %;
- Vitest, Playwright, pgTAP, TypeScript, ESLint, build, escáner de secretos, lint de
  PostgreSQL y comprobación de deriva terminan correctamente.

## Fuentes

- OpenAPI de Intervals.icu incluido en `docs/intervals-icu-openapi.json`, endpoint de
  curvas de potencia y variantes por fatiga.
- Maunder E et al. *The Importance of 'Durability' in the Physiological Profiling of
  Endurance Athletes.* *Sports Medicine*. 2021. PMID: 33886100.
- Stevenson JD et al. *Prolonged cycling reduces power output at the moderate-to-heavy
  intensity transition.* *European Journal of Applied Physiology*. 2022. PMID: 36127418.
- Clark IE et al. *Effects of two hours of heavy-intensity exercise on the power-duration
  relationship.* *Medicine & Science in Sports & Exercise*. 2018.
- Mateo-March M et al. *Is all work the same? Performance after accumulated work of
  differing intensities in male professional cyclists.* 2024. PMID: 38604818.
- Leo P et al. *The Influence of High-Intensity Work on the Record Power Profile of
  Under-23, Pro Team, and World Tour Cyclists.* 2024. PMID: 38531349.
- Mateo-March M et al. *Reliability of the durability concept in professional cyclists: a
  field-based study.* 2025. PMID: 40373793.

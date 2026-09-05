# Estado global del ciclista y análisis de potencia

Fecha: 5 de septiembre de 2026  
Estado: aprobado para planificación

## Contexto

MFPP Metabolic Lab ya autentica al entrenador, descubre su plantilla de Intervals.icu,
incorpora una selección explícita y sincroniza datos normalizados en Supabase local. La
Mesa de análisis funciona con ciclistas reales. Potencia, Durabilidad, Tests, Sesiones,
Prescripción, Evolución e Informes todavía se alimentan de demostraciones aisladas.

Este documento define el primer bloque de la conversión a datos reales: un contexto común
de ciclista y periodo para toda la aplicación, una sincronización coherente y la pantalla
profesional de Potencia y duración. Los bloques posteriores reutilizarán esta base.

Todo el trabajo se realizará exclusivamente en
`/Users/manuelfrancisperezperez/Desktop/MFPP Metabolic Lab`. La aplicación histórica de
`/Users/manuelfrancisperezperez/Desktop/Perfil metabolico` seguirá intacta.

## Objetivo

Permitir que el entrenador seleccione una sola vez un ciclista y un periodo, conserve esa
selección al navegar o recargar, sincronice de forma centralizada y analice una curva de
potencia real con trazabilidad, control profesional y resultados reproducibles.

## Alcance

Incluido:

- Contexto global de ciclista, periodo y estado de sincronización.
- Periodos de 30, 90, 180 y 365 días, más un intervalo personalizado.
- Filtro de entorno: todas las actividades, exterior o rodillo.
- Una única acción de sincronización para el ciclista y periodo activos.
- Persistencia normalizada de instantáneas de curva.
- Visualización y ajuste ECP y Morton 3P.
- Confirmación inmutable de un análisis por el entrenador.
- Estados vacíos, parciales, obsoletos y de error.
- Accesibilidad, diseño adaptable y pruebas de seguridad.

Fuera de este bloque:

- Cálculo real de durabilidad.
- Protocolos de lactato y esprint editables.
- Comparación planificado/realizado.
- Generación de prescripciones.
- Informes con datos reales.
- Cambio automático de zonas o escritura en Intervals.icu.

## Decisiones funcionales

### Ciclista global

El ciclista activo se comparte entre todas las rutas. La selección se guarda en
`localStorage` mediante el UUID interno, nunca mediante el nombre ni el identificador de
Intervals.icu. Al recuperar la sesión se valida el UUID contra la plantilla autorizada. Si
ya no está autorizado, la selección se elimina y la aplicación vuelve al estado vacío.

La elección realizada en cualquier pantalla se refleja de inmediato en las demás. Un
cambio de ciclista cancela o invalida todas las solicitudes pendientes del ciclista
anterior.

### Periodo global

El valor inicial es 90 días. Los accesos rápidos son 30, 90, 180 y 365 días. El intervalo
personalizado requiere fecha inicial y final, no permite fechas futuras ni más de 730 días,
y usa días naturales inclusivos. El periodo se conserva al recargar.

La API de Intervals.icu admite curvas relativas mediante `curves` y una fecha final mediante
`newest`. El servidor transformará el periodo validado en el número de días correspondiente
y nunca aceptará una ruta externa construida por el navegador.

### Sincronización común

La cabecera global mostrará un único botón **Sincronizar con Intervals.icu**. La operación
actualizará para el ciclista y periodo activos:

- perfil y ajustes deportivos;
- actividades;
- curva potencia-duración;
- modelos de potencia entregados por Intervals.icu;
- entrenamientos planificados;
- fecha, resultado y advertencias de sincronización.

Una respuesta parcial conserva cada componente válido e identifica los componentes que no
pudieron actualizarse. Si Intervals.icu no responde, la aplicación mantiene la última
instantánea disponible y la etiqueta como no actualizada. Nunca borra datos válidos por un
fallo remoto.

## Arquitectura de cliente

Un proveedor de React situado dentro de la autenticación y fuera de las rutas administrará:

```ts
type AnalysisPeriod =
  | { preset: 30 | 90 | 180 | 365 }
  | { preset: 'custom'; oldest: string; newest: string };

type AnalysisEnvironment = 'all' | 'outdoor' | 'indoor';

type SyncState =
  | { status: 'idle'; synchronizedAt: string | null }
  | { status: 'running'; synchronizedAt: string | null }
  | { status: 'complete' | 'partial' | 'failed'; synchronizedAt: string | null; message: string };

interface AnalysisContextValue {
  athletes: AthleteSummary[];
  athleteId: string;
  period: AnalysisPeriod;
  environment: 'all' | 'outdoor' | 'indoor';
  sync: SyncState;
  selectAthlete(id: string): void;
  setPeriod(period: AnalysisPeriod): void;
  setEnvironment(value: AnalysisEnvironment): void;
  synchronize(): Promise<void>;
}
```

El proveedor cargará la plantilla autorizada, restaurará preferencias válidas y expondrá
una interfaz única a las pantallas. La Mesa de análisis dejará de ser propietaria exclusiva
de la selección. Una barra de contexto compacta aparecerá en el área principal, por encima
de todas las rutas.

La demostración seguirá siendo una acción explícita y local a cada módulo. Activarla no
cambiará el ciclista global ni persistirá resultados.

## Arquitectura de servidor

La función de sincronización recibirá solo:

```ts
interface SyncRequest {
  athleteId: string;
  oldest: string;
  newest: string;
  environment: 'all' | 'outdoor' | 'indoor';
  syncKey: string;
}
```

Antes de contactar con Intervals.icu comprobará la sesión, la relación del entrenador con
el ciclista, el formato de fechas, la duración máxima y el filtro permitido. El servidor
resolverá el identificador de Intervals.icu desde la base de datos; el navegador no será la
fuente de verdad.

La respuesta será un resumen sin cargas fisiológicas completas:

```ts
interface SyncSummary {
  synchronizedAt: string;
  status: 'complete' | 'partial';
  updated: string[];
  warnings: string[];
}
```

La lectura de potencia tendrá un endpoint autenticado separado que devolverá una
instantánea normalizada ya autorizada. Las cargas originales de Intervals.icu y la clave
API no llegarán al navegador ni se escribirán en logs.

## Modelo de datos

### `power_curve_snapshots`

- `id uuid`.
- `athlete_id uuid` con borrado en cascada.
- `created_by uuid`.
- `sport text`, inicialmente `Ride`.
- `environment text`: `all`, `outdoor` o `indoor`.
- `oldest date` y `newest date`.
- `points jsonb`: lista normalizada de `{ seconds, watts }`.
- `source_models jsonb`: modelos normalizados devueltos por Intervals.icu.
- `source_version text`.
- `content_hash text`: SHA-256 de puntos y modelos normalizados.
- `synchronized_at timestamptz`.
- Restricción única por ciclista, periodo, entorno y huella del contenido para evitar
  duplicados idénticos sin perder cambios históricos.

### `power_analysis_runs`

- `id uuid`.
- `athlete_id uuid`.
- `snapshot_id uuid` con borrado restringido.
- `created_by uuid`.
- `model text`: `ECP` o `MORTON_3P`.
- `algorithm_version text`.
- `cp_watts numeric`, `w_prime_joules numeric` y `pmax_watts numeric` opcional.
- `rmse_watts numeric`.
- `quality jsonb` con advertencias y cobertura.
- `confirmed_at timestamptz`.

Los análisis confirmados no se actualizan ni se eliminan de manera individual desde la
interfaz. Una nueva decisión crea otro análisis. Ambas tablas tendrán RLS basada en
`coach_can_access_athlete`; la inserción requerirá capacidad de edición y `created_by =
auth.uid()`.

## Pantalla Potencia y duración

La pantalla tendrá una jerarquía de lectura orientada al entrenador:

1. Barra común: ciclista, periodo, entorno, última sincronización y acción de sincronizar.
2. Curva potencia-duración con tiempo en escala logarítmica.
3. Resumen de mejores valores observados de 5 s, 1 min, 5 min y 20 min.
4. Resultados modelados: CP, W′ y Pmax.
5. FTP importado mostrado aparte y etiquetado como estimación de Intervals.icu.
6. Selector entre ECP y Morton 3P, con recomendación explicada según cobertura.
7. Calidad: duraciones presentes, antigüedad, RMSE, residuos y advertencias.
8. Tabla accesible con valores observados, modelados y residuos.
9. Acción **Confirmar análisis**.

La gráfica no será la única representación de los datos. La tabla y los textos conservarán
la información para teclado y lector de pantalla. La paleta, tipografía y densidad actuales
se mantendrán; la nueva barra común funcionará como instrumental de laboratorio, sin añadir
decoración ajena al producto.

## Reglas fisiológicas

- FTP, eFTP, CP, W′, Pmax, LT1, LT2, MLSS y P@VO₂max son constructos independientes.
- El ajuste ECP utiliza esfuerzos de dos minutos o más y necesita al menos dos puntos
  válidos.
- Morton 3P necesita al menos tres duraciones distintas y una cobertura anaeróbica y
  aeróbica suficiente para considerarse completo.
- Los valores observados proceden de la curva de Intervals.icu; los resultados modelados
  citan algoritmo y versión.
- Una mala cobertura permite mostrar datos observados, pero bloquea o degrada la confianza
  del modelo correspondiente.
- Confirmar un análisis no modifica zonas, prescripciones ni métricas importadas.
- El entorno interior y exterior nunca se mezclará cuando el entrenador seleccione uno de
  ellos.

## Estados y errores

- Sin ciclista: explicación y selector; no se consulta potencia.
- Sin sincronización del periodo: acción para sincronizar; no se abre una demostración de
  forma automática.
- Curva vacía: mensaje específico y periodo/filtro utilizados.
- Cobertura insuficiente: curva observada, lista de duraciones ausentes y modelo bloqueado
  o marcado con confianza reducida.
- Fallo remoto con caché: datos anteriores visibles, fecha y aviso de obsolescencia.
- Fallo remoto sin caché: estado vacío recuperable.
- Respuesta obsoleta tras cambiar de ciclista: se descarta sin modificar la pantalla.
- Confirmación repetida del mismo análisis: se devuelve el análisis existente y no se
  duplica.

## Seguridad y privacidad

- `INTERVALS_API_KEY` y la clave secreta de Supabase solo existen en procesos de servidor.
- Cada función autentica primero y autoriza el UUID interno antes de resolver el ID externo.
- Los periodos, filtros, tamaños y formas JSON se validan con listas cerradas y límites.
- Los logs registran operación, duración, estado e identificadores internos; excluyen
  nombres, puntos de potencia, tokens y respuestas externas.
- `localStorage` contiene únicamente preferencias no fisiológicas: UUID autorizado, periodo
  y filtro.
- La política CSP de producción no se debilita para admitir el entorno local.

## Pruebas y aceptación

La implementación se acepta cuando:

- el ciclista y periodo activos se mantienen en todas las rutas y tras recargar;
- Jaume u otro ciclista autorizado puede sincronizarse sin mezclar datos con otro;
- las curvas de 30, 90, 180, 365 días y un periodo personalizado válido se solicitan y
  persisten con su contexto;
- repetir una sincronización idéntica no crea otra instantánea;
- un cambio real de datos crea una instantánea nueva;
- ECP y Morton reproducen los casos numéricos versionados;
- FTP importado y CP modelada aparecen separados;
- un análisis confirmado permanece inmutable;
- manipular el UUID, las fechas o el filtro produce 400 o 403 antes de Intervals.icu;
- los fallos parciales conservan datos utilizables y explican qué falta;
- el flujo funciona con teclado, a 200 % de zoom y en anchura móvil;
- Vitest, Playwright, análisis estático, escáner de secretos y lint de PostgreSQL terminan sin
  errores.

## Fuentes técnicas y científicas

- OpenAPI oficial de Intervals.icu, ruta
  `/api/v1/athlete/{id}/power-curves{ext}`, incluida en
  `docs/intervals-icu-openapi.json`.
- Leo P et al. *Power profiling and the power-duration relationship in cycling: a narrative
  review*. European Journal of Applied Physiology, 2022. DOI:
  `10.1007/s00421-021-04833-y`.
- Jones AM et al. *The Critical Power Concept: Applications to Sports Performance with a
  Focus on Intermittent High-Intensity Exercise*. Sports Medicine, 2017. DOI:
  `10.1007/s40279-017-0688-0`.
- Maunder E et al. *The Importance of Durability in the Physiological Profiling of
  Endurance Athletes*. Sports Medicine, 2021. DOI: `10.1007/s40279-021-01459-0`.

## Bloques posteriores

La base común creada aquí será consumida, sin redefinir selección ni sincronización, por:

1. Durabilidad.
2. Tests fisiológicos y evolución.
3. Comparación de sesiones.
4. Prescripción e informes.

Cada bloque tendrá su propia especificación y aceptación antes de implementarse.

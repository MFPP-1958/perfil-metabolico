# Operación de MFPP Metabolic Lab

## Entornos y configuración

La aplicación requiere Node.js 22. El navegador solo recibe la dirección local de Supabase y `VITE_SUPABASE_PUBLISHABLE_KEY`. En desarrollo, Vite reenvía `/supabase` al Supabase local y `/.netlify/functions` al servidor local de funciones. Las funciones reciben `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `INTERVALS_API_KEY`. Los secretos se configuran en el gestor del entorno, nunca en archivos versionados.

Antes de desplegar: ejecutar `npm ci`, `npm run verify`, revisar la migración SQL generada por Supabase CLI y probarla en un proyecto desechable. El despliegue debe publicar `dist` y mantener las cabeceras de `netlify.toml`.

## Conexión real local con Intervals.icu

La configuración real se guarda en el Llavero de macOS. La clave de Intervals.icu y el UUID del propietario no se escriben en `.env`, archivos del proyecto ni almacenamiento del navegador.

1. Abre Docker Desktop y espera a que indique que está iniciado.
2. Desde esta carpeta ejecuta:

```bash
supabase start
npm run configure:real
npm run dev:real
```

3. Pega la clave API únicamente en el cuadro protegido de macOS que abre `configure:real`.
4. Introduce el correo que usarás para acceder a la aplicación local.
5. Abre `http://127.0.0.1:4174` y solicita el enlace de acceso.
6. Lee el mensaje local en Mailpit: `http://127.0.0.1:54324`.
7. Supabase Studio está disponible en `http://127.0.0.1:54323`.

En la Mesa de análisis, pulsa **Conectar Intervals.icu**, marca solo los ciclistas que quieras incorporar y confirma la selección. El selector **Ciclista activo**, el **Periodo** y el **Entorno** de la barra superior forman un contexto común: cualquier cambio se aplica a todas las rutas y se conserva al recargar el navegador. El periodo inicial es de 90 días; también admite 30, 180, 365 días o fechas personalizadas.

Pulsa **Sincronizar con Intervals.icu** en la barra común para actualizar el perfil, las actividades, la curva de potencia y los entrenamientos planificados del contexto elegido. La fecha de la última sincronización aparece junto al botón. La aplicación puede informar de una sincronización parcial si Intervals.icu no devuelve alguno de esos componentes.

## Potencia real, caché e inmutabilidad

La ruta **Potencia** carga la última instantánea que coincide exactamente con el ciclista, el periodo y el entorno seleccionados. La tabla situada bajo la gráfica contiene la misma evidencia en formato accesible. ECP y Morton 3P solo se habilitan cuando la cobertura permite calcular un ajuste válido.

Si una actualización falla y existe una instantánea compatible, la pantalla conserva esa instantánea y muestra un aviso. Nunca reutiliza una instantánea de otro ciclista, periodo o entorno. Si no existe ninguna compatible, usa **Sincronizar ahora**; si el servidor ya respondió pero la pantalla no cambió, usa **Reintentar carga**. Ante una sincronización parcial, revisa los componentes indicados y repite la operación cuando Intervals.icu vuelva a estar disponible.

**Confirmar análisis** guarda la combinación de instantánea, modelo, versión del algoritmo y entrenador como registro inmutable. Repetir la confirmación devuelve el mismo registro y no crea duplicados. Una nueva curva o una versión distinta del algoritmo genera otro registro trazable. La confirmación no cambia zonas, entrenamientos ni prescripciones.

Para recuperar el entorno local sin perder datos:

1. Comprueba que Docker Desktop está iniciado.
2. Ejecuta `supabase start`. No uses `supabase db reset` sobre la base que contiene ciclistas reales.
3. Ejecuta `npm run dev:real` desde la carpeta de esta aplicación.
4. Si la sesión ha caducado, solicita un enlace y ábrelo desde Mailpit en `http://127.0.0.1:54324`.
5. Repite la sincronización del contexto. Si 90 días no ofrecen cobertura suficiente, prueba 365 días sin cambiar zonas ni prescripciones.

### Comprobación anonimizada de idempotencia

Este procedimiento compara los recuentos antes y después de repetir una sincronización y una confirmación. Utiliza únicamente el UUID interno de la base local; no uses el identificador externo de Intervals.icu. Desactiva primero el trazado del shell para que el parámetro no se copie a la terminal:

```bash
set +x
export MFPP_ACCEPTANCE_ATHLETE_ID='<UUID interno>'
export MFPP_ACCEPTANCE_OLDEST='AAAA-MM-DD'
export MFPP_ACCEPTANCE_NEWEST='AAAA-MM-DD'
export MFPP_ACCEPTANCE_ENVIRONMENT='all'
```

Valida los parámetros y define la consulta:

```bash
mfpp_power_counts() {
  [[ "$MFPP_ACCEPTANCE_ATHLETE_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || return 2
  [[ "$MFPP_ACCEPTANCE_OLDEST" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || return 2
  [[ "$MFPP_ACCEPTANCE_NEWEST" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || return 2
  [[ "$MFPP_ACCEPTANCE_ENVIRONMENT" =~ ^(all|outdoor|indoor)$ ]] || return 2
  docker exec supabase_db_perfil-metabolico psql -U postgres -d postgres -Atqc "
    with scoped_snapshots as (
      select id from public.power_curve_snapshots
      where athlete_id = '$MFPP_ACCEPTANCE_ATHLETE_ID'::uuid
        and oldest = '$MFPP_ACCEPTANCE_OLDEST'::date
        and newest = '$MFPP_ACCEPTANCE_NEWEST'::date
        and environment = '$MFPP_ACCEPTANCE_ENVIRONMENT'
    ), counts as (
      select
        (select count(*) from scoped_snapshots) as snapshots,
        (select count(*) from public.power_analysis_runs
          where snapshot_id in (select id from scoped_snapshots)) as analyses
    )
    select json_build_object(
      'oldest', '$MFPP_ACCEPTANCE_OLDEST',
      'newest', '$MFPP_ACCEPTANCE_NEWEST',
      'environment', '$MFPP_ACCEPTANCE_ENVIRONMENT',
      'status', case when snapshots > 0 and analyses > 0 then 'ready' else 'incomplete' end,
      'snapshots', snapshots,
      'analyses', analyses
    ) from counts;
  "
}
```

Ejecuta `mfpp_power_counts`, repite en la aplicación la sincronización y la confirmación del mismo modelo, y ejecuta otra vez `mfpp_power_counts`. La salida solo contiene fechas, entorno, estado y recuentos. Para una operación idempotente, los recuentos deben mantenerse, por ejemplo de 1/1 a 1/1. Al terminar ejecuta `unset MFPP_ACCEPTANCE_ATHLETE_ID MFPP_ACCEPTANCE_OLDEST MFPP_ACCEPTANCE_NEWEST MFPP_ACCEPTANCE_ENVIRONMENT`.

## Rotación de claves

Rotar la clave de Intervals.icu y la clave secreta de Supabase cada 180 días, cuando cambie la persona responsable o ante cualquier sospecha. Crear primero la nueva clave, actualizar Netlify, ejecutar una prueba autenticada con un atleta permitido y revocar después la anterior. Registrar fecha, responsable y resultado sin copiar el secreto.

## Copia, restauración y continuidad

- Activar copias gestionadas diarias de PostgreSQL con retención mínima de 30 días.
- Exportar mensualmente un volcado cifrado y comprobar su suma SHA-256.
- Cada 90 días, restaurar la copia en un proyecto aislado, ejecutar recuentos por tabla y probar acceso de un entrenador y aislamiento de otro.
- Guardar el acta del simulacro con copia utilizada, duración, recuentos y diferencias. Borrar el proyecto aislado al terminar.

El procedimiento operativo de restauración es: congelar escrituras, seleccionar el punto anterior al incidente, restaurar en un proyecto nuevo, ejecutar migraciones posteriores, validar relaciones y RLS, cambiar las variables de Netlify y reabrir el servicio. Nunca se restaura directamente sobre producción sin validar la copia.

## Retención, exportación y borrado

Revisar atletas inactivos cada seis meses. Conservar observaciones e informes mientras exista la relación de entrenamiento y durante el plazo documentado para atender responsabilidades. Ante una solicitud, exportar JSON/CSV y los informes PDF del atleta, verificar identidad y dejar constancia. El borrado autorizado elimina al atleta en una transacción; las claves foráneas eliminan en cascada sus observaciones, actividades, informes y relaciones. Las observaciones no admiten borrado individual, para que una corrección conserve el historial. Se mantiene solo el registro legal mínimo disociado y se confirma la eliminación en copias cuando venza su retención.

## Incidentes

Ante acceso indebido o fuga: revocar sesiones y claves, aislar el despliegue, preservar logs, determinar atletas y campos afectados, documentar cronología y valorar notificación a la AEPD y personas afectadas dentro del plazo legal aplicable. La reapertura exige claves nuevas, causa corregida, pruebas de autorización y aprobación del responsable.

## Monitorización

Alertar por aumento de 401/403/429/5xx, tiempos de función, sincronizaciones parciales y fallos de copia. Los logs incluyen identificadores internos, operación, estado y duración; excluyen nombres, lactato, bienestar, tokens y respuestas completas.

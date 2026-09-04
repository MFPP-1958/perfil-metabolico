# Conexión de Intervals.icu para un único entrenador

Fecha: 4 de septiembre de 2026

## Contexto

MFPP Metabolic Lab ya dispone de autenticación con Supabase, tablas protegidas con RLS, funciones de servidor para consultar Intervals.icu y un proceso de sincronización de ciclistas previamente autorizados. Falta el alta inicial: la aplicación no puede descubrir la plantilla de Intervals.icu porque todavía no existen vínculos en `coach_athletes`, mientras que las funciones actuales filtran por esos vínculos.

La primera versión será utilizada exclusivamente por Manuel como único entrenador. La arquitectura debe permitir probar datos reales localmente sin exponer la clave de Intervals.icu y mantener una ruta clara hacia OAuth si posteriormente se admiten varios entrenadores.

Todo el trabajo de esta fase se realizará exclusivamente en `/Users/manuelfrancisperezperez/Desktop/MFPP Metabolic Lab`. Esta carpeta constituye una aplicación y un repositorio local independientes. `/Users/manuelfrancisperezperez/Desktop/Perfil metabolico` se considera una copia histórica de solo lectura y ningún paso de implementación, prueba o configuración podrá modificarla. La aplicación nueva no tendrá un remoto Git compartido con la anterior; cuando se publique se creará un repositorio remoto propio.

## Objetivo

Permitir que el entrenador propietario conecte su cuenta de Intervals.icu, revise los ciclistas disponibles, seleccione cuáles incorporar y sincronice sus datos fisiológicos y de entrenamiento con Supabase.

La conexión se considerará operativa cuando un usuario propietario autenticado pueda importar un ciclista, verlo en la mesa de análisis y completar una sincronización real sin que la clave API llegue al navegador, al repositorio o a los registros de la aplicación.

## Alcance

Esta fase incluye:

- Conexión mediante una única clave API de Intervals.icu custodiada por el servidor.
- Identificación de un único propietario mediante su UUID de Supabase.
- Consulta y presentación de la plantilla disponible en Intervals.icu.
- Selección explícita de ciclistas antes de incorporarlos.
- Alta idempotente en `athletes` y `coach_athletes`.
- Sincronización de perfil, configuración deportiva, actividades, curvas de potencia y entrenamientos planificados.
- Estados comprensibles de conexión, importación, sincronización parcial y error.
- Pruebas automatizadas de autorización, filtrado, idempotencia y ausencia de secretos.
- Una prueba real inicial con un solo ciclista.

Esta fase no incluye:

- Cuentas de varios entrenadores con claves diferentes.
- OAuth de Intervals.icu.
- Sincronización automática programada.
- Importación masiva sin confirmación previa.
- Escritura de entrenamientos desde MFPP Metabolic Lab hacia Intervals.icu.

## Arquitectura

### Custodia de secretos

Durante el desarrollo local, `INTERVALS_API_KEY` se guardará en el llavero de macOS. El proceso local recuperará la clave al arrancar las funciones, sin copiarla a archivos del proyecto. En producción, la misma variable se configurará en el gestor de secretos de Netlify.

`INTERVALS_OWNER_USER_ID` contendrá el UUID del único usuario autorizado en Supabase. Será una variable exclusiva del servidor. Las claves `SUPABASE_SECRET_KEY` e `INTERVALS_API_KEY` no podrán usar el prefijo `VITE_`, aparecer en respuestas HTTP ni incorporarse al paquete del navegador.

### Función de conexión

Se añadirá una función de servidor dedicada a la conexión inicial. Admitirá dos operaciones:

- `GET`: autentica la sesión, comprueba que el usuario coincide con `INTERVALS_OWNER_USER_ID`, consulta `/api/v1/athletes` y devuelve únicamente resúmenes saneados con `id` y `name`.
- `POST`: repite las comprobaciones, valida una lista limitada de identificadores con formato `i<dígitos>`, confirma que pertenecen a la plantilla obtenida con la clave configurada y crea los vínculos seleccionados.

El cliente nunca enviará nombres como fuente de verdad. El servidor resolverá cada nombre a partir de la respuesta actual de Intervals.icu para impedir altas manipuladas.

### Persistencia

La función utilizará la clave secreta de Supabase en el servidor para:

1. Verificar o crear `coach_profiles` para el propietario.
2. Insertar cada ciclista seleccionado en `athletes` con `created_by` igual al propietario.
3. Resolver el UUID de cada ciclista existente o recién creado.
4. Insertar `coach_athletes` con rol `coach`.

Las operaciones serán idempotentes. Repetir la misma selección no creará duplicados ni cambiará la propiedad de un ciclista existente. Un identificador ya perteneciente a otro propietario producirá conflicto y no se reasignará.

No se requiere una tabla nueva. Se conservarán los esquemas declarativos y las políticas RLS actuales.

### Interfaz

La Mesa de análisis incorporará un panel `Conexión con Intervals.icu` con cuatro estados:

- Sin configurar: explica que falta la conexión del servidor.
- Preparado: permite consultar la plantilla.
- Selección: muestra los ciclistas disponibles con casillas y contador.
- Resultado: informa cuántos se añadieron, ya existían o fallaron.

Después de una importación correcta, la lista de ciclistas se recargará. El botón de sincronización se habilitará para el ciclista seleccionado y mostrará la última sincronización, progreso y advertencias parciales.

La demostración sintética seguirá disponible y estará identificada como tal. Nunca se mezclará con la plantilla real.

## Flujo de datos

1. Supabase Auth crea o recupera la sesión del entrenador.
2. El navegador envía el JWT a la función de conexión.
3. La función valida el JWT mediante Supabase y compara el UUID con `INTERVALS_OWNER_USER_ID`.
4. La función usa la clave API del servidor para consultar Intervals.icu con autenticación Basic, usuario `API_KEY`.
5. El servidor elimina campos sensibles y devuelve resúmenes mínimos.
6. El entrenador selecciona los ciclistas.
7. La función valida la selección contra una consulta nueva de la plantilla y persiste los vínculos.
8. El navegador recarga `/.netlify/functions/athletes`.
9. Al sincronizar un ciclista, el flujo existente obtiene y normaliza los datos antes de escribirlos en las tablas correspondientes.

## Autorización y seguridad

- Toda operación exige un JWT válido de Supabase.
- La conexión inicial exige coincidencia exacta con `INTERVALS_OWNER_USER_ID`.
- La clave API solo se lee desde el entorno del servidor.
- Las respuestas de Intervals.icu se limitan por tamaño y tiempo, y se sanean antes de responder.
- La función admite únicamente los métodos, campos e identificadores documentados.
- Los errores públicos no incluirán cuerpos de respuesta externos, tokens, claves ni detalles internos.
- Los registros solo contendrán códigos de estado, identificadores no secretos y recuentos.
- Las escrituras privilegiadas conservarán la relación `created_by` y no reasignarán filas existentes.
- RLS seguirá protegiendo las lecturas y escrituras ordinarias desde el navegador.

## Tratamiento de errores

- Sin sesión: HTTP 401 y mensaje para iniciar sesión.
- Usuario distinto del propietario: HTTP 403.
- Configuración ausente: HTTP 503 con indicación de que la conexión no está preparada.
- Clave rechazada por Intervals.icu: HTTP 502 con mensaje de conexión inválida, sin reenviar el cuerpo externo.
- Selección inválida o excesiva: HTTP 400.
- Ciclista ajeno a la plantilla: HTTP 400.
- Conflicto de propiedad: HTTP 409 sin modificar la fila existente.
- Fallo de Supabase: HTTP 500 con operación atómica por ciclista y resumen seguro.
- Sincronización parcial: HTTP 207 con una lista cerrada de componentes incompletos.

La importación devolverá recuentos de `added`, `existing` y `failed`. Un fallo individual no ocultará las altas correctas, pero cada ciclista se tratará como una unidad coherente: perfil y vínculo deberán existir juntos.

## Pruebas

### Funciones

- Rechaza solicitudes sin JWT.
- Rechaza usuarios autenticados que no sean el propietario.
- Devuelve 503 cuando falta configuración.
- Devuelve únicamente `id` y `name` de la plantilla.
- Rechaza identificadores mal formados, duplicados, excesivos o ajenos a la plantilla.
- Crea perfiles, ciclistas y vínculos con el propietario correcto.
- Repetir la importación conserva un único ciclista y un único vínculo.
- No reasigna un ciclista perteneciente a otro usuario.
- No expone campos sensibles ni la clave en respuestas o mensajes de error.

### Cliente

- Muestra los estados sin configurar, preparado, selección y resultado.
- No consulta Intervals.icu antes de una acción explícita.
- Recarga la mesa después de incorporar ciclistas.
- Habilita la sincronización solo para un ciclista real autorizado.
- Mantiene separada la demostración sintética.

### Integración local

- Arranque con Supabase local y funciones locales usando secretos recuperados del llavero.
- Inicio de sesión mediante el correo local de Supabase.
- Consulta real de la plantilla.
- Importación de un único ciclista elegido por el entrenador.
- Sincronización real y comprobación de filas, RLS y asesores de Supabase.
- Escaneo del paquete y del repositorio para confirmar que no contienen secretos.

## Operación local

La aplicación dispondrá de un comando documentado para arrancar el entorno real local. El comando obtendrá `INTERVALS_API_KEY` del llavero, obtendrá las claves del Supabase local y las inyectará únicamente en los procesos de desarrollo. No imprimirá valores sensibles.

La primera configuración mostrará un diálogo protegido de macOS para pegar la clave de Intervals.icu. La herramienta validará el formato mínimo y comprobará la clave contra el endpoint de plantilla antes de guardarla. Una clave anterior podrá sustituirse desde el mismo flujo.

## Evolución futura

Cuando se incorporen otros entrenadores, se sustituirán `INTERVALS_OWNER_USER_ID` y la clave compartida por OAuth de Intervals.icu por usuario. Los límites de la función, el saneamiento, la selección explícita y el modelo `coach_athletes` podrán mantenerse. La interfaz no dependerá del mecanismo concreto de credenciales.

## Criterios de aceptación

- Ningún archivo de `/Users/manuelfrancisperezperez/Desktop/Perfil metabolico` se modifica durante la implementación.
- El repositorio de `MFPP Metabolic Lab` funciona de forma independiente y no apunta al remoto Git de la aplicación anterior.
- Solo el propietario configurado puede consultar o incorporar la plantilla.
- La clave API no aparece en Git, archivos de configuración, navegador, respuestas ni registros.
- El entrenador puede seleccionar un ciclista real y verlo en la Mesa de análisis.
- Repetir la incorporación no crea duplicados.
- Un ciclista no puede ser reasignado a otro entrenador.
- La sincronización recupera los componentes disponibles y señala los incompletos.
- Las 98 pruebas actuales continúan pasando junto con las nuevas pruebas.
- La reconstrucción de Supabase local, los asesores y el escaneo de secretos finalizan sin errores.

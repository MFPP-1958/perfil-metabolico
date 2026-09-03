# Operación de MFPP Metabolic Lab

## Entornos y configuración

La aplicación requiere Node.js 22. El navegador solo recibe `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Netlify Functions recibe `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `INTERVALS_API_KEY`. Los secretos se configuran en el gestor del entorno, nunca en archivos versionados.

Antes de desplegar: ejecutar `npm ci`, `npm run verify`, revisar la migración SQL generada por Supabase CLI y probarla en un proyecto desechable. El despliegue debe publicar `dist` y mantener las cabeceras de `netlify.toml`.

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

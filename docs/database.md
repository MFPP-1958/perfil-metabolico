# Base de datos y aislamiento de datos

El esquema declarativo se divide en estructura (`01_core.sql`) y seguridad
(`02_rls.sql`). Las observaciones y resultados derivados son registros trazables: cada
valor conserva fecha, origen, protocolo, calidad y versión del algoritmo.

## Flujo de cambios

1. Modifica primero los archivos de `supabase/schemas/`.
2. Inicia Supabase local con Docker o Podman: `supabase start`.
3. Genera la migración: `supabase db diff -f nombre_del_cambio`.
4. Revisa el SQL generado y ejecuta `supabase db reset`.
5. Ejecuta `npm run test:run` y los asesores con `supabase inspect db`.

No se ha generado una migración manual: debe derivarse del esquema declarativo cuando
el runtime de contenedores esté disponible. Así se evita que migración y estado deseado
diverjan.

## Modelo de autorización

`coach_athletes` define el acceso. `coach_can_access_athlete` permite lectura a relaciones
`coach` y `viewer`; `coach_can_edit_athlete` limita las escrituras al rol `coach`. Solo el
propietario del atleta puede cambiar roles, por lo que un visor no puede ascenderse. Las políticas se limitan al
rol `authenticated` y usan `(select auth.uid())` para evitar recalcular la identidad por
fila. `anon` no conserva privilegios sobre las tablas profesionales.

La clave secreta de Supabase se reserva para funciones de servidor. En el navegador se
utiliza una clave publicable, siempre bajo RLS.

## Inmutabilidad

Las observaciones no tienen política de actualización ni borrado individual. Una corrección
crea otra observación. Los disparadores bloquean cualquier cambio posterior al reconocimiento
de un resultado o a la aprobación de una prescripción; la evidencia se edita antes de esa
transición. El borrado completo de un atleta sigue disponible para atender el derecho de
supresión y elimina sus datos relacionados en cascada.

## Comprobación antes de producción

- Ejecutar las pruebas de políticas con dos usuarios autenticados.
- Confirmar con RLS Tester que el segundo entrenador no lee ni modifica otro ciclista.
- Ejecutar asesores de seguridad y rendimiento.
- Probar copia de seguridad y restauración en un entorno sin datos reales.

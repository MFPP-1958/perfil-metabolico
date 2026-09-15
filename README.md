# MFPP Metabolic Lab

Aplicación local para revisar datos fisiológicos de ciclistas con un contexto común de atleta, periodo y entorno. La sincronización con Intervals.icu se ejecuta desde la barra superior y guarda instantáneas locales que alimentan Potencia y Durabilidad. Navegar entre módulos o recargar solo vuelve a leer esas instantáneas.

## Arranque

Para trabajar con fixtures:

```bash
npm ci
npm run dev
```

Para usar la conexión real local, sigue [docs/operations.md](docs/operations.md). Las credenciales permanecen en el Llavero de macOS y las funciones del servidor; no deben copiarse a archivos, URLs, capturas ni registros.

## Durabilidad

Durabilidad compara la potencia fresca con curvas obtenidas después de acumular trabajo. Los niveles `kJ0` y `kJ1` dependen de los umbrales configurados y de las curvas que Intervals.icu entregue para el periodo y entorno elegidos. Si faltan, la aplicación conserva la curva fresca, muestra cada ausencia y bloquea la confirmación cuando la cobertura es insuficiente.

Una cobertura alta describe la cantidad y compatibilidad de registros de campo disponibles. Sigue siendo un perfil récord de campo, condicionado por las actividades registradas, los dispositivos y la configuración de Intervals.icu.

**Confirmar análisis** envía únicamente el identificador interno de la instantánea. El servidor vuelve a calcular el resultado antes de guardar el registro inmutable. Esta acción no modifica zonas ni prescripciones.

## Verificación

```bash
npm run verify
npm run test:e2e
npx supabase test db supabase/tests/power_sync_security.test.sql supabase/tests/durability_security.test.sql
```

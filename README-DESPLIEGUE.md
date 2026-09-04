# Despliegue privado del perfil metabólico

La operación, rotación de claves, copias y restauración se detallan en
`docs/operations.md`. Antes de producción deben cerrarse
`docs/privacy-checklist.md` y la revisión de `docs/model-register.md`.

Comprobación local completa:

```bash
npm ci
npm run verify
npm run test:e2e
```

La aplicación se compila con Vite, se publica desde `dist/` y accede a Intervals.icu
únicamente a través de funciones autenticadas. El navegador nunca recibe la clave de
Intervals.icu ni una clave secreta de Supabase.

El prototipo anterior se conserva como referencia en `legacy/dashboard-v7.html`. Esa
carpeta no se publica. `public/index.html` también queda fuera de la entrada de producción
y tiene desactivadas la conexión directa, la carga automática de demo y la prescripción.

## Variables de entorno

Configura estas variables en Netlify:

| Variable | Ámbito | Uso |
|---|---|---|
| `INTERVALS_API_KEY` | Funciones | Lectura de Intervals.icu |
| `SUPABASE_URL` | Funciones | Validación de sesión y autorización |
| `SUPABASE_SECRET_KEY` | Funciones | Consulta administrativa del vínculo entrenador-ciclista |
| `VITE_SUPABASE_URL` | Compilación/navegador | Supabase Auth |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Compilación/navegador | Clave pública de Supabase |

`SUPABASE_SECRET_KEY` e `INTERVALS_API_KEY` no deben comenzar por `VITE_`, aparecer en
archivos del repositorio ni copiarse al almacenamiento del navegador. El antiguo
`MFPP_ACCESS_CODE` deja de utilizarse: un código en la URL no sustituye a una sesión.

## Preparación de Supabase

1. Inicia Docker y ejecuta `supabase start`.
2. Genera la migración desde `supabase/schemas/` con `supabase db diff -f initial_schema`.
3. Revisa el SQL generado, ejecuta `supabase db reset` y lanza las pruebas antes de vincular un proyecto remoto.
4. Configura la URL pública de la aplicación y las URL de redirección de Auth.
5. Crea la cuenta del entrenador y su fila en `coach_profiles`.
6. Vincula cada ciclista con el entrenador en `coach_athletes`.
7. Comprueba con dos cuentas que una no puede leer ni modificar atletas de la otra y ejecuta los advisors de seguridad y rendimiento.

Las claves actuales de Supabase pueden ser publicables (`sb_publishable_…`) o secretas
(`sb_secret_…`). La clave secreta solo se usa en las funciones de servidor.

## Despliegue en Netlify

1. Conecta el repositorio privado.
2. Añade las variables anteriores en la configuración del sitio.
3. Ejecuta un despliegue. `netlify.toml` usa `npm run build`, publica `dist/` y empaqueta
   las funciones con esbuild.
4. Comprueba inicio y cierre de sesión, aislamiento de ciclistas y cabeceras de seguridad.

## Desarrollo local

```bash
npm ci
npm run dev
```

Para ejecutar funciones y frontend juntos utiliza Netlify CLI y un archivo de variables
local no versionado. Las pruebas automatizadas no contactan con Supabase ni con Intervals.icu.

```bash
npx netlify dev
npm run test:run
```

Para trabajar con datos reales en este Mac no se usa un archivo de variables. La clave se
guarda en el Llavero de macOS mediante un cuadro protegido:

```bash
supabase start
npm run configure:real
npm run dev:real
```

La aplicación abre en `http://127.0.0.1:4174`. El correo local para iniciar sesión se lee
en Mailpit (`http://127.0.0.1:54324`) y la base de datos se inspecciona en Supabase Studio
(`http://127.0.0.1:54323`). No pegues la clave API en el navegador, el terminal, un archivo
`.env` ni un mensaje: introdúcela solo en el cuadro protegido que abre `configure:real`.

## Contrato del gateway de Intervals.icu

`/.netlify/functions/intervals-connection` admite `GET` y `POST`, valida la sesión y el
UUID del único propietario. `GET` devuelve únicamente identificador y nombre de los
ciclistas accesibles. `POST` incorpora solo una selección explícita y conserva la
propiedad de cualquier ciclista que ya exista.

`/.netlify/functions/intervals` admite `GET`, exige `Authorization: Bearer <token>` y
acepta solo operaciones con nombre: `athletes`, `athlete`, `sport_settings`,
`power_curves`, `activities`, `activity_streams`, `activity_intervals` y
`planned_events`. La función construye la ruta externa y verifica que el entrenador
tenga acceso al ciclista antes de hacer la petición.

Las respuestas eliminan credenciales, correos, identificadores de conexiones y campos
de bienestar especialmente sensibles. Los errores externos se normalizan y no exponen
la URL, el cuerpo de respuesta ni secretos.

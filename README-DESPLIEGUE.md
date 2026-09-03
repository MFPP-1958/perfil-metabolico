# Despliegue privado del perfil metabólico

La aplicación se compila con Vite, se publica desde `dist/` y accede a Intervals.icu
únicamente a través de funciones autenticadas. El navegador nunca recibe la clave de
Intervals.icu ni una clave secreta de Supabase.

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

1. Crea el proyecto y aplica las migraciones versionadas de `supabase/migrations/`.
2. Configura la URL pública de la aplicación y las URL de redirección de Auth.
3. Crea la cuenta del entrenador y su fila en `coach_profiles`.
4. Vincula cada ciclista con el entrenador en `coach_athletes`.
5. Usa el RLS Tester para comprobar que una segunda cuenta no puede leer esos datos.

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
npm install
npm run dev
```

Para ejecutar funciones y frontend juntos utiliza Netlify CLI y un archivo de variables
local no versionado. Las pruebas no contactan con Supabase ni con Intervals.icu.

```bash
npx netlify dev
npm run test:run
```

## Contrato del gateway de Intervals.icu

`/.netlify/functions/intervals` admite `GET`, exige `Authorization: Bearer <token>` y
acepta solo operaciones con nombre: `athletes`, `athlete`, `sport_settings`,
`power_curves`, `activities`, `activity_streams`, `activity_intervals` y
`planned_events`. La función construye la ruta externa y verifica que el entrenador
tenga acceso al ciclista antes de hacer la petición.

Las respuestas eliminan credenciales, correos, identificadores de conexiones y campos
de bienestar especialmente sensibles. Los errores externos se normalizan y no exponen
la URL, el cuerpo de respuesta ni secretos.

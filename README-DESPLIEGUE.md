# Dashboard Metabólico MFPP — despliegue en Netlify

## Cómo está montado

```
Perfil metabolico/
├── public/                   ← lo ÚNICO que se publica en internet
│   └── index.html                el dashboard
├── netlify/functions/
│   └── intervals.js              proxy: guarda la API key en el servidor
├── netlify.toml                  configuración de Netlify
├── config.local.js               TU API KEY — nunca se sube (está en .gitignore)
├── config.local.example.js       plantilla para otro ordenador
└── .gitignore
```

**Por qué `config.local.js` está fuera de `public/`:** Netlify solo publica `public/`.
Aunque te equivoques y subas el proyecto entero por arrastre, la clave no puede acabar
en internet, porque no está en la carpeta que se publica.

## Por qué hace falta el proxy

`GET /api/v1/athletes` devuelve, para **cada uno de tus 11 atletas**, su `icu_api_key`
y su `email`. Si el navegador llamase directamente a la API con tu clave, esa web
publicaría las credenciales de tus diez ciclistas, y con permiso `WRITE` cualquiera
podría modificar sus cuentas.

Con el proxy: el navegador llama a `/.netlify/functions/intervals`, la función añade la
clave desde una variable de entorno, y antes de responder elimina `icu_api_key`, `email`
y demás campos sensibles. La clave nunca baja al navegador.

En local no hace falta: se usa `config.local.js` y la llamada va directa
(intervals.icu permite CORS y refleja el origen, incluido `file://`).

---

## Pasos para publicarlo

### 1. Repositorio en GitHub (privado)

```bash
cd "/Users/manuelfrancisperezperez/Desktop/Perfil metabolico"
git init
git add .
git commit -m "Dashboard metabólico con proxy para Intervals.icu"
```

Comprueba **antes de subir** que la clave no va incluida:

```bash
git ls-files | grep config.local.js
```

No debe devolver nada. Si aparece `config.local.js`, para y avísame.

Crea el repositorio en GitHub como **privado** y súbelo:

```bash
git remote add origin https://github.com/TU_USUARIO/perfil-metabolico.git
git branch -M main
git push -u origin main
```

### 2. Conectar Netlify

1. Entra en https://app.netlify.com y regístrate con GitHub.
2. **Add new site → Import an existing project → GitHub**.
3. Autoriza Netlify y elige el repositorio `perfil-metabolico`.
4. En la pantalla de configuración **no toques nada**: `netlify.toml` ya indica que
   se publica `public/` y que las funciones están en `netlify/functions`.
5. **Deploy site**.

Te dará una URL tipo `https://algo-aleatorio.netlify.app`. En **Site configuration →
Change site name** puedes ponerle algo como `mfpp-metabolico`.

### 3. La API key como variable de entorno

Esto es lo que hace que funcione sin publicar la clave.

1. **Site configuration → Environment variables → Add a variable**.
2. Key: `INTERVALS_API_KEY`
   Value: tu clave de intervals.icu (Settings → Developer).
3. Guarda y ve a **Deploys → Trigger deploy → Deploy site** para que la coja.

### 4. Proteger el acceso (recomendado)

La web es pública: cualquiera con la URL vería los datos de tus ciclistas —menores
incluidos—. Añade una segunda variable de entorno:

- Key: `MFPP_ACCESS_CODE`
- Value: la contraseña que quieras

Con eso, la función rechaza cualquier consulta que no traiga el código. En el dashboard
publicado se introduce una sola vez en el campo **"Código de acceso"** de la pestaña
Intervals.icu, y queda guardado en ese navegador.

No es seguridad fuerte (el código viaja en la URL de la llamada), pero evita que
cualquiera que dé con la dirección vea los datos. Si necesitas algo serio,
Netlify tiene autenticación por contraseña real en sus planes de pago.

---

## El día a día

A partir de aquí, cada cambio se publica solo:

```bash
git add .
git commit -m "lo que hayas cambiado"
git push
```

Netlify detecta el push y despliega en menos de un minuto. Recarga la web y ya está.

### Probar en local antes de subir

```bash
cd "/Users/manuelfrancisperezperez/Desktop/Perfil metabolico"
python3 -m http.server 8765
```

y abre http://localhost:8765/public/index.html — usa `config.local.js`, sin tocar Netlify.

Para probar además el proxy tal como funcionará publicado:

```bash
npm install -g netlify-cli
netlify dev
```

---

## Si algo falla

| Síntoma | Causa habitual |
|---|---|
| "Falta la variable de entorno INTERVALS_API_KEY" | No la creaste, o no relanzaste el deploy después |
| "Código de acceso incorrecto" | `MFPP_ACCESS_CODE` no coincide con el del campo |
| "Ruta no permitida" | La función solo admite las rutas de `RUTAS_PERMITIDAS` en `netlify/functions/intervals.js` |
| La API responde 401 | Clave caducada o regenerada en intervals.icu |
| La API responde 422 en la curva | Faltan `curves` y `type`, que son obligatorios |

## Rutas de la API verificadas

| Para qué | Ruta |
|---|---|
| Listar tus ciclistas | `/athletes` (sin ID; la clave determina el acceso) |
| Perfil de un ciclista | `/athlete/{id}` — el peso está en `icu_weight`, el FTP en `sportSettings[]` |
| Curva de potencia | `/athlete/{id}/power-curves?curves=90d&type=Ride` — ambos parámetros obligatorios |
| Actividades | `/athlete/{id}/activities?oldest=&newest=` |
| Bienestar | `/athlete/{id}/wellness?oldest=&newest=` |

No existen: `/power_curve`, `/power-curve`, `/power`, `/fitness`, `/athlete/{id}/athletes`.

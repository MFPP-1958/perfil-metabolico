// Proxy entre el dashboard y la API de Intervals.icu.
//
// Motivo: /athletes devuelve, para cada atleta, su icu_api_key y su email. Si el
// navegador llamase directamente a la API con la clave del entrenador, esa clave y
// las de los diez ciclistas quedarian visibles para cualquiera que abra la web.
// Aqui la clave vive en una variable de entorno de Netlify y nunca baja al cliente,
// y ademas se limpian los campos sensibles antes de responder.

const API = "https://intervals.icu/api/v1";

// Rutas admitidas, todas comprobadas contra la API real. La lista es cerrada para
// que nadie pueda usar la funcion como proxy abierto hacia cualquier endpoint con
// tu clave (por ejemplo los PUT/POST que modifican cuentas ajenas).
//
// Los ids de atleta son i + digitos. Los de actividad pueden venir con o sin la i.
const RUTAS_PERMITIDAS = [
  // --- Atletas ---
  /^\/athletes$/,
  /^\/athlete\/i\d+$/,
  /^\/athlete\/i\d+\/profile$/,
  /^\/athlete\/i\d+\/sport-settings$/,
  /^\/athlete\/i\d+\/athlete-summary$/,
  /^\/athlete\/i\d+\/connections$/,

  // --- Curvas y modelos del atleta ---
  /^\/athlete\/i\d+\/power-curves$/,
  /^\/athlete\/i\d+\/hr-curves$/,
  /^\/athlete\/i\d+\/pace-curves$/,
  /^\/athlete\/i\d+\/power-hr-curve$/,
  /^\/athlete\/i\d+\/activity-power-curves$/,
  /^\/athlete\/i\d+\/activity-hr-curves$/,
  /^\/athlete\/i\d+\/mmp-model$/,

  // --- Listados de actividades ---
  /^\/athlete\/i\d+\/activities$/,
  /^\/athlete\/i\d+\/activities-around$/,
  /^\/athlete\/i\d+\/activities\/search$/,
  /^\/athlete\/i\d+\/activities\/interval-search$/,
  /^\/athlete\/i\d+\/activity-tags$/,

  // --- Bienestar y calendario ---
  /^\/athlete\/i\d+\/wellness$/,
  /^\/athlete\/i\d+\/wellness\/\d{4}-\d{2}-\d{2}$/,
  /^\/athlete\/i\d+\/events$/,
  /^\/athlete\/i\d+\/event-tags$/,
  /^\/athlete\/i\d+\/fitness-model-events$/,

  // --- Una actividad concreta ---
  /^\/activity\/i?\d+$/,
  /^\/activity\/i?\d+\/streams$/,
  /^\/activity\/i?\d+\/intervals$/,
  /^\/activity\/i?\d+\/power-curve$/,
  /^\/activity\/i?\d+\/power-curves$/,
  /^\/activity\/i?\d+\/pace-curve$/,
  /^\/activity\/i?\d+\/hr-curve$/,
  /^\/activity\/i?\d+\/power-histogram$/,
  /^\/activity\/i?\d+\/hr-histogram$/,
  /^\/activity\/i?\d+\/pace-histogram$/,
  /^\/activity\/i?\d+\/gap-histogram$/,
  /^\/activity\/i?\d+\/power-vs-hr$/,
  /^\/activity\/i?\d+\/time-at-hr$/,
  /^\/activity\/i?\d+\/hr-load-model$/,
  /^\/activity\/i?\d+\/power-spike-model$/,
  /^\/activity\/i?\d+\/best-efforts$/,
  /^\/activity\/i?\d+\/interval-stats$/,
  /^\/activity\/i?\d+\/weather-summary$/,
  /^\/activity\/i?\d+\/segments$/,
  /^\/activity\/i?\d+\/map$/
];

const PARAMS_PERMITIDOS = new Set([
  // rangos y limites
  "oldest", "newest", "limit", "fields", "start", "end", "now",
  // curvas
  "curves", "type", "includeRanks", "pmType", "secs", "distances", "gap",
  "subMaxEfforts", "fatigue",
  // streams
  "types", "includeDefaults",
  // histogramas
  "bucketSize",
  // busquedas
  "q", "tags", "route_id", "activity_id",
  "minSecs", "maxSecs", "minIntensity", "maxIntensity", "minReps", "maxReps",
  // eventos
  "category", "resolve", "calendar_id",
  // actividad
  "intervals", "stream", "duration", "distance", "count", "minValue",
  "excludeIntervals", "startIndex", "endIndex", "start_index", "end_index",
  // mapa
  "bounds", "boundsOnly", "weather", "descr_config"
]);

// Campos que jamas deben llegar al navegador.
const CAMPOS_SENSIBLES = new Set([
  "icu_api_key", "email", "icu_friend_invite_token", "has_password",
  "strava_id", "strava_authorized", "concept2_user_id", "coros_user_id",
  "huawei_user_id", "suunto_user_id", "wahoo_user_id", "zepp_user_id",
  "zwift_user_id", "google_scope", "dropbox_scope", "oura_scope",
  "polar_scope", "suunto_scope", "whoop_scope", "push_notifications",
  "has_push_subscriptions", "sponsored_by_chat_id"
]);

function limpiar(dato) {
  if (Array.isArray(dato)) {
    // Los streams son arrays enormes de numeros: no hay nada que limpiar dentro
    // y recorrerlos elemento a elemento seria tirar tiempo.
    if (dato.length && typeof dato[0] !== "object") return dato;
    return dato.map(limpiar);
  }
  if (dato && typeof dato === "object") {
    const salida = {};
    for (const clave of Object.keys(dato)) {
      if (CAMPOS_SENSIBLES.has(clave)) continue;
      salida[clave] = limpiar(dato[clave]);
    }
    return salida;
  }
  return dato;
}

function respuesta(status, cuerpo) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(cuerpo)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "GET") {
    return respuesta(405, { error: "Solo se admite GET." });
  }

  const clave = process.env.INTERVALS_API_KEY;
  if (!clave) {
    return respuesta(500, {
      error: "Falta la variable de entorno INTERVALS_API_KEY en Netlify."
    });
  }

  // Codigo de acceso opcional: si defines MFPP_ACCESS_CODE en Netlify, el
  // dashboard tendra que enviarlo. Sin el, la web queda abierta a cualquiera.
  const codigoEsperado = process.env.MFPP_ACCESS_CODE;
  if (codigoEsperado) {
    const enviado = (event.queryStringParameters || {}).code || "";
    if (enviado !== codigoEsperado) {
      return respuesta(401, { error: "Codigo de acceso incorrecto." });
    }
  }

  const params = event.queryStringParameters || {};
  const ruta = params.path || "";

  const [camino, ...resto] = ruta.split("?");
  if (!RUTAS_PERMITIDAS.some(r => r.test(camino))) {
    return respuesta(400, { error: "Ruta no permitida: " + camino });
  }

  // Reconstruye la query admitiendo solo parametros conocidos.
  const entrantes = new URLSearchParams(resto.join("?"));
  const salientes = new URLSearchParams();
  for (const [k, v] of entrantes) {
    if (PARAMS_PERMITIDOS.has(k)) salientes.append(k, v);
  }
  const query = salientes.toString();
  const url = API + camino + (query ? "?" + query : "");

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: "Basic " + Buffer.from("API_KEY:" + clave).toString("base64"),
        Accept: "application/json"
      }
    });

    const texto = await res.text();
    if (!res.ok) {
      // El 422 mas habitual es intentar leer en detalle una actividad de Strava.
      let pista = "";
      if (res.status === 422 && texto.indexOf("Strava") >= 0) {
        pista = " Intervals.icu no permite leer por API las actividades importadas"
              + " de Strava. Solo funciona con las que llegan de Garmin, Wahoo,"
              + " subida manual o desde el propio dispositivo.";
      }
      return respuesta(res.status, {
        error: "Intervals.icu respondio " + res.status + "." + pista,
        detalle: texto.slice(0, 300)
      });
    }

    let datos;
    try {
      datos = JSON.parse(texto);
    } catch (e) {
      return respuesta(502, { error: "Intervals.icu no devolvio JSON valido." });
    }

    return respuesta(200, limpiar(datos));
  } catch (e) {
    return respuesta(502, { error: "No se pudo contactar con Intervals.icu: " + e.message });
  }
};

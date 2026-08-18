// Proxy entre el dashboard y la API de Intervals.icu.
//
// Motivo: /athletes devuelve, para cada atleta, su icu_api_key y su email. Si el
// navegador llamase directamente a la API con la clave del entrenador, esa clave y
// las de los diez ciclistas quedarian visibles para cualquiera que abra la web.
// Aqui la clave vive en una variable de entorno de Netlify y nunca baja al cliente,
// y ademas se limpian los campos sensibles antes de responder.

const API = "https://intervals.icu/api/v1";

// Solo estas rutas. Evita que alguien use la funcion como proxy abierto
// hacia cualquier otro endpoint de la API con tu clave.
const RUTAS_PERMITIDAS = [
  /^\/athletes$/,
  /^\/athlete\/i\d+$/,
  /^\/athlete\/i\d+\/power-curves$/,
  /^\/athlete\/i\d+\/activities$/,
  /^\/athlete\/i\d+\/wellness$/
];

const PARAMS_PERMITIDOS = new Set(["curves", "type", "oldest", "newest", "limit"]);

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
  if (Array.isArray(dato)) return dato.map(limpiar);
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
      return respuesta(res.status, {
        error: "Intervals.icu respondio " + res.status,
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

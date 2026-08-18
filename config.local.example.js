// PLANTILLA. Copiala como config.local.js y rellena tu clave:  cp config.local.example.js config.local.js
//
// Este archivo esta en .gitignore y vive FUERA de public/, asi que no se sube a
// git ni se publica en Netlify. Solo sirve para trabajar en tu ordenador.
//
// En Netlify la clave NO va aqui: se pone como variable de entorno
// INTERVALS_API_KEY y la usa netlify/functions/intervals.js, de forma que
// nunca llega al navegador. Ver README-DESPLIEGUE.md.

window.MFPP_CONFIG = {
  // Tu ID en Intervals.icu. Es informativo: el acceso lo concede la clave.
  coachId: "i25190",

  // Clave de API del entrenador. Con ella se listan los atletas accesibles.
  // Si esta clave se filtra, regenerala en intervals.icu > Settings > Developer.
  apiKey: "PEGA_AQUI_TU_API_KEY",

  // Ciclistas que quieres ver en el dashboard.
  // Deja la lista vacia ([]) para mostrar todos los que devuelva la API.
  atletasPermitidos: [
    "i569408", // Blas Vicente Blanch
    "i637068", // David SS
    "i586937", // GAUCHIA
    "i571792", // Ivan Sanchez
    "i593028", // Jaume Santamaria
    "i450014", // Jorge Negre Bandin
    "i648338", // Karles Cubedo Montins
    "i637073", // Maria SS
    "i566978", // Nicolas Barrera
    "i649756"  // Quiqueciclismo
  ]
};

// ---------------------------------------------------------------------------
// DEFENSA DE LA BUSQUEDA EN EL SERVIDOR
// ---------------------------------------------------------------------------
// La busqueda de pacientes consulta PostgREST con un filtro de texto armado a
// mano:  `or(nombre.ilike.%termino%,cedula.ilike.termino%)`
//
// Ese filtro es un mini-lenguaje: las comas separan condiciones y los puntos
// separan columna, operador y valor. Si lo que escribe el usuario trae comas,
// puntos o comillas, el filtro deja de describing "buscar este nombre" y pasa a
// describing otra consulta... o a quedar roto y devolver un error al usuario.
//
// El caso real comprobado: una COMILLA DOBLE no estaba sanitizada. Con
// `a"b` el filtro quedaba `nombre.ilike.%A"B%,cedula...` y PostgREST lo leia
// como un solo valor con comilla sin cerrar: la busqueda fallaba entera.
//
// Regla del modulo: el usuario puede escribir LO QUE QUIERA, pero al filtro solo
// llega una lista blanca de caracteres. Un nombre con apostrofe (O'Brien)
// sigue funcionando porque el apostrophe SI esta permitido; lo que no pasa es
// cualquier cosa capaz de cambiar la ESTRUCTURA de la consulta.
//
// Modulo puro, sin dependencias: se prueba con node --test.
// ---------------------------------------------------------------------------

// Caracteres con significado estructural en el filtro de PostgREST.
const ESTRUCTURA = /[,()\\.%*"']/g;

// Lo que si puede aparecer en un nombre o cedula real. Se comparan sin tildes
// porque la busqueda ya normaliza a mayusculas.
const PERMITIDO = /^[\dA-ZÑÜ#\s-]+$/;

/**
 * Limpia lo que el usuario escribe antes de meterlo en el filtro.
 * Colapsa espacios y quita lo queromperia la consulta.
 *
 * @param {string} texto
 * @returns {string} Texto seguro, ya en mayusculas
 */
export const sanitizarTermino = (texto) => String(texto ?? '')
  .toUpperCase()
  .normalize('NFD')
  // Quita las tildes: "Muñoz" -> "MUNOZ", para que el usuario no tenga que
  // acordarse de como se escribio el nombre en la ficha.
  .replace(/[\u0300-\u036f]/g, '')
  // Quita todo lo que tenga estructura de filtro, y tambien el & y el =, que
  // se colarian en la URL de la peticion.
  .replace(ESTRUCTURA, ' ')
  .replace(/[&=<>]/g, ' ')
  // Deja solo letras, digitos y los separadores razonables de un nombre.
  .replace(/[^A-ZÑÜ#0-9\s-]/g, ' ')
  .replace(/-/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Convierte un termino limpio en el comodin de PostgREST para nombres compuestos:
 * "Juan Perez" -> "JUAN%PEREZ", que encuentra el nombre aunque este en el medio.
 * @param {string} sanitizado
 */
export const aComodin = (sanitizado) => sanitizado.replace(/\s+/g, '%');

/**
 * Arma el filtro `or(...)` de la busqueda.
 *
 * @param {string} texto Lo que escribio el usuario (sin limpiar).
 * @returns {string|null} El filtro, o null si el termino es demasiado corto.
 */
export const construirFiltroBusqueda = (texto) => {
  const sanitizado = sanitizarTermino(texto);
  // Con menos de 2 letras se traeria practicamente toda la tabla.
  if (sanitizado.length < 2) return null;
  // Cinturon y tirantes: si algo se colara, mejor no buscar a que devuelva
  // cualquier cosa. La lista blanca de arriba ya lo impide, pero que la ultima
  // linea del filtro no dependa de un solo filtro de caracteres.
  if (!PERMITIDO.test(sanitizado)) return null;

  const termino = aComodin(sanitizado);
  return /^\d+$/.test(sanitizado)
    ? `cedula.ilike.${termino}%,nombre.ilike.%${termino}%`
    : `nombre.ilike.%${termino}%,cedula.ilike.${termino}%`;
};

/**
 * Como se vera la busqueda en el historial de la app. Solo para mostrar.
 * @param {string} texto
 */
export const terminoLegible = (texto) => sanitizarTermino(texto);
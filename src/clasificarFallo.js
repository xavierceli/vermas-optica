// ---------------------------------------------------------------------------
// CLASIFICACION DE UN RECHAZO DEL SERVIDOR
// ---------------------------------------------------------------------------
// Cuando el servidor rechaza una operacion hay que decidir una sola cosa:
// ¿se reintenta, se marca como conflicto, o se descarta para siempre?
//
// El error grave que se corrigio aqui: "Stock insuficiente" estaba en la lista
// de rechazos PERMANENTES. O sea, si dos equipos vendian la misma montura y el
// stock se agotaba, la operacion se marcaba 'descartada' y a los 7 dias se
// borraba de la base local.
//
// El detalle que hace el dano: en el servidor la funcion crear_venta() mete la
// evaluacion clinica y la venta en la MISMA transaccion (llama a
// guardar_consulta_clinica por dentro). Si la venta falla por stock, la
// evaluacion optometrica tampoco se guarda. Al descartarla en el cliente se
// perdian las dos cosas, y el optometrista no tenia forma de reasignar la
// montura sin perder el examen.
//
// Ahora un rechazo de stock NO descarta nada: pasa a 'conflict', que espera en
// la cola hasta que alguien lo resuelve. Los datos del paciente no se pierden
// nunca por un problema de inventario.
//
// Modulo puro, sin dependencias: se prueba con node --test.
// ---------------------------------------------------------------------------

/**
 * Marcas que SI invalidan los datos: no tiene sentido reintentarlas porque van a
 * fallar igual. Aqui el descarte SI es lo correcto.
 */
const RECHAZO_PERMANENTE = [
  'item de venta inválido', 'item de venta invalido',
  'violates check constraint', 'duplicate key',
  'foreign key', 'violates foreign key', '23503'
];

/**
 * Marcas que se deben a una CONFLICCIÓN DE INVENTARIO, no a datos malos.
 * Reintentarlas mas tarde puede funcionar: si el producto vuelve a estar
 * disponible, o si se reasigna la montura, la operacion se aplica.
 */
const CONFLICTO_STOCK = [
  'stock insuficiente', 'no hay stock', 'insufficient stock',
  '23514', 'excede el stock'
];

/** Fallos de red: no son rechazos del servidor, hay que reintentar tal cual. */
const esFalloDeRed = motivo => /failed to fetch|network|load failed|timeout|aborted|fetch failed/i
  .test(String(motivo || ''));

/**
 * Que hay que hacer con una operacion que el servidor rechazo.
 *
 * @param {string} motivo Texto del error que devolvio el servidor.
 * @param {object} [opciones]
 * @param {number} [opciones.intentos] Intentos que ya lleva la operacion.
 * @param {number} [opciones.maxIntentos] Tope antes de rendirse.
 * @param {string} [opciones.tipo] Tipo de operacion (para el caso de archivar).
 * @returns {'red'|'descartada'|'conflict'|'reintentable'}
 *   - red        : fallo de conexion, se reintenta sin cambiar nada.
 *   - descartada : datos invalidos, no tiene sentido seguir intentando.
 *   - conflict   : choca con el estado del servidor, espera a que se resuelva.
 *   - reintentable: error temporal del servidor.
 */
export const clasificarFallo = (motivo, { intentos = 0, maxIntentos = 5, tipo = '' } = {}) => {
  const texto = String(motivo || '').toLowerCase();

  if (!texto) return 'reintentable';

  // 1. Red primero: un corte de internet no dice nada sobre los datos.
  if (esFalloDeRed(texto)) return 'red';

  // 2. Conflicto de stock: NO se descarta. La venta y la evaluacion clinica van
  //    en la misma transaccion en el servidor, asi que descartar aqui tiraria
  //    tambien el examen del paciente. Se deja esperando a que se resuelva.
  if (CONFLICTO_STOCK.some(marca => texto.includes(marca))) return 'conflict';

  // 3. Archivar una consulta que nunca llego al servidor: no hay nada que
  //    archivar. Es el unico caso de "no existe" que si se puede descartar.
  if (tipo === 'ARCHIVAR_CONSULTA' && /no existe/i.test(texto)) return 'descartada';

  // 4. Datos invalidos de verdad: descartar es lo correcto.
  if (RECHAZO_PERMANENTE.some(marca => texto.includes(marca))) return 'descartada';

  // 5. Agotamos los reintentos.
  if (intentos >= maxIntentos) return 'descartada';

  return 'reintentable';
};

/**
 * El mensaje que ve el usuario. Un conflicto de stock tiene que explicar QUE
 * hacer, porque si solo dice "error" el optometrista no sabe que la operacion
 * sigue guardada y como resolverlo.
 */
export const mensajeDeFallo = (motivo, clasificacion) => {
  const base = String(motivo || '').trim() || 'La operación fue rechazada por el servidor.';
  if (clasificacion === 'conflict') {
    return `${base}. No se perdió nada: la venta y la evaluación clínica siguen guardadas `
      + 'esperando. Cambia el armazón o el producto en conflicto y vuelve a guardar.';
  }
  if (clasificacion === 'descartada') {
    return `${base} (no se reintenta: el dato es inválido o no existe en el servidor)`;
  }
  return base;
};
// ---------------------------------------------------------------------------
// AVISOS DE LA APLICACION
// ---------------------------------------------------------------------------
// Un unico sitio para mostrar mensajes, en vez de `alert()` del navegador.
//
// Por que: alert() y window.confirm() son ventanas del sistema operativo. No
// tienen el estilo de la app, no se pueden leer bien con lector de pantalla, no
// se traducen, y el confirm() ADEMAS bloquea la pagina y corta el flujo: si el
// usuario pulsa "Actualizar" con una venta a medio llenar, la pantalla se congela
// hasta que conteste. Todo eso ya lo hacia mejor el sistema de avisos.
//
// Modulo puro de datos (sin React) a proposito: lo usan utilidades que no
// pueden importar React, como el boton del comprobante o las descargas.
let actual = null;
let temporizador = null;
const suscriptores = new Set();

const notificar = valor => {
  for (const fn of suscriptores) {
    // Un suscriptor roto no puede impedir que los demas vean el aviso.
    try { fn(valor); } catch { /* silencioso */ }
  }
};

/** Muestra un aviso. `duracion` en ms; 0 lo deja fijo hasta que se cierre. */
export const mostrarAviso = (mensaje, tipo = 'success', duracion = 3500) => {
  if (mensaje === null || mensaje === undefined || mensaje === '') return null;
  if (temporizador) { clearTimeout(temporizador); temporizador = null; }
  actual = { mensaje: String(mensaje), tipo: tipo || 'success' };
  notificar(actual);
  if (duracion > 0) {
    temporizador = setTimeout(() => { actual = null; temporizador = null; notificar(null); }, duracion);
    // En Node los timers mantienen vivo el proceso: un aviso de 3 s hacia que
    // `node --test` tardase 3 s en terminar.
    if (typeof temporizador?.unref === 'function') temporizador.unref();
  }
  return actual;
};

export const cerrarAviso = () => {
  if (temporizador) { clearTimeout(temporizador); temporizador = null; }
  actual = null;
  notificar(null);
  return null;
};

export const leerAviso = () => actual;

/**
 * Se suscribe a los cambios. Devuelve la función para cancelar la suscripcion.
 * Al suscribirse se entrega el aviso actual, para que la vista no se quede sin
 * pintar lo que ya estaba en pantalla.
 */
export const suscribirAvisos = fn => {
  if (typeof fn !== 'function') return () => {};
  suscriptores.add(fn);
  // El aviso actual se entrega al suscribirse, para que la vista no se quede sin
  // pintar lo que ya estaba en pantalla. Y va protegido: un suscriptor roto no
  // puede impedir ni que se suscriban los demas ni que reciban el aviso.
  try { fn(actual); } catch { /* silencioso */ }
  return () => { suscriptores.delete(fn); };
};

/** Atajo para el error mas comun: algo fallo y hay que decirlo. */
export const avisarError = (mensaje, detalle) =>
  mostrarAviso(detalle ? `${mensaje}: ${detalle}` : mensaje, 'error');

/** Atajo para avisar de algo que el usuario debe corregir. */
export const avisarAviso = (mensaje, duracion = 6000) => mostrarAviso(mensaje, 'warning', duracion);
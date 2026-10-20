// ---------------------------------------------------------------------------
// RECARGAR LA PAGINA DESDE EL LOGO
// ---------------------------------------------------------------------------
// El clic en "VER+ OPTICA" hace lo mismo que Ctrl+Shift+R, con dos cuidados:
//
//   1. La app NO guarda borradores en el disco: lo que se esta escribiendo vive
//      solo en memoria. Al recargar se pierde. Por eso, si hay un formulario con
//      datos, primero se pregunta.
//   2. Al ser una PWA, una recarga normal puede volver a abrir la copia que el
//      service worker tiene guardada. Antes de recargar se busca si hay una
//      version nueva y se activa, para que el clic muestre de verdad la ultima.
// ---------------------------------------------------------------------------
import { INV_INICIAL } from './fichaClinica.js';

// Claves que la app rellena sola al abrir una ficha guardada. No cuentan como
// "algo escrito por el usuario". La fecha se cambia al guardar (se le añade la
// hora), así que tampoco distingue una ficha editada de una recién abierta.
const CLAVES_INTERNAS = ['id', 'paciente_id', 'pedido_id', 'fecha'];

const aTexto = valor => (valor === null || valor === undefined ? '' : String(valor).trim());

/** ¿Hay algún dato distinto al estado inicial del formulario? */
export const hayDatosEscritos = (actual, inicial = {}) => {
  if (!actual || typeof actual !== 'object') return false;
  const base = inicial && typeof inicial === 'object' ? inicial : {};
  return Object.keys(actual).some(
    clave => !CLAVES_INTERNAS.includes(clave) && aTexto(actual[clave]) !== aTexto(base[clave])
  );
};

/**
 * ¿Se perdería algo si se recarga ahora mismo?
 * Mira la vista actual. El borrador minimizado lo comprueba App por su cuenta.
 */
export const tieneTrabajoSinGuardar = ({
  vistaActual = '',
  pedidoSeleccionado = null,
  paciente = null,
  estadoInicial = null,
  nuevoItemInv = null,
  editandoInvId = null,
  nuevoPrecio = null,
  precioInicial = null,
  editandoPrecioId = null
} = {}) => {
  switch (vistaActual) {
    // La orden de trabajo se abre siempre con paciente, precios o medidas
    // cargados: mientras esté abierta se considera trabajo en curso.
    case 'pedidos_form':
      return Boolean(pedidoSeleccionado);
    case 'nueva_medicion':
      return hayDatosEscritos(paciente, estadoInicial);
    case 'inventario':
      return Boolean(editandoInvId) || hayDatosEscritos(nuevoItemInv, INV_INICIAL);
    case 'precios':
      return Boolean(editandoPrecioId) || hayDatosEscritos(nuevoPrecio, precioInicial);
    default:
      return false;
  }
};

/** Espera a que el navegador termine de instalar una version nueva (o se agota). */
const esperarVersionInstalada = (registro, limiteMs) => new Promise(resolver => {
  const instalando = registro?.installing;
  if (!instalando) {
    resolver(Boolean(registro?.waiting));
    return;
  }
  const fin = setTimeout(() => resolver(Boolean(registro?.waiting)), limiteMs);
  instalando.addEventListener('statechange', () => {
    if (instalando.state === 'installed') {
      clearTimeout(fin);
      resolver(true);
    }
  });
});

/**
 * Pide al navegador que busque una version nueva y espera a tenerla lista.
 * @returns {Promise<boolean>} true si hay que recargar para estrenarla.
 */
export const prepararVersionNueva = async (registro, limiteMs = 4000) => {
  if (!registro) return false;
  if (registro.waiting) return true;
  try {
    await registro.update();
  } catch {
    /* Sin red: se recarga con lo que ya hay guardado */
  }
  if (registro.waiting) return true;
  return esperarVersionInstalada(registro, limiteMs);
};

/** Le dice al worker en espera que tome el control ya. No recarga por sí solo. */
export const activarVersionEnEspera = registro => {
  try {
    registro?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  } catch {
    /* Sin service worker no hay nada que activar */
  }
};

/**
 * Flujo completo del clic en el logo: preguntar si hay trabajo sin guardar,
 * buscar la versión más reciente y recargar.
 * @returns {Promise<'cancelado'|'recargado'|'actualizando'>}
 */
export const actualizarPagina = async ({
  trabajoSinGuardar = false,
  confirmar,
  obtenerServiceWorker = () => globalThis.navigator?.serviceWorker,
  recargar = () => globalThis.window?.location?.reload(),
  programar = (fn, ms) => setTimeout(fn, ms),
  marcarSalidaPermitida = () => {},
  limiteMs = 4000,
  esperaActivacionMs = 1500
} = {}) => {
  if (trabajoSinGuardar) {
    const ok = typeof confirmar === 'function'
      ? await confirmar(
        'Se recargará la página y se perderá lo que estás escribiendo. Si quieres conservarlo, cancela y guarda primero.',
        'Sí, actualizar'
      )
      : false;
    if (!ok) return 'cancelado';
  }

  // A partir de aquí el usuario ya decidió: que el navegador no vuelva a
  // preguntar con su propio aviso al recargar.
  marcarSalidaPermitida();

  let registro = null;
  try {
    registro = await obtenerServiceWorker()?.getRegistration?.();
  } catch {
    /* sin service worker se recarga normal */
  }

  const versionNueva = await prepararVersionNueva(registro, limiteMs);
  if (versionNueva) {
    activarVersionEnEspera(registro);
    programar(recargar, esperaActivacionMs);
    return 'actualizando';
  }

  recargar();
  return 'recargado';
};

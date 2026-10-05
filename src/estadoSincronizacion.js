// ---------------------------------------------------------------------------
// ESTADO DE SINCRONIZACION DE UN REGISTRO, VISTO POR EL USUARIO
// ---------------------------------------------------------------------------
// Una venta guardada sin internet, o que el servidor rechazo, sigue visible en
// la lista como si estuviera en la nube. El usuario no tenia forma de saberlo:
// antes solo se enteraba si miraba la barra de sincronizacion, y esa barra dice
// "cuantas operaciones hay", no "cuales de estas ventas son las mias".
//
// Aqui se responde a esa pregunta: QUE registros de esta pantalla estan unicamente
// en este equipo. Se usa en PedidosLista y en Historial para poner una etiqueta
// visible. Modulo puro, sin React ni Supabase, para poder probarlo con node --test.
// ---------------------------------------------------------------------------

const ESTADO = {
  PENDIENTE: 'pendiente',
  DESCARTADA: 'descartada'
};

const safe = valor => (valor === null || valor === undefined ? '' : String(valor).trim());

/** Un registro es local si su syncStatus existe y no es 'synced'. */
export const esSoloLocal = registro =>
  safe(registro?.syncStatus) !== '' && safe(registro?.syncStatus) !== 'synced';

/**
 * Clasifica una venta para poder mostrarla al usuario.
 * - pendiente : guardada aqui, todavia no confirmada por el servidor.
 * - descartada: el servidor la rechazo y ya no se reintentara sola.
 * - sincronizada: el servidor la confirmo.
 */
export const estadoDeSincronizacion = registro => {
  if (esSoloLocal(registro)) {
    return {
      estado: ESTADO.PENDIENTE,
      texto: 'Solo en este equipo',
      detalle: 'Guardada aquí, todavía no está en la nube. Se subirá sola.',
      clases: 'bg-amber-100 text-amber-900 border-amber-300',
      icono: '⏳'
    };
  }
  return {
    estado: 'sincronizada',
    texto: '',
    detalle: '',
    clases: '',
    icono: ''
  };
};

/**
 * Cuenta cuantas ventas de la lista siguen unicamente en este equipo.
 * Se usa para un aviso general arriba de la lista, que es lo que de verdad
 * evita que alguien cierre el equipo creyendo que todo esta respaldado.
 */
export const contarSoloLocales = registros => {
  if (!Array.isArray(registros)) return { total: 0 };
  let pendiente = 0;
  for (const registro of registros) {
    if (esSoloLocal(registro)) pendiente += 1;
  }
  return { total: pendiente };
};
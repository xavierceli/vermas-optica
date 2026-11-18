// ---------------------------------------------------------------------------
// TIEMPO REAL (SUPABASE REALTIME)
// ---------------------------------------------------------------------------
// Problema que resuelve: sin esto, un equipo veia los cambios de otro con hasta
// 30 segundos de retraso (el intervalo del motor de sync). En el mostrador eso
// significa vender una montura que el companero ya vendio.
//
// Como funciona:
//   1. Se escuchan los cambios (INSERT/UPDATE) de las tablas que importan.
//   2. Los eventos se agrupan ~350 ms: una venta genera varios (pedido, pago,
//      consulta) y no tiene sentido hacer tres descargas.
//   3. Cada evento se aplica a IndexedDB con las mismas reglas que la
//      sincronizacion normal (nunca pisa trabajo local pendiente, nunca
//      retrocede de version). No se descarga el historial completo.
//   4. Se avisa a React para que relea el snapshot local y repinte.
//
// Esto es un ADELANTO, no un reemplazo: el sondeo de 30 s sigue activo como
// respaldo. Sin internet, Realtime no recibe nada y la app funciona igual.
// ---------------------------------------------------------------------------
import { supabase } from './supabaseClient.js';
import { cacheServerCatalog, aplicarFilaHistorialRemota } from './localRepository.js';
import { cargarFilaHistorial } from './repositorio/vistaHistorial.js';

const TABLAS = [
  'inventario',
  'lista_precios',
  'consultas_clinicas',
  'pedidos_ventas',
  'pagos'
];

// Agrupa rafagas de eventos (una venta emite varios) en una sola aplicacion.
const ESPERA_AGRUPADO_MS = 350;
// Tope por descarga suelta: si la red se cae a mitad, el lote no se queda colgado.
const TIEMPO_LIMITE_MS = 10000;

let canal = null;
let iniciado = false;
let alCambiar = null;
let pendientes = new Map();
let temporizador = null;
let estadoCanal = 'apagado';
// Cada arranque usa un topic distinto. En desarrollo (StrictMode) el efecto se
// monta, se limpia y se vuelve a montar: el cierre del canal anterior es
// asincrono y reutilizar el mismo topic provocaria un "already subscribed".
let generacion = 0;

const conTimeout = (promesa, ms, etiqueta) => {
  let timerId;
  const limite = new Promise((_, rechazar) => {
    timerId = setTimeout(
      () => rechazar(new Error(`Tiempo agotado (${ms / 1000}s) en ${etiqueta}`)),
      ms
    );
  });
  return Promise.race([promesa, limite]).finally(() => {
    if (timerId) clearTimeout(timerId);
  });
};

/** Clave de agrupacion: dos eventos de la misma entidad se pisan sin problema. */
const claveDeEvento = (tabla, fila) => {
  if (tabla === 'inventario') return `inv:${fila?.id}`;
  if (tabla === 'lista_precios') return `precio:${fila?.id}`;
  if (tabla === 'consultas_clinicas') return `consulta:${fila?.id}`;
  if (tabla === 'pedidos_ventas') return `venta:${fila?.id}`;
  if (tabla === 'pagos') return `pago:${fila?.id ?? fila?.pedido_id}`;
  return `${tabla}:${fila?.id}`;
};

const encolar = evento => {
  const tabla = evento?.table;
  const fila = evento?.new || {};

  // Los DELETE no traen `new`. No se inventan borrados locales: el sondeo de
  // 30 s los reconcilia. Aqui solo interesa el estado nuevo.
  if (!TABLAS.includes(tabla) || evento?.eventType === 'DELETE' || !fila || Object.keys(fila).length === 0) {
    return;
  }

  if (tabla === 'pagos' && !fila.pedido_id) return;

  pendientes.set(claveDeEvento(tabla, fila), { tabla, fila });

  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => { void vaciar(); }, ESPERA_AGRUPADO_MS);
};

const aplicarEvento = async ({ tabla, fila }) => {
  if (tabla === 'inventario') {
    await cacheServerCatalog({ inventory: [fila] });
    return true;
  }

  if (tabla === 'lista_precios') {
    await cacheServerCatalog({ prices: [fila] });
    return true;
  }

  // consultas, ventas y pagos necesitan la fila de la vista: ahi vienen juntos
  // los datos del paciente, la consulta y la venta.
  const remota = await conTimeout(
    cargarFilaHistorial(
      tabla === 'consultas_clinicas'
        ? { id: fila.id }
        : { pedidoId: fila.id ?? fila.pedido_id }
    ),
    TIEMPO_LIMITE_MS,
    'cargar fila del historial'
  );

  if (!remota) return false;

  const resultado = await aplicarFilaHistorialRemota(remota);
  return Boolean(resultado?.aplicada);
};

const vaciar = async () => {
  temporizador = null;
  if (pendientes.size === 0) return;

  const lote = [...pendientes.values()];
  pendientes = new Map();

  let huboCambios = false;
  for (const cambio of lote) {
    try {
      // La aplicacion pasa por la cola de escritura: si esa cola se atasca,
      // Realtime no puede quedarse esperando para siempre.
      const aplicado = await conTimeout(
        aplicarEvento(cambio),
        TIEMPO_LIMITE_MS,
        `aplicar cambio de ${cambio.tabla}`
      );
      if (aplicado) huboCambios = true;
    } catch (error) {
      // Realtime es una mejora, no puede romper la app: si algo falla, el
      // sondeo de 30 s lo corrige en la siguiente pasada.
      console.warn(
        `[tiempo real] no se pudo aplicar el cambio de ${cambio.tabla}:`,
        error?.message || error
      );
    }
  }

  if (huboCambios && typeof alCambiar === 'function') {
    try {
      alCambiar();
    } catch (error) {
      console.warn('[tiempo real] el aviso a la interfaz fallo:', error?.message || error);
    }
  }
};

/**
 * Arranca el canal de tiempo real. Idempotente: llamarlo dos veces no crea dos
 * canales ni duplica eventos.
 *
 * @param {{alCambiar?: () => void}} opciones
 *   `alCambiar` se llama (una vez por lote) cuando ya se escribio algo nuevo en
 *   IndexedDB. La app lo usa para releer el snapshot local.
 */
export const iniciarTiempoReal = ({ alCambiar: notificar } = {}) => {
  if (iniciado || typeof window === 'undefined') return;

  iniciado = true;
  alCambiar = typeof notificar === 'function' ? notificar : null;
  pendientes = new Map();
  estadoCanal = 'conectando';

  const miGeneracion = ++generacion;
  canal = supabase.channel(`vermas-cambios-${miGeneracion}`);

  for (const tabla of TABLAS) {
    canal.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: tabla },
      evento => {
        // Un canal viejo (cerrandose) no debe seguir metiendo cambios.
        if (miGeneracion === generacion) encolar(evento);
      }
    );
  }

  canal.subscribe(estado => {
    if (miGeneracion !== generacion) return;
    estadoCanal = estado;
    if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') {
      // Supabase reintenta solo. Mientras tanto, el sondeo de 30 s sigue vivo.
      console.warn(
        `[tiempo real] canal en estado ${estado}; el sondeo de 30 s sigue activo.`
      );
    }
  });
};

/** Detiene el canal y descarta lo pendiente. Seguro si no estaba iniciado. */
export const detenerTiempoReal = async () => {
  iniciado = false;
  alCambiar = null;
  // Invalida callbacks de un canal que aun se esta cerrando.
  generacion += 1;

  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  pendientes = new Map();
  estadoCanal = 'apagado';

  const actual = canal;
  canal = null;
  if (!actual) return;

  try {
    await supabase.removeChannel(actual);
  } catch (error) {
    console.warn('[tiempo real] no se pudo cerrar el canal:', error?.message || error);
  }
};

/** Estado del canal para diagnostico: 'apagado' | 'conectando' | 'SUBSCRIBED'... */
export const estadoTiempoReal = () => estadoCanal;

/** Solo para pruebas: reinicia el estado del modulo. */
export const reiniciarTiempoRealParaPruebas = () => {
  iniciado = false;
  alCambiar = null;
  pendientes = new Map();
  temporizador = null;
  canal = null;
  estadoCanal = 'apagado';
  generacion += 1;
};

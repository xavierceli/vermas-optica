// ---------------------------------------------------------------------------
// OBSERVABILIDAD DE CONFLICTOS
// ---------------------------------------------------------------------------
// El panel ya decia CUANTOS conflictos habia, pero no de que tipo. Sin esa
// distincion no se puede saber si el problema es el versionado de las fichas
// clinicas (dos equipos editando al mismo tiempo) o el stock (dos ventas por la
// ultima unidad), que se resuelven de forma muy distinta.
//
// Este modulo es puro: clasifica un conflicto y resume los eventos registrados.
// No toca IndexedDB ni Supabase, para poder probarlo con node --test.
// ---------------------------------------------------------------------------

import { esConflictoDeStock, esConflictoDeVersion } from './clasificarFallo.js';

export const CATEGORIAS_CONFLICTO = {
  version_clinica: {
    etiqueta: 'Versión clínica',
    icono: '🧬',
    descripcion: 'Otro equipo guardó la misma ficha clínica antes.'
  },
  stock: {
    etiqueta: 'Stock',
    icono: '📦',
    descripcion: 'Otra venta se quedó con la última unidad.'
  },
  version_venta: {
    etiqueta: 'Versión de venta',
    icono: '🧾',
    descripcion: 'Otro equipo modificó el mismo pedido antes.'
  },
  otro: {
    etiqueta: 'Otros',
    icono: '❓',
    descripcion: 'Conflictos sin una causa reconocida.'
  }
};

const OPERACIONES_CLINICAS = new Set(['GUARDAR_CONSULTA', 'ARCHIVAR_CONSULTA']);
const OPERACIONES_DE_STOCK = new Set([
  'CREAR_VENTA', 'EDITAR_VENTA', 'UPSERT_INVENTARIO', 'ELIMINAR_INVENTARIO'
]);

const texto = valor => (valor === null || valor === undefined ? '' : String(valor));

/**
 * A que familia pertenece un conflicto.
 *
 * El motivo manda cuando lo hay (es el error real del servidor). Si el servidor
 * devolvio un "Conflicto de datos" sin detalle, se deduce por el tipo de
 * operacion: una ficha clinica solo puede chocar por version y una venta, por
 * stock.
 *
 * @param {string} motivo Texto del rechazo.
 * @param {string} [tipoOperacion] Tipo de la operacion del outbox.
 * @returns {'version_clinica'|'stock'|'version_venta'|'otro'}
 */
export const categoriaDeConflicto = (motivo, tipoOperacion = '') => {
  const detalle = texto(motivo);
  const tipo = texto(tipoOperacion);

  if (esConflictoDeStock(detalle)) return 'stock';

  if (esConflictoDeVersion(detalle)) {
    // Un conflicto de version al guardar una venta puede venir de la consulta
    // clinica que crear_venta guarda en la misma transaccion.
    const mencionaClinica = /cl[ií]nica|consulta|evaluaci[oó]n/i.test(detalle);
    return OPERACIONES_CLINICAS.has(tipo) || mencionaClinica ? 'version_clinica' : 'version_venta';
  }

  // El servidor no dio detalle. Se usa el tipo de operacion como pista.
  if (OPERACIONES_CLINICAS.has(tipo)) return 'version_clinica';
  if (OPERACIONES_DE_STOCK.has(tipo)) return 'stock';

  return 'otro';
};

/** Nombre legible del equipo a partir del user-agent del navegador. */
export const etiquetaDeNavegador = (userAgent = '') => {
  const ua = texto(userAgent);
  if (!ua) return 'Equipo sin identificar';

  const sistema = /Windows NT|Windows/i.test(ua) ? 'Windows'
    : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
      : /Android/i.test(ua) ? 'Android'
        : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
          : /CrOS/i.test(ua) ? 'ChromeOS'
            : /Linux/i.test(ua) ? 'Linux'
              : '';

  const navegador = /Edg\//i.test(ua) ? 'Edge'
    : /OPR\//i.test(ua) ? 'Opera'
      : /SamsungBrowser/i.test(ua) ? 'Samsung Internet'
        : /Firefox\//i.test(ua) ? 'Firefox'
          : /Chrome\//i.test(ua) ? 'Chrome'
            : /Safari\//i.test(ua) ? 'Safari'
              : '';

  if (navegador && sistema) return `${navegador} en ${sistema}`;
  if (navegador) return navegador;
  if (sistema) return sistema;
  return 'Equipo sin identificar';
};

const fechaDe = evento => {
  const valor = Date.parse(evento?.creadoEn);
  return Number.isFinite(valor) ? valor : 0;
};

const claveDeEquipo = evento =>
  texto(evento?.equipoId) || texto(evento?.equipo) || 'sin-equipo';

const vacio = () => ({
  total: 0,
  porCategoria: { version_clinica: 0, stock: 0, version_venta: 0, otro: 0 },
  porEquipo: [],
  recientes: [],
  ultimo: null
});

/**
 * Resumen de una lista de eventos de conflicto.
 *
 * Cada evento puede traer: categoria, tipoOperacion, motivo, equipoId, equipo,
 * usuario y creadoEn. Los datos raros no rompen el resumen: los eventos que ya
 * traen categoria se respetan y a los demas se les calcula desde el motivo.
 *
 * @param {Array<object>} eventos
 * @returns {{ total: number, porCategoria: object, porEquipo: Array, recientes: Array, ultimo: string|null }}
 */
export const resumirConflictos = eventos => {
  if (!Array.isArray(eventos) || eventos.length === 0) return vacio();

  const resumen = vacio();
  const equipos = new Map();
  const validos = eventos.filter(evento => evento && typeof evento === 'object');

  for (const evento of validos) {
    const categoria = CATEGORIAS_CONFLICTO[evento.categoria]
      ? evento.categoria
      : categoriaDeConflicto(evento.motivo, evento.tipoOperacion);

    resumen.total += 1;
    resumen.porCategoria[categoria] += 1;

    const equipoId = claveDeEquipo(evento);
    const equipo = equipos.get(equipoId) || {
      equipoId,
      equipo: texto(evento.equipo) || 'Equipo sin identificar',
      usuario: texto(evento.usuario) || null,
      total: 0,
      porCategoria: { version_clinica: 0, stock: 0, version_venta: 0, otro: 0 }
    };
    equipo.total += 1;
    equipo.porCategoria[categoria] += 1;
    if (texto(evento.usuario)) equipo.usuario = texto(evento.usuario);
    if (texto(evento.equipo)) equipo.equipo = texto(evento.equipo);
    equipos.set(equipoId, equipo);
  }

  resumen.porEquipo = [...equipos.values()].sort((a, b) => b.total - a.total);

  const ordenados = [...validos].sort((a, b) => fechaDe(b) - fechaDe(a));
  resumen.recientes = ordenados.slice(0, 5);
  resumen.ultimo = ordenados[0]?.creadoEn || null;

  return resumen;
};

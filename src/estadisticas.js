// ---------------------------------------------------------------------------
// ESTADISTICAS Y FILTRADOS DEL PANEL
// ---------------------------------------------------------------------------
// Todo lo que resume y filtra la pantalla de Pedidos/Stats. Son funciones PURAS:
// reciben las listas y el texto de busqueda y devuelven el resultado. No tocan
// el estado de React, asi que se prueban solas (ver estadisticas.test.js).
//
// No importan de './utilidades.js': ese archivo arrastra a Supabase (que necesita
// navegador) y con esto no se podria probar con `node --test`. Las utilidades son
// copias exactas y minimas.
// ---------------------------------------------------------------------------
import { calcularTotal, calcularSaldo } from './reglas.js';

const safeNum = valor => {
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : 0;
};

const safeString = valor => {
  if (valor === null || valor === undefined) return '';
  try {
    return String(valor);
  } catch {
    return '';
  }
};

/** El prefijo "AAAA-MM" con el que se decide si una venta es del mes actual. */
export const prefijoDelMesActual = (fecha = new Date()) => {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${anio}-${mes}`;
};

/**
 * Junta historial, ventas archivadas y ventas locales en UNA lista sin repetir.
 *
 * La pantalla de Pedidos mezcla las tres fuentes y una misma venta puede estar en
 * dos a la vez (el historial trae la consulta, la lista local trae la venta). Si
 * no se unificaran, cada venta se contaria dos veces: ingresos inflados.
 *
 * Se queda con la version que tenga el abono o el importe mas alto, que es la
 * version mas reciente.
 */
export const unificarPedidos = ({ historial = [], ventasArchivadas = [], ventasLocales = [] } = {}) => {
  const mapa = new Map();
  const fuentes = [...(historial || []), ...(ventasArchivadas || []), ...(ventasLocales || [])];

  fuentes.forEach((item, index) => {
    if (!item) return;
    const clave = safeString(item.pedido_id) || safeString(item.id) || `temp_${index}`;

    const v = safeNum(item.venta || item.total || item.precio_total);
    const ab = safeNum(item.abono);
    const tieneDatosVenta = Boolean(safeString(item.pedido_id).trim())
      || v > 0
      || ab > 0
      || safeString(item.codigo_armazon).trim() !== ''
      || safeString(item.accesorio_id).trim() !== '';

    if (!tieneDatosVenta) return;

    if (mapa.has(clave)) {
      const existente = mapa.get(clave);
      if (ab > safeNum(existente.abono) || v > safeNum(existente.venta)) {
        mapa.set(clave, { ...existente, ...item, venta: v || existente.venta, abono: ab || existente.abono });
      }
    } else {
      mapa.set(clave, { ...item, venta: v, abono: ab });
    }
  });

  return Array.from(mapa.values());
};

/** Filtra los pedidos por nombre o cedula. Sin termino devuelve todos. */
export const filtrarPedidos = (pedidos, busqueda = '') => {
  const q = safeString(busqueda).toLowerCase();
  return (pedidos || []).filter(item => {
    if (!item) return false;
    if (!q) return true;
    return safeString(item.nombre).toLowerCase().includes(q)
      || safeString(item.cedula).includes(q);
  });
};

/** Filtra el tarifario por tipo de lente, material o rango de medida. */
export const filtrarTarifario = (listaPrecios, busqueda = '') => {
  const q = safeString(busqueda).toLowerCase();
  return (listaPrecios || []).filter(item => {
    if (!item) return false;
    return safeString(item.tipo_lente).toLowerCase().includes(q)
      || safeString(item.material).toLowerCase().includes(q)
      || safeString(item.rango_medida).toLowerCase().includes(q);
  });
};

/**
 * Las cifras del panel: ingresos, costos, utilidad y saldo pendiente.
 * Las ventas ANULADAS no cuentan para nada: no son ingresos.
 */
export const calcularEstadisticas = ({ pedidos = [], historial = [], mesActual = '' } = {}) => {
  try {
    let ventasMes = 0;
    let gastosMes = 0;
    let ventasTotal = 0;
    let gastosTotal = 0;
    let abonosPendientes = 0;
    const cedulasUnicas = new Set();

    (pedidos || []).forEach(p => {
      if (!p) return;
      const estado = safeString(p.estado).trim().toLowerCase();
      if (estado === 'anulado') return;

      const vFinal = calcularTotal(p.venta || p.total || 0, p.descuento || 0);
      const abonoReal = safeNum(p.abono);
      const saldo = calcularSaldo(p.venta || p.total || 0, p.descuento || 0, abonoReal);

      if (saldo > 0) {
        abonosPendientes += saldo;
      }

      const gastoFila = safeNum(p.costo_lunas_int) +
                        safeNum(p.costo_armazon_int) +
                        safeNum(p.costo_accesorio_int) +
                        safeNum(p.costo_tratamientos_int) +
                        safeNum(p.costo_varios_int);

      ventasTotal += vFinal;
      gastosTotal += gastoFila;

      const fechaRegistro = safeString(p.fecha_venta || p.fecha || p.created_at || '').slice(0, 7);
      if (fechaRegistro === mesActual) {
        ventasMes += vFinal;
        gastosMes += gastoFila;
      }

      const cedula = safeString(p.cedula).trim().toUpperCase();
      if (cedula && cedula !== '9999999999' && safeString(p.nombre).trim().toUpperCase() !== 'CONSUMIDOR FINAL') {
        cedulasUnicas.add(cedula);
      }
    });

    (historial || []).forEach(h => {
      const c = safeString(h?.cedula).trim().toUpperCase();
      if (c && c !== '9999999999' && safeString(h?.nombre).trim().toUpperCase() !== 'CONSUMIDOR FINAL') {
        cedulasUnicas.add(c);
      }
    });

    return {
      ventasMes: Number(ventasMes.toFixed(2)),
      gastosMes: Number(gastosMes.toFixed(2)),
      utilidadNeta: Number((ventasMes - gastosMes).toFixed(2)),
      ventasTotal: Number(ventasTotal.toFixed(2)),
      gastosTotal: Number(gastosTotal.toFixed(2)),
      utilidadTotal: Number((ventasTotal - gastosTotal).toFixed(2)),
      abonosPendientes: Number(abonosPendientes.toFixed(2)),
      totalPacientes: cedulasUnicas.size,
      total: (historial || []).length
    };
  } catch (err) {
    console.error('[estadisticas] Error calculando estadisticas:', err);
    return {
      ventasMes: 0, gastosMes: 0, utilidadNeta: 0,
      ventasTotal: 0, gastosTotal: 0, utilidadTotal: 0,
      abonosPendientes: 0, totalPacientes: 0, total: 0
    };
  }
};
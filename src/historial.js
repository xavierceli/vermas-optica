// ---------------------------------------------------------------------------
// DECISIONES DE LA PANTALLA DE HISTORIAL
// ---------------------------------------------------------------------------
// Módulo puro, sin React ni Supabase, para poder probarlo con node --test.
// Centraliza las reglas de negocio:
//   · Detección estricta de ventas reales vs consultas clínicas solas.
//   · Cálculo exacto de saldos pendientes sin depender de cachés desactualizadas.
//   · Fusión inteligente de última RX clínica con última transacción comercial.
//   · Generación estandarizada de diagnósticos CIE-10.
// ---------------------------------------------------------------------------
import { calcularSaldo, calcularTotal } from './reglas.js';

export const NOMBRE_CONSUMIDOR_FINAL = 'CONSUMIDOR FINAL';

const aTexto = valor => (valor === null || valor === undefined ? '' : String(valor));
const aNumero = valor => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Todo lo que una tarjeta del historial necesita decidir de una consulta.
 * @returns {{venta:number, descuento:number, abono:number, total:number,
 *            saldo:number, tieneDeuda:boolean, tienePedido:boolean}}
 */
export const resumenConsulta = (item) => {
  const venta = aNumero(item?.venta);
  const descuento = aNumero(item?.descuento);
  const abono = aNumero(item?.abono);
  const saldo = calcularSaldo(venta, descuento, abono);

  // Solo hay pedido si existe una venta real asociada o trabajo de óptica
  const tienePedido = Boolean(aTexto(item?.pedido_id).trim())
    || aNumero(item?.venta) > 0
    || aTexto(item?.codigo_armazon).trim() !== ''
    || aTexto(item?.tipo_lente).trim() !== ''
    || aTexto(item?.material_lente).trim() !== ''
    || aTexto(item?.accesorio_id).trim() !== '';

  return {
    venta, 
    descuento, 
    abono,
    total: calcularTotal(venta, descuento),
    saldo,
    tieneDeuda: saldo > 0,
    tienePedido
  };
};

/**
 * Campos clínicos y de refracción completos para conservar en la fusión del historial.
 */
const CAMPOS_REFRACCION = [
  'esfera_od', 'esfera_oi', 'cilindro_od', 'cilindro_oi',
  'eje_od', 'eje_oi', 'adicion_od', 'adicion_oi',
  'dnp_od', 'dnp_oi', 'altura_od', 'altura_oi',
  'avsl_od', 'avsc_od', 'avcl_od', 'avcc_od',
  'avsl_oi', 'avsc_oi', 'avcl_oi', 'avcc_oi'
];

/** ¿Esta consulta tiene refracción, o es una visita sin receta? */
export const tieneRefraccion = (item) =>
  ['esfera_od', 'esfera_oi', 'cilindro_od', 'cilindro_oi', 'adicion_od', 'adicion_oi']
    .some(campo => aTexto(item?.[campo]).trim() !== '');

/**
 * Una sola tarjeta por paciente, de una lista ordenada por fecha descendente.
 * - Lo comercial (pedido, armazón, abono, saldo) proviene de la visita más reciente.
 * - La receta clínica completa proviene de la visita más reciente que tenga refracción.
 */
export const unaTarjetaPorCedula = (filas, claveDe) => {
  const clave = claveDe || (fila => {
    const cedula = aTexto(fila?.cedula).trim().toUpperCase();
    if (cedula) return cedula;
    const patientId = aTexto(fila?.patientId || fila?.patient_id || fila?.paciente_id).trim();
    if (patientId) return `pid:${patientId}`;
    return `id:${fila?.id}`;
  });

  const elegidas = new Map();
  for (const fila of filas || []) {
    if (!fila) continue;
    const k = clave(fila);
    const actual = elegidas.get(k);

    if (!actual) {
      elegidas.set(k, tieneRefraccion(fila) ? { ...fila, fecha_receta: fila.fecha } : { ...fila });
      continue;
    }

    if (!tieneRefraccion(actual) && tieneRefraccion(fila)) {
      const receta = {};
      for (const campo of CAMPOS_REFRACCION) {
        if (fila[campo] !== undefined && fila[campo] !== null) {
          receta[campo] = fila[campo];
        }
      }
      elegidas.set(k, {
        ...fila,
        ...actual,
        ...receta,
        fecha_receta: aTexto(fila.fecha).trim() || actual.fecha_receta || actual.fecha
      });
    } else if (!actual.fecha_receta && tieneRefraccion(actual)) {
      elegidas.set(k, {
        ...actual,
        fecha_receta: actual.fecha
      });
    }
  }

  return [...elegidas.values()];
};

/**
 * Una sola tarjeta por paciente, excluyendo el CONSUMIDOR FINAL.
 */
export const agruparPorCedula = (filas) =>
  unaTarjetaPorCedula(
    (filas || []).filter(item => item && aTexto(item.nombre).trim().toUpperCase() !== NOMBRE_CONSUMIDOR_FINAL)
  );

/** Filtro del buscador sobre el historial local (mínimo 2 caracteres). */
export const filtrarPorTermino = (filas, termino) => {
  const busqueda = aTexto(termino).trim().toLowerCase();
  if (busqueda.length < 2) return [];
  return (filas || []).filter(item =>
    aTexto(item?.nombre).toLowerCase().includes(busqueda)
    || aTexto(item?.cedula).toLowerCase().includes(busqueda)
    || aTexto(item?.alias).toLowerCase().includes(busqueda)
  );
};

/**
 * Determina qué lista mostrar según la búsqueda activa.
 */
export const listaSegunBusqueda = ({ busquedaTexto = '', resultados = null, historial = [] } = {}) => {
  const terminoActual = aTexto(busquedaTexto).trim();
  const hayTermino = terminoActual.length >= 2;
  const listaBruta = hayTermino
    ? (resultados?.termino === terminoActual ? (resultados.datos || []) : [])
    : (historial || []);
  return { hayTermino, lista: agruparPorCedula(listaBruta) };
};

/**
 * Diagnóstico automático a partir de la refracción final con codificación CIE-10.
 */
export const generarDiagnosticos = (item) => {
  try {
    const diagnosticos = [];
    const esfOd = aNumero(item?.esfera_od);
    const cilOd = aNumero(item?.cilindro_od);
    const addOd = aNumero(item?.adicion_od);
    const esfOi = aNumero(item?.esfera_oi);
    const cilOi = aNumero(item?.cilindro_oi);
    const addOi = aNumero(item?.adicion_oi);

    if (esfOd < 0 || esfOi < 0) diagnosticos.push('Miopía (H52.1)');
    if (esfOd > 0 || esfOi > 0) diagnosticos.push('Hipermetropía (H52.0)');
    if (cilOd !== 0 || cilOi !== 0) diagnosticos.push('Astigmatismo (H52.2)');
    if (addOd > 0 || addOi > 0) diagnosticos.push('Presbicia (H52.4)');
    return [...new Set(diagnosticos)];
  } catch {
    return [];
  }
};
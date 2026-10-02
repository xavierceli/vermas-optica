import { calcularSaldo, calcularTotal } from './reglas.js';

export const NOMBRE_CONSUMIDOR_FINAL = 'CONSUMIDOR FINAL';

const aTexto = valor => (valor === null || valor === undefined ? '' : String(valor));
const aNumero = valor => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Todo lo que una tarjeta del historial necesita decidir de una consulta.
 */
export const resumenConsulta = (item) => {
  const venta = aNumero(item?.venta);
  const descuento = aNumero(item?.descuento);
  const abono = aNumero(item?.abono);
  const saldo = calcularSaldo(venta, descuento, abono);

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

const CAMPOS_REFRACCION = [
  'esfera_od', 'esfera_oi', 'cilindro_od', 'cilindro_oi',
  'eje_od', 'eje_oi', 'adicion_od', 'adicion_oi',
  'dnp_od', 'dnp_oi', 'altura_od', 'altura_oi',
  'avsl_od', 'avsc_od', 'avcl_od', 'avcc_od',
  'avsl_oi', 'avsc_oi', 'avcl_oi', 'avcc_oi'
];

export const tieneRefraccion = (item) =>
  ['esfera_od', 'esfera_oi', 'cilindro_od', 'cilindro_oi', 'adicion_od', 'adicion_oi']
    .some(campo => aTexto(item?.[campo]).trim() !== '');

/**
 * Agrupa la lista completa para la pantalla principal (1 tarjeta por paciente mostrando la visita más reciente)
 * sin destruir ni mezclar los registros en el expediente histórico.
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
  // Se asume que las filas vienen ordenadas por fecha/hora descendente
  for (const fila of filas || []) {
    if (!fila) continue;
    const k = clave(fila);
    const actual = elegidas.get(k);

    if (!actual) {
      elegidas.set(k, { ...fila, fecha_receta: fila.fecha });
      continue;
    }

    // Si la visita más reciente no tiene refracción pero una anterior sí, tomamos la graduación
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
        fecha_receta: aTexto(fila.fecha).trim() || actual.fecha
      });
    }
  }

  return [...elegidas.values()];
};

export const agruparPorCedula = (filas) =>
  unaTarjetaPorCedula(
    (filas || []).filter(item => item && aTexto(item.nombre).trim().toUpperCase() !== NOMBRE_CONSUMIDOR_FINAL)
  );

export const filtrarPorTermino = (filas, termino) => {
  const busqueda = aTexto(termino).trim().toLowerCase();
  if (busqueda.length < 2) return [];
  return (filas || []).filter(item =>
    aTexto(item?.nombre).toLowerCase().includes(busqueda)
    || aTexto(item?.cedula).toLowerCase().includes(busqueda)
    || aTexto(item?.alias).toLowerCase().includes(busqueda)
  );
};

export const listaSegunBusqueda = ({ busquedaTexto = '', resultados = null, historial = [] } = {}) => {
  const terminoActual = aTexto(busquedaTexto).trim();
  const hayTermino = terminoActual.length >= 2;
  const listaBruta = hayTermino
    ? (resultados?.termino === terminoActual ? (resultados.datos || []) : [])
    : (historial || []);
  return { hayTermino, lista: agruparPorCedula(listaBruta) };
};

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
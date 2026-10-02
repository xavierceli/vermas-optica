import { calcularSaldo, calcularTotal } from './reglas.js';

export const NOMBRE_CONSUMIDOR_FINAL = 'CONSUMIDOR FINAL';

const aTexto = valor => {
  if (valor === null || valor === undefined) return '';
  try {
    return String(valor);
  } catch {
    return '';
  }
};
const aNumero = valor => {
  try {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};

/**
 * Todo lo que una tarjeta del historial necesita decidir de una consulta.
 */
export const resumenConsulta = (item) => {
  const estado = aTexto(item?.estado).trim().toLowerCase();
  const esAnulada = estado === 'anulado';

  const venta = aNumero(item?.venta);
  const descuento = aNumero(item?.descuento);
  const abono = aNumero(item?.abono);

  // Si la venta está Anulada, el total comercial y el saldo por cobrar son estrictamente 0
  const total = esAnulada ? 0 : calcularTotal(venta, descuento);
  const saldo = esAnulada ? 0 : calcularSaldo(venta, descuento, abono);

  const tienePedido = Boolean(aTexto(item?.pedido_id).trim())
    || aNumero(item?.venta) > 0
    || aTexto(item?.codigo_armazon).trim() !== ''
    || aTexto(item?.tipo_lente).trim() !== ''
    || aTexto(item?.material_lente).trim() !== ''
    || aTexto(item?.accesorio_id).trim() !== '';

  return {
    venta: esAnulada ? 0 : venta, 
    descuento: esAnulada ? 0 : descuento, 
    abono: esAnulada ? 0 : abono,
    total,
    saldo,
    tieneDeuda: !esAnulada && saldo > 0,
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
 * Agrupa la lista para la pantalla principal (1 tarjeta por paciente mostrando la visita más reciente)
 * sin mezclar ni sobrescribir las consultas en el expediente histórico.
 */
export const unaTarjetaPorCedula = (filas, claveDe) => {
  const clave = claveDe || (fila => {
    const cedula = aTexto(fila?.cedula).trim().toUpperCase();
    if (cedula) return cedula;
    const patientId = aTexto(fila?.patientId || fila?.patient_id || fila?.paciente_id).trim();
    if (patientId) return `pid:${patientId}`;
    return `id:${aTexto(fila?.id)}`;
  });

  const elegidas = new Map();
  for (const fila of filas || []) {
    if (!fila) continue;
    const k = clave(fila);
    const actual = elegidas.get(k);

    if (!actual) {
      elegidas.set(k, { ...fila, fecha_receta: fila.fecha });
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

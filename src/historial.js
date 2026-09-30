// ---------------------------------------------------------------------------
// DECISIONES DE LA PANTALLA DE HISTORIAL
// ---------------------------------------------------------------------------
// Modulo puro, sin React ni Supabase, para poder probarlo con node --test.
//
// Estas reglas estaban metidas dentro del .map() de Historial.jsx, en 488 lineas
// de JSX: nadie podia probarlas y cualquier cambio era a ciegas. Y son reglas de
// NEGOCIO, no de pintura:
//
//   · si una consulta tiene pedido o no (una consulta clinica sin venta salia
//     sola en Pedidos con monto $0 porque el servidor le pone 'En laboratorio');
//   · cuanto debe el paciente (y que una venta anulada no debe nada);
//   · como se agrupan las consultas en una sola tarjeta por paciente;
//   · que diagnostico se imprime segun los valores de refraccion.
//
// La ultima es un dato clinico: un umbral mal puesto escribe un diagnostico
// equivocado en la receta que ve el paciente.
import { calcularSaldo, calcularTotal } from './reglas.js';

export const NOMBRE_CONSUMIDOR_FINAL = 'CONSUMIDOR FINAL';

// utilidades.js importa supabaseClient y no se puede cargar en node --test, asi
// que estos dos ayudantes se repiten aqui a proposito (mismo criterio que
// fichaClinica.js con aTexto).
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
  // El saldo se calcula SIEMPRE con los datos de la venta. Antes se preferia
  // `deuda_total` (cache del servidor) y, al anular o borrar una venta, ese valor
  // se quedaba pegado: el historial seguia mostrando "SALDO PENDIENTE" de algo
  // ya cobrado o eliminado.
  const saldo = calcularSaldo(venta, descuento, abono);

  // Solo hay pedido si existe una venta de verdad. Sin esta comprobacion, una
  // consulta clinica sin venta aparecia como pedido porque el servidor le
  // asigna el estado 'En laboratorio' por defecto.
  const tienePedido = Boolean(aTexto(item?.pedido_id).trim())
    || aNumero(item?.venta) > 0
    || aTexto(item?.codigo_armazon).trim() !== ''
    || aTexto(item?.accesorio_id).trim() !== '';

  return {
    venta, descuento, abono,
    total: calcularTotal(venta, descuento),
    saldo,
    tieneDeuda: saldo > 0,
    tienePedido
  };
};

/**
 * Campos de refraccion final. Si uno solo tiene valor, la consulta es una Rx.
 */
const CAMPOS_REFRACCION = [
  'esfera_od', 'esfera_oi', 'cilindro_od', 'cilindro_oi',
  'eje_od', 'eje_oi', 'adicion_od', 'adicion_oi'
];

/** ¿Esta consulta tiene refraccion, o es una visita sin receta? */
export const tieneRefraccion = (item) =>
  CAMPOS_REFRACCION.some(campo => aTexto(item?.[campo]).trim() !== '');

/**
 * Una sola tarjeta por paciente, de una lista ORDENADA por fecha descendente.
 *
 * La tarjeta mezcla DOS datos de visitas distintas, y esta es la parte que
 * costaba dos bugs seguidos:
 *
 *   · Lo COMERCIAL (pedido, armazon, pago) va de la visita mas reciente: es lo
 *     que se acaba de hacer y lo que el optometria tiene que ver.
 *   · La RECETA (esfera, cilindro, eje, adicion) va de la visita mas reciente
 *     QUE TENGA refraccion, y se indica su fecha.
 *
 * Antes ganaba una sola visita, la mas reciente, y si era un control sin receta
 * la tabla salia con guiones aunque el paciente tuviera receta en otra visita
 * (el boton "Ver Evolucion" si la ensenaba). Elegir la visita CON refraccion
 * tampoco resolvia el caso offline, en el que las filas locales llegan sin
 * datos de consulta: al fusionar, la receta de otra visita rellena los huecos.
 *
 * Si ninguna visita tiene refraccion, se queda con la mas reciente y la tabla
 * sale con guiones: es mejor eso que una tarjeta anclada en una consulta vieja.
 */
export const unaTarjetaPorCedula = (filas, claveDe) => {
  const clave = claveDe || (fila => aTexto(fila?.cedula).trim() || `id:${fila?.id}`);
  const elegidas = new Map();
  for (const fila of filas || []) {
    if (!fila) continue;
    const k = clave(fila);
    const actual = elegidas.get(k);
    if (!actual) {
      // Primera vez que se ve a este paciente: es la visita MAS RECIENTE (la
      // lista llega ordenada), asi que si trae receta, esa es su ultima receta.
      elegidas.set(k, tieneRefraccion(fila) ? { ...fila, fecha_receta: fila.fecha } : { ...fila });
      continue;
    }
    // La receta se toma de la primera fila con refraccion que aparezca, porque
    // la lista viene ordenada por fecha descendente: esa es la ultima receta.
    if (!tieneRefraccion(actual) && tieneRefraccion(fila)) {
      const receta = {};
      for (const campo of CAMPOS_REFRACCION) receta[campo] = fila[campo];
      elegidas.set(k, {
        ...fila,
        ...actual,
        ...receta,
        fecha_receta: aTexto(fila.fecha).trim() || actual.fecha_receta || actual.fecha
      });
    } else if (!actual.fecha_receta && tieneRefraccion(actual)) {
      actual.fecha_receta = actual.fecha;
    }
  }
  return [...elegidas.values()];
};

/**
 * Una sola tarjeta por paciente, saltandose el CONSUMIDOR FINAL.
 * Ver unaTarjetaPorCedula, que es donde vive la regla de la ultima Rx.
 */
export const agruparPorCedula = (filas) =>
  unaTarjetaPorCedula(
    (filas || []).filter(item => item && aTexto(item.nombre) !== NOMBRE_CONSUMIDOR_FINAL)
  );

/** Filtro del buscador sobre el historial local. Menos de 2 letras: nada. */
export const filtrarPorTermino = (filas, termino) => {
  const busqueda = aTexto(termino).trim().toLowerCase();
  if (busqueda.length < 2) return [];
  return (filas || []).filter(item =>
    aTexto(item?.nombre).toLowerCase().includes(busqueda)
    || aTexto(item?.cedula).includes(busqueda)
    || aTexto(item?.alias).toLowerCase().includes(busqueda)
  );
};

/**
 * Que lista se esta mostrando. Sin termino: el historial entero. Con termino: solo
 * los resultados de ESA busqueda, y si el termino ya no coincide con el que se
 * pidio, nada (se descarta un resultado que llego tarde en vez de pintar datos
 * de otra busqueda).
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
 * Diagnostico a partir de la refraccion final. Umbrales clinicos: negativo es
 * miopia, positivo hipermetropia, cilindro distinto de cero astigmatismo y
 * adicion positiva presbicia. Se deduplican y no se repite el mismo ojo dos
 * veces (si los dos ojos son mopes, sale una sola vez).
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
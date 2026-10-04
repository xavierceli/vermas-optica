// ---------------------------------------------------------------------------
// REGLAS DE PEDIDOS (modulo puro, sin React ni Supabase: se puede probar con node --test)
// ---------------------------------------------------------------------------
//  1) Autocompletar los parametros del armazon con los datos del inventario.
//  2) Fecha del pedido: elegirla, conservarla al editar y validarla.
// ---------------------------------------------------------------------------
import { parsearFechaLocal } from './fechas.js';

const CAMPOS_ARMAZON = ['tipo_armazon', 'param_horizontal', 'param_puente', 'param_vertical', 'param_diagonal'];
const TIPOS_ARMAZON = ['Completo', 'Semi al Aire', 'Al Aire'];

const texto = valor => (valor === null || valor === undefined ? '' : String(valor)).trim();
const clave = valor => texto(valor).toUpperCase();

/** Busca en el inventario el armazon con ese codigo (sin importar mayusculas ni espacios). */
export const buscarArmazon = (inventario, codigo) => {
  const buscado = clave(codigo);
  if (!buscado) return null;
  return (inventario || []).find(item => item && item.categoria === 'Armazon' && clave(item.codigo) === buscado) || null;
};

/** Los datos del armazon tal como los usa el formulario de pedidos. */
export const parametrosDeArmazon = armazon => ({
  tipo_armazon: TIPOS_ARMAZON.find(tipo => clave(tipo) === clave(armazon?.tipo_armazon)) || '',
  param_horizontal: texto(armazon?.param_horizontal),
  param_puente: texto(armazon?.param_puente),
  param_vertical: texto(armazon?.param_vertical),
  param_diagonal: texto(armazon?.param_diagonal)
});

/**
 * Que campos del pedido cambiar cuando cambia el codigo del armazon. Devuelve solo los campos
 * a asignar ({} si no hay que tocar nada).
 *  - Codigo de un armazon del inventario distinto al anterior: se copian sus datos.
 *  - Mismo codigo (por ejemplo, volver a escribirlo): no se pisa lo que se haya corregido a mano.
 *  - Codigo que ya no es de ningun armazon (borrado, a medio escribir, 2905 "del paciente"): si los
 *    datos eran exactamente los autocompletados del armazon anterior, se quitan; si se retocaron, se respetan.
 */
export const autocompletarArmazon = ({ codigoAnterior, codigoNuevo, actuales = {}, inventario = [] } = {}) => {
  const nuevo = buscarArmazon(inventario, codigoNuevo);
  if (nuevo) {
    if (clave(codigoAnterior) === clave(codigoNuevo)) return {};
    return parametrosDeArmazon(nuevo);
  }
  const anterior = buscarArmazon(inventario, codigoAnterior);
  if (anterior) {
    const autocompletados = parametrosDeArmazon(anterior);
    const sinRetoques = CAMPOS_ARMAZON.every(campo => texto(actuales[campo]) === autocompletados[campo]);
    if (sinRetoques) return Object.fromEntries(CAMPOS_ARMAZON.map(campo => [campo, '']));
  }
  return {};
};

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const soloFecha = valor => texto(valor).slice(0, 10);

/**
 * La fecha del pedido. Orden: la que se eligio en el formulario; si no, la que ya tenia el pedido
 * guardado (para que editarlo NO lo vuelva a fechar con el dia de hoy); si es un pedido nuevo, hoy.
 */
export const fechaDelPedido = (pedido, hoy) => {
  const elegida = soloFecha(pedido?.fecha_pedido);
  if (elegida) return elegida;
  if (!pedido?._nueva_venta) {
    const guardada = soloFecha(pedido?.fecha_venta);
    if (FECHA_ISO.test(guardada)) return guardada;
  }
  return hoy;
};

/** Mensaje si la fecha no sirve (no existe en el calendario o es futura); null si esta bien. */
export const problemaFechaPedido = (pedido, hoy) => {
  const fecha = fechaDelPedido(pedido, hoy);
  if (!FECHA_ISO.test(fecha) || !parsearFechaLocal(fecha)) return 'La fecha del pedido no es válida.';
  if (fecha > hoy) return 'La fecha del pedido no puede ser futura.';
  return null;
};
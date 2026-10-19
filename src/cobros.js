// ---------------------------------------------------------------------------
// REGLAS DEL COBRO
// ---------------------------------------------------------------------------
// Módulo puro, sin React ni Supabase, para poder probarlo con node --test.
//
// Centraliza las validaciones de dinero en caja y cobros:
//  - Rechaza montos <= 0 o con más de dos decimales.
//  - Valida que la venta exista y no esté en estado 'Anulado'.
//  - Admite comas o puntos como separador decimal.
// ---------------------------------------------------------------------------

import { calcularSaldo, calcularTotal } from './reglas.js';

/**
 * Devuelve un mensaje de error si el monto no es válido o null si es correcto.
 * @param {number|string} monto
 * @returns {string|null}
 */
export const validarMontoCobro = (monto) => {
  if (monto === null || monto === undefined || String(monto).trim() === '') {
    return 'Por favor, ingrese un monto válido mayor a 0.';
  }

  const texto = String(monto).trim().replace(',', '.');
  const valor = Number(texto);

  if (!Number.isFinite(valor) || valor <= 0) {
    return 'Por favor, ingrese un monto válido mayor a 0.';
  }

  // Para números calculados en JavaScript (por ejemplo 0.1 + 0.2), elimina
  // únicamente el residuo binario diminuto. Los valores tecleados como texto
  // conservan la validación estricta de dos decimales.
  if (typeof monto === 'number') {
    const centavos = Math.round(valor * 100);
    if (Math.abs(valor * 100 - centavos) > 0.000001) {
      return 'El monto debe tener como máximo dos decimales.';
    }
    return null;
  }

  const partes = texto.split('.');
  if (partes.length === 2 && partes[1].length > 2) {
    return 'El monto debe tener como máximo dos decimales.';
  }

  return null;
};

/**
 * Valida si un cobro puede aplicarse sobre un registro de venta.
 * @param {{ item: Object, monto: number|string }} param0
 * @returns {string|null}
 */
export const validarCobroSobreVenta = ({ item, monto } = {}) => {
  const problemaMonto = validarMontoCobro(monto);
  if (problemaMonto) return problemaMonto;

  const pedidoId = String(item?.pedido_id || item?.id || '').trim();
  if (!pedidoId) {
    return 'Este registro todavía no tiene una venta local.';
  }

  if (String(item?.estado || '').trim().toLowerCase() === 'anulado') {
    return 'No se pueden registrar cobros sobre una venta anulada.';
  }

  return null;
};

/**
 * Cambiar el estado (en laboratorio, listo para entrega...) exige una venta existente.
 * @param {Object} item
 * @returns {string|null}
 */
export const validarVentaParaCambiarEstado = (item) => {
  const pedidoId = String(item?.pedido_id || item?.id || '').trim();
  if (!pedidoId) {
    return 'Este registro todavía no tiene una venta local.';
  }
  return null;
};

/**
 * Texto de la confirmacion antes de marcar una venta como "Entregado".
 *
 * Marcar entregado es un solo clic en la lista, y lo que pasa despues depende
 * del dinero: si ya estaba pagada, la tarjeta desaparece de la pestaña actual y
 * se va a "Entregados y Pagados"; si todavia debe, se queda donde esta. Decirlo
 * ANTES evita el susto de "se borro la venta" y el entregar sin querer.
 *
 * @param {Object} item venta o consulta con venta
 * @returns {string}
 */
export const mensajeConfirmarEntrega = (item) => {
  const nombre = String(item?.nombre ?? '').trim().slice(0, 40);
  const quien = nombre ? ` de ${nombre}` : '';
  const saldo = calcularSaldo(item?.venta, item?.descuento, item?.abono);
  const total = calcularTotal(item?.venta, item?.descuento);

  if (total > 0 && saldo <= 0) {
    return `¿Marcar como Entregado el pedido${quien}? Ya está pagado: pasará a "✅ Entregados y Pagados" y saldrá de esta lista.`;
  }

  if (saldo > 0) {
    return `¿Marcar como Entregado el pedido${quien}? Todavía tiene $${saldo.toFixed(2)} de saldo: seguirá en "🔥 Con Saldo" hasta que se cobre.`;
  }

  return `¿Marcar como Entregado el pedido${quien}?`;
};

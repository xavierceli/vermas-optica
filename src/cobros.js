// ---------------------------------------------------------------------------
// REGLAS DEL COBRO
// ---------------------------------------------------------------------------
// Modulo puro, sin React ni Supabase, para poder probarlo con node --test.
//
// Estas reglas estaban escritas DOS VECES, una en cada pantalla de cobro
// (PedidosLista y PedidosForm), y las dos segun cambiaban en motores. El monto
// del cobro es dinero: que se acepte 0, o 10.999 cuando solo caben dos
// decimales, se traduce en una caja que no cuadra. Modulo puro, un solo sitio y
// tests.

/** Devuelve el mensaje si el monto no es valido, o null si lo es. */
export const validarMontoCobro = (monto) => {
  const valor = Number(monto);
  if (!Number.isFinite(valor) || valor <= 0) {
    return 'Por favor, ingrese un monto válido mayor a 0.';
  }
  // Mas de dos decimales. La tolerancia es por la coma flotante: 0.1 + 0.2.
  if (Math.abs(valor * 100 - Math.round(valor * 100)) > 0.000001) {
    return 'El monto debe tener como máximo dos decimales.';
  }
  return null;
};

/**
 * Un cobro solo existe si hay una venta. Sin ella no hay a que abonarle, y antes
 * se intentaba igualmente.
 * El orden de las comprobaciones es el que ve el optometria hoy: primero el
 * monto y despues la venta.
 */
export const validarCobroSobreVenta = ({ item, monto } = {}) => {
  const problemaMonto = validarMontoCobro(monto);
  if (problemaMonto) return problemaMonto;
  if (!String(item?.pedido_id || '').trim()) {
    return 'Este registro todavía no tiene una venta local.';
  }
  return null;
};

/** Cambiar el estado (anular, marcar en laborator io...) tambien exige venta. */
export const validarVentaParaCambiarEstado = (item) =>
  (String(item?.pedido_id || '').trim() ? null : 'Este registro todavía no tiene una venta local.');
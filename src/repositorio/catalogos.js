// ---------------------------------------------------------------------------
// INVENTARIO Y TARIFARIO
// ---------------------------------------------------------------------------
// Productos (armazones y accesorios) y precios. No mueven stock: el stock solo
// cambia por una venta o una anulacion (ver ventas.js).
// Codigo movido tal cual desde localRepository.js.
// ---------------------------------------------------------------------------
import { localDb, pendingRecord, createOutboxOperation } from '../localDb.js';
import { safeNum } from './base.js';

export const guardarInventarioLocalImpl = async ({ id, ...data }) => {
  const inventoryId = id || -Date.now();
  const existing = await localDb.inventory.get(inventoryId);
  const record = pendingRecord({
    ...data,
    id: inventoryId,
    stock: Math.max(0, Math.round(safeNum(data.stock))),
    precio: data.precio === '' ? null : data.precio,
    costo_compra: data.costo_compra === '' ? null : data.costo_compra
  });
  const operation = createOutboxOperation({
    type: 'UPSERT_INVENTARIO', entityId: inventoryId,
    baseVersion: existing?.version || 0,
    payload: { p_inventario_id: inventoryId, p_datos: { ...record, syncStatus: undefined, updatedAt: undefined } }
  });
  await localDb.transaction('rw', localDb.inventory, localDb.outbox, async () => {
    await localDb.inventory.put(record);
    await localDb.outbox.put(operation);
  });
  return { inventoryId };
};

export const eliminarInventarioLocalImpl = async inventoryId => {
  const operation = createOutboxOperation({
    type: 'ELIMINAR_INVENTARIO', entityId: inventoryId,
    payload: { p_inventario_id: inventoryId }
  });
  await localDb.transaction('rw', localDb.inventory, localDb.outbox, async () => {
    await localDb.inventory.delete(inventoryId);
    await localDb.outbox.put(operation);
  });
};

export const guardarPrecioLocalImpl = async ({ id, ...data }) => {
  const priceId = id || -Date.now();
  const existing = await localDb.prices.get(priceId);
  const record = pendingRecord({ ...data, id: priceId });
  const operation = createOutboxOperation({
    type: 'UPSERT_PRECIO', entityId: priceId,
    baseVersion: existing?.version || 0,
    payload: { p_precio_id: priceId, p_datos: { ...record, syncStatus: undefined, updatedAt: undefined } }
  });
  await localDb.transaction('rw', localDb.prices, localDb.outbox, async () => {
    await localDb.prices.put(record);
    await localDb.outbox.put(operation);
  });
  return { priceId };
};

export const eliminarPrecioLocalImpl = async priceId => {
  const operation = createOutboxOperation({ type: 'ELIMINAR_PRECIO', entityId: priceId, payload: { p_precio_id: priceId } });
  await localDb.transaction('rw', localDb.prices, localDb.outbox, async () => {
    await localDb.prices.delete(priceId);
    await localDb.outbox.put(operation);
  });
};

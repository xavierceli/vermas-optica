// ---------------------------------------------------------------------------
// VENTAS, COBROS, REEMBOLSOS Y AJUSTES DE INVENTARIO
// ---------------------------------------------------------------------------
// Todo lo que descuenta o devuelve stock.
// ---------------------------------------------------------------------------
import { localDb, createUuid, nowIso, pendingRecord, createOutboxOperation } from '../localDb.js';
import { calcularSaldo } from '../reglas.js';
import { safeString, safeNum, buildInventoryIndex, patientPayload, movementRecord, deriveItems, locateInventory, obtenerContadorEscaneosInventario } from './base.js';

export { obtenerContadorEscaneosInventario };

// --- Resolucion de los productos de una venta --------------------------------

const movimiento = args => movementRecord({ ...args, createUuid, nowIso });

/** Aplica un delta al stock. `delta` negativo descuenta, positivo devuelve. */
const adjustLocalStock = async (table, item, delta) => {
  const product = await table.get(item.inventoryId);
  if (!product) throw new Error(`No existe el producto local ${item.inventoryId}`);
  const nextStock = safeNum(product.stock) + safeNum(delta);
  if (nextStock < 0) throw new Error(`Stock insuficiente para ${product.codigo || product.id}`);
  await table.put({ ...product, stock: nextStock, updatedAt: nowIso(), syncStatus: product.syncStatus || 'synced' });
  return { product, nextStock };
};

export const guardarVentaLocalImpl = async ({ patient, consultationId, sale, initialPayment = null }) => {
  const saleId = sale.id || sale.pedido_id || createUuid();
  const consultationIdForSale = consultationId || sale.consultation_id || sale.consulta_id || createUuid();
  const isEdit = Boolean(await localDb.sales.get(saleId));
  const previousSale = isEdit ? await localDb.sales.get(saleId) : null;
  const previousItems = isEdit ? await localDb.saleItems.where('saleId').equals(saleId).toArray() : [];
  const items = await deriveItems({ ...sale, items: sale.items });
  const resolvedItems = [];
  const inventoryIndex = buildInventoryIndex(await localDb.inventory.toArray());

  for (const item of items) {
    const product = await locateInventory(item, inventoryIndex);
    resolvedItems.push({ ...item, inventoryId: product.id, price: safeString(product.precio), code: product.codigo });
  }

  const normalizedSale = pendingRecord({
    ...sale,
    id: saleId,
    patientId: patient.patient_id || patient.id || sale.patient_id,
    consultationId: consultationIdForSale,
    fecha: sale.fecha || nowIso().slice(0, 10),
    abono: isEdit ? safeString(previousSale.abono || '0') : '0',
    pedido_id: saleId,
    syncStatus: 'pending'
  });
  const patientId = normalizedSale.patientId;
  const normalizedPatient = pendingRecord({ ...patientPayload({ ...patient, id: patientId }) });
  const operation = createOutboxOperation({
    type: isEdit ? 'EDITAR_VENTA' : 'CREAR_VENTA',
    entityId: saleId,
    baseVersion: previousSale?.version || 0,
    payload: {
      p_venta_id: saleId,
      p_payload: {
        paciente: patientPayload(normalizedPatient),
        consulta_id: normalizedSale.consultationId || null,
        consulta: normalizedSale.consultationId ? {} : { fecha: normalizedSale.fecha },
        venta: { ...sale, id: saleId, abono: '0', fecha: normalizedSale.fecha },
        items: resolvedItems
          .filter(item => item.inventoryId !== null)
          .map(item => ({ inventario_id: item.inventoryId, codigo: null, cantidad: item.quantity }))
      }
    }
  });

  await localDb.transaction(
    'rw',
    localDb.patients, localDb.consultations, localDb.sales, localDb.saleItems,
    localDb.payments, localDb.inventory, localDb.inventoryMovements, localDb.outbox,
    async () => {
      await localDb.patients.put(normalizedPatient);
      if (!previousSale) {
        await localDb.consultations.put(pendingRecord({
          id: normalizedSale.consultationId, patientId, fecha: normalizedSale.fecha
        }));
      }
      await localDb.sales.put(normalizedSale);
      await localDb.saleItems.where('saleId').equals(saleId).delete();

      for (const old of previousItems) {
        if (!resolvedItems.some(item => Number(item.inventoryId) === Number(old.inventoryId))) {
          await adjustLocalStock(localDb.inventory, { inventoryId: old.inventoryId }, Number(old.quantity || 0));
          await localDb.inventoryMovements.put(movimiento({
            operationId: operation.id, saleId, inventoryId: old.inventoryId,
            type: 'DEVOLUCION', quantity: Number(old.quantity || 0)
          }));
        }
      }

      for (const item of resolvedItems) {
        const old = previousItems.find(row => Number(row.inventoryId) === Number(item.inventoryId));
        const oldQuantity = Number(old?.quantity || 0);
        const delta = item.quantity - oldQuantity;
        if (delta > 0) await adjustLocalStock(localDb.inventory, item, -delta);
        if (delta < 0) await adjustLocalStock(localDb.inventory, item, -delta);
        await localDb.saleItems.put({
          id: createUuid(), saleId, inventoryId: item.inventoryId, quantity: item.quantity,
          price: item.price, code: item.code, syncStatus: 'pending'
        });
        if (delta !== 0) {
          await localDb.inventoryMovements.put(movimiento({
            operationId: operation.id, saleId, inventoryId: item.inventoryId,
            type: delta > 0 ? 'SALIDA' : 'DEVOLUCION', quantity: Math.abs(delta)
          }));
        }
      }
      await localDb.outbox.put(operation);

      const paymentAmount = Number(safeNum(initialPayment?.monto).toFixed(2));
      if (paymentAmount > 0) {
        const paymentKey = initialPayment.idempotencyKey || saleId;
        const yaRegistrado = await localDb.payments.where('idempotencyKey').equals(paymentKey).first();
        if (!yaRegistrado) {
          const paymentId = createUuid();
          const payment = pendingRecord({
            id: paymentId, saleId, idempotencyKey: paymentKey, monto: paymentAmount,
            metodo: initialPayment.metodo || 'Efectivo', referencia: initialPayment.referencia || null,
            comprobantePath: initialPayment.comprobantePath || null, createdAt: nowIso()
          });
          const paymentOperation = createOutboxOperation({
            type: 'REGISTRAR_PAGO', entityId: paymentId,
            payload: {
              p_pedido_id: saleId, p_idempotency_key: paymentKey, p_monto: paymentAmount,
              p_metodo: payment.metodo, p_referencia: payment.referencia, p_comprobante_path: payment.comprobantePath
            }
          });
          paymentOperation.createdAt = new Date(Date.parse(operation.createdAt) + 1).toISOString();
          await localDb.payments.put(payment);
          await localDb.outbox.put(paymentOperation);
          const previousBalance = Number(safeNum(previousSale?.abono).toFixed(2));
          await localDb.sales.put({ ...normalizedSale, abono: Number((previousBalance + paymentAmount).toFixed(2)), syncStatus: 'pending' });
        }
      }
    }
  );

  return { saleId, patientId, consultationId: normalizedSale.consultationId, operationId: operation.id };
};

export const registrarPagoLocalImpl = async ({ saleId, amount, method = 'Efectivo', reference = null, receiptPath = null, idempotencyKey = createUuid() }) => {
  const paymentAmount = Number(safeNum(amount).toFixed(2));
  if (paymentAmount <= 0) throw new Error('El monto del pago debe ser mayor que cero.');
  const paymentId = createUuid();
  let result;

  await localDb.transaction('rw', localDb.sales, localDb.payments, localDb.outbox, async () => {
    const previousPayment = await localDb.payments.where('idempotencyKey').equals(idempotencyKey).first();
    if (previousPayment) {
      result = { paymentId: previousPayment.id, saleId, alreadyExists: true };
      return;
    }
    const sale = await localDb.sales.get(saleId);
    if (!sale) throw new Error('La venta no existe en este dispositivo.');
    if (sale.estado === 'Anulado') throw new Error('No se pueden pagar ventas anuladas.');

    const current = Number(safeNum(sale.abono).toFixed(2));
    const balance = calcularSaldo(sale.venta, sale.descuento, current);
    if (balance <= 0) throw new Error('La venta ya está pagada.');
    if (paymentAmount > balance + 0.005) throw new Error(`El pago supera el saldo pendiente (${balance.toFixed(2)}).`);

    const payment = pendingRecord({
      id: paymentId, saleId, idempotencyKey, monto: paymentAmount,
      metodo: method, referencia: reference, comprobantePath: receiptPath, createdAt: nowIso()
    });
    const operation = createOutboxOperation({
      type: 'REGISTRAR_PAGO', entityId: paymentId,
      payload: {
        p_pedido_id: saleId, p_idempotency_key: idempotencyKey, p_monto: paymentAmount,
        p_metodo: method, p_referencia: reference, p_comprobante_path: receiptPath
      }
    });

    await localDb.payments.put(payment);
    await localDb.outbox.put(operation);
    await localDb.sales.put({
      ...sale,
      abono: (current + paymentAmount).toFixed(2),
      forma_pago: method,
      pago_nota: `${sale.pago_nota || ''}${sale.pago_nota ? '\n' : ''}[${nowIso().slice(0, 10)}] +${paymentAmount.toFixed(2)} ${method}`,
      comprobante_url: receiptPath || sale.comprobante_url || '',
      updatedAt: nowIso(), syncStatus: 'pending'
    });
    result = { paymentId, saleId, balance: Number((balance - paymentAmount).toFixed(2)) };
  });

  return result;
};

export const registrarReembolsoLocalImpl = async ({ saleId, amount, method = 'Efectivo', reference = null, idempotencyKey = createUuid() }) => {
  const refundAmount = Number(safeNum(amount).toFixed(2));
  if (refundAmount <= 0) throw new Error('El monto del reembolso debe ser mayor que cero.');
  const paymentId = createUuid();
  let result;

  await localDb.transaction('rw', localDb.sales, localDb.payments, localDb.outbox, async () => {
    const previousPayment = await localDb.payments.where('idempotencyKey').equals(idempotencyKey).first();
    if (previousPayment) {
      result = { paymentId: previousPayment.id, saleId, alreadyExists: true };
      return;
    }
    const sale = await localDb.sales.get(saleId);
    if (!sale) throw new Error('La venta no existe en este dispositivo.');
    if (sale.estado === 'Anulado') throw new Error('No se puede reembolsar una venta ya anulada.');

    const current = Number(safeNum(sale.abono).toFixed(2));
    if (current <= 0) throw new Error('Esta venta no tiene saldo abonado a devolver.');
    if (refundAmount > current + 0.005) {
      throw new Error(`El reembolso ($${refundAmount.toFixed(2)}) supera lo abonado ($${current.toFixed(2)}).`);
    }

    const payment = pendingRecord({
      id: paymentId, saleId, idempotencyKey, monto: refundAmount, tipo: 'REEMBOLSO',
      metodo: method, referencia: reference, createdAt: nowIso()
    });
    const operation = createOutboxOperation({
      type: 'REEMBOLSAR_PAGO', entityId: paymentId,
      payload: {
        p_pedido_id: saleId, p_idempotency_key: idempotencyKey, p_monto: refundAmount,
        p_metodo: method, p_referencia: reference
      }
    });

    await localDb.payments.put(payment);
    await localDb.outbox.put(operation);
    await localDb.sales.put({
      ...sale,
      abono: (current - refundAmount).toFixed(2),
      forma_pago: method,
      pago_nota: `${sale.pago_nota || ''}${sale.pago_nota ? '\n' : ''}[${nowIso().slice(0, 10)}] -${refundAmount.toFixed(2)} ${method}`,
      updatedAt: nowIso(), syncStatus: 'pending'
    });
    result = { paymentId, saleId, abonoRestante: Number((current - refundAmount).toFixed(2)) };
  });

  return result;
};

export const anularVentaConReembolsoImpl = async ({ saleId, method = 'Efectivo', reference = null }) => {
  const sale = await localDb.sales.get(saleId);
  if (!sale) throw new Error('La venta no existe en este dispositivo.');
  const abono = Number(safeNum(sale.abono).toFixed(2));
  if (abono > 0) {
    await registrarReembolsoLocalImpl({ saleId, amount: abono, method, reference });
  }
  return anularVentaLocalImpl(saleId);
};

export const cambiarEstadoVentaLocalImpl = async ({ saleId, estado }) => {
  const allowed = ['Ninguno', 'En laboratorio', 'Listo para Entrega', 'Entregado'];
  if (!allowed.includes(estado)) throw new Error('Estado de venta inválido.');
  const operation = createOutboxOperation({
    type: 'CAMBIAR_ESTADO_VENTA', entityId: saleId,
    payload: { p_venta_id: saleId, p_estado: estado }
  });
  await localDb.transaction('rw', localDb.sales, localDb.outbox, async () => {
    const sale = await localDb.sales.get(saleId);
    if (!sale) throw new Error('La venta no existe en este dispositivo.');
    if (sale.estado === 'Anulado') throw new Error('Una venta anulada no puede cambiar de estado.');
    await localDb.sales.put({ ...sale, estado, updatedAt: nowIso(), syncStatus: 'pending' });
    await localDb.outbox.put(operation);
  });
  return { saleId, estado };
};

export const anularVentaLocalImpl = async saleId => {
  const operation = createOutboxOperation({
    type: 'ANULAR_VENTA', entityId: saleId,
    payload: { p_venta_id: saleId }
  });
  const productosAusentes = [];

  await localDb.transaction(
    'rw', localDb.sales, localDb.saleItems, localDb.inventory, localDb.inventoryMovements, localDb.outbox,
    async () => {
      const sale = await localDb.sales.get(saleId);
      if (!sale) throw new Error('La venta no existe en este dispositivo.');
      if (sale.estado === 'Anulado') {
        await localDb.outbox.put(operation);
        return;
      }
      if (Number(safeNum(sale.abono)) > 0) {
        throw new Error(`Esta venta tiene $${Number(safeNum(sale.abono)).toFixed(2)} abonado. Reembolsa el abono antes de anularla.`);
      }

      // 1. Obtener los ítems explícitos de la tabla saleItems
      const items = await localDb.saleItems.where('saleId').equals(saleId).toArray();
      const devueltosIds = new Set();

      for (const item of items) {
        const product = await localDb.inventory.get(item.inventoryId);
        if (!product) {
          if (!productosAusentes.some(id => String(id) === String(item.inventoryId))) {
            productosAusentes.push(item.inventoryId);
          }
          continue;
        }
        await localDb.inventory.put({
          ...product, stock: safeNum(product.stock) + safeNum(item.quantity),
          updatedAt: nowIso(), syncStatus: 'pending'
        });
        await localDb.inventoryMovements.put(movimiento({
          operationId: operation.id, saleId, inventoryId: item.inventoryId,
          type: 'DEVOLUCION', quantity: Number(item.quantity || 0)
        }));
        devueltosIds.add(String(product.id));
      }

      // 2. CORRECCIÓN ACCESORIOS: Devolver stock si venía en sale.accesorio_id
      if (sale.accesorio_id && !devueltosIds.has(String(sale.accesorio_id))) {
        let accProduct = await localDb.inventory.get(sale.accesorio_id);
        if (!accProduct) {
          accProduct = await localDb.inventory
            .filter(inv => safeString(inv.categoria) === 'Accesorio' && (String(inv.id) === String(sale.accesorio_id) || safeString(inv.nombre_accesorio) === safeString(sale.accesorio_id)))
            .first();
        }
        if (accProduct) {
          await localDb.inventory.put({
            ...accProduct,
            stock: safeNum(accProduct.stock) + 1,
            updatedAt: nowIso(),
            syncStatus: 'pending'
          });
          await localDb.inventoryMovements.put(movimiento({
            operationId: operation.id,
            saleId,
            inventoryId: accProduct.id,
            type: 'DEVOLUCION',
            quantity: 1
          }));
        } else {
          if (!productosAusentes.some(id => String(id) === String(sale.accesorio_id))) {
            productosAusentes.push(sale.accesorio_id);
          }
        }
      }

      await localDb.sales.put({ ...sale, estado: 'Anulado', updatedAt: nowIso(), syncStatus: 'pending' });
      await localDb.outbox.put(operation);
    }
  );
  return { saleId, estado: 'Anulado', productosAusentes };
};
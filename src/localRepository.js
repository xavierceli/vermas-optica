import { localDb, createUuid, nowIso, pendingRecord, createOutboxOperation, getMeta, setMeta } from './localDb.js';
import { calcularSaldo } from './reglas.js';

const safeString = value => value === null || value === undefined ? '' : String(value);
const safeNum = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// ---------------------------------------------------------------------------
// COLA DE ESCRITURA LOCAL CON PRIORIDAD
// IndexedDB serializa las transacciones 'rw' que tocan las mismas tablas. Por eso
// un guardado del usuario puede quedarse esperando a un pull de sincronizacion y
// la UI aparenta quedar congelada en "Guardando...". En vez de competir por el
// lock, todo pasa por una sola cola con DOS carriles:
//   - prioritario: acciones del usuario (guardar venta, pago, inventario).
//   - fondo: tareas automaticas del motor de sincronizacion.
// Si hay trabajo prioritario pendiente, el motor espera: el usuario nunca
// bloquea su propia app por una tarea de fondo.
// ---------------------------------------------------------------------------
const colaEscrituras = [];
let procesandoCola = false;
let tokenCola = 0;
// Si una tarea se queda colgada (una llamada de red que nunca responde, un
// bloqueo de IndexedDB), el hueco se libera pasado este tiempo. Sin esto, un
// solo atasco dejaba la app entera sin poder guardar nada.
const LIBERAR_HUEGO_MS = 15000;

const drenarCola = () => {
  if (procesandoCola || colaEscrituras.length === 0) return;
  let indice = 0;
  for (let i = 1; i < colaEscrituras.length; i += 1) {
    if (colaEscrituras[i].prioridad > colaEscrituras[indice].prioridad) indice = i;
  }
  const [elemento] = colaEscrituras.splice(indice, 1);
  procesandoCola = true;
  const nombre = elemento.nombre || 'tarea';
  const inicio = Date.now();
  const token = ++tokenCola;

  const liberar = () => {
    clearTimeout(vigilante);
    if (token !== tokenCola) return;
    procesandoCola = false;
    drenarCola();
  };

  const vigilante = setTimeout(() => {
    console.error(`[cola] "${nombre}" no ha terminado en ${LIBERAR_HUEGO_MS / 1000}s. Se libera el hueco para no bloquear el resto de escrituras.`);
    liberar();
  }, LIBERAR_HUEGO_MS);

  Promise.resolve()
    .then(() => {
      console.debug(`[cola] inicia ${nombre} (en espera: ${colaEscrituras.length})`);
      return elemento.tarea();
    })
    .then(resultado => {
      console.debug(`[cola] ok ${nombre} en ${Date.now() - inicio} ms`);
      elemento.resolver(resultado);
    }, error => {
      console.error(`[cola] fallo ${nombre} tras ${Date.now() - inicio} ms:`, error);
      elemento.rechazar(error);
    })
    .finally(() => liberar());
};

export const enColaEscritura = (tarea, prioridad = 'alta', nombre = 'tarea') => new Promise((resolver, rechazar) => {
  colaEscrituras.push({ tarea, prioridad: prioridad === 'alta' ? 1 : 0, resolver, rechazar, nombre });
  drenarCola();
});

let contadorEscaneosInventario = 0;
const normalizeCedula = value => safeString(value).trim().toUpperCase();
// Un id de inventario SIEMPRE es un entero. Esta función se usa para leer
// valores que vienen de un <input> o de un campo mal formado, y antes devolvía
// NaN para cualquier cosa que no fuera convertible ("ABC", "12abc", {}).
// NaN no es un null: al serializar a JSON se convierte en null sin avisar, y el
// servidor rechazaba la venta con "Cada item necesita inventario_id o codigo"
// (sqlstate 22023) sin señalar cuál de los dos campos venía mal. Un id que no es
// un número es, sencillamente, la ausencia de id.
const numericId = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const findPatient = (patientId, cedula) => {
  if (patientId) return localDb.patients.get(patientId);
  if (cedula) return localDb.patients.where('cedula').equals(normalizeCedula(cedula)).first();
  return Promise.resolve(null);
};

const findInventoryByCode = (code, index) => {
  if (index) return index.byCode.get(safeString(code).trim().toUpperCase()) || null;
  contadorEscaneosInventario += 1;
  return localDb.inventory.toArray().then(rows => rows.find(row => safeString(row.codigo).trim().toUpperCase() === safeString(code).trim().toUpperCase()));
};

// Cuenta los escaneos completos de la tabla de inventario. Sirve para detectar
// regresiones de rendimiento: un escaneo por venta hace que el pull del servidor
// retenga los locks de Dexie durante segundos y el guardado del usuario espere.
export const obtenerContadorEscaneosInventario = () => contadorEscaneosInventario;

const buildInventoryIndex = rows => ({
  byId: new Map(rows.map(row => [Number(row.id), row])),
  byCode: new Map(rows.filter(row => row.codigo).map(row => [safeString(row.codigo).trim().toUpperCase(), row]))
});

const deriveItems = async sale => {
  if (Array.isArray(sale.items) && sale.items.length > 0) return sale.items.map(item => ({
    inventoryId: numericId(item.inventoryId ?? item.inventario_id),
    code: safeString(item.code ?? item.codigo ?? '') || null,
    quantity: Math.max(1, Number(safeNum(item.quantity ?? item.cantidad)))
  }));

  const items = [];
  const frameCode = safeString(sale.codigo_armazon).trim();
  if (frameCode && frameCode !== '2905') items.push({ inventoryId: null, code: frameCode, quantity: 1 });
  const accessoryId = numericId(sale.accesorio_id);
  if (accessoryId !== null) items.push({ inventoryId: accessoryId, code: null, quantity: 1 });
  return items;
};

const locateInventory = async (item, inventoryIndex = null) => {
  if (inventoryIndex && item.inventoryId !== null) {
    const indexed = inventoryIndex.byId.get(Number(item.inventoryId));
    if (indexed) return indexed;
  }
  if (item.inventoryId !== null) {
    const row = await localDb.inventory.get(item.inventoryId);
    if (row) return row;
  }
  if (item.code) {
    const row = await findInventoryByCode(item.code, inventoryIndex);
    if (row) return row;
  }
  throw new Error(`No existe en el inventario local: ${item.code || item.inventoryId}`);
};

const movementRecord = ({ operationId, saleId, inventoryId, type, quantity }) => ({
  id: createUuid(),
  operationId,
  saleId,
  inventoryId,
  type,
  quantity,
  syncStatus: 'pending',
  createdAt: nowIso()
});

const patientPayload = patient => ({
  id: patient.id,
  cedula: normalizeCedula(patient.cedula),
  nombre: safeString(patient.nombre),
  alias: safeString(patient.alias) || null,
  telefono: safeString(patient.telefono) || null,
  correo: safeString(patient.correo) || null,
  fecha_nacimiento: safeString(patient.fecha_nacimiento) || null,
  antecedentes: safeString(patient.antecedentes) || null
});

const consultationPayload = consultation => {
  const payload = { ...consultation };
  ['id', 'patientId', 'syncStatus', 'updatedAt', 'archivedAt'].forEach(key => delete payload[key]);
  return payload;
};

const guardarConsultaLocalImpl = async ({ patient, consultation }) => {
  const consultationId = consultation.id || createUuid();
  const cedula = normalizeCedula(patient.cedula);
  const existingPatient = await findPatient(patient.patient_id || patient.id, cedula);
  const patientId = existingPatient?.id || patient.patient_id || patient.id || createUuid();
  const normalizedPatient = pendingRecord({ ...patientPayload({ ...patient, id: patientId, cedula }) });
  const normalizedConsultation = pendingRecord({
    ...consultation,
    id: consultationId,
    patientId,
    fecha: consultation.fecha || nowIso().slice(0, 10)
  });
  const operation = createOutboxOperation({
    type: 'GUARDAR_CONSULTA',
    entityId: consultationId,
    baseVersion: existingPatient?.version || 0,
    payload: {
      p_consulta_id: consultationId,
      p_payload: { paciente: patientPayload(normalizedPatient), consulta: consultationPayload(normalizedConsultation) }
    }
  });

  await localDb.transaction('rw', localDb.patients, localDb.consultations, localDb.outbox, async () => {
    await localDb.patients.put(normalizedPatient);
    await localDb.consultations.put(normalizedConsultation);
    await localDb.outbox.put(operation);
  });

  return { patientId, consultationId, operationId: operation.id };
};

const adjustLocalStock = async (table, item, delta) => {
  const product = await table.get(item.inventoryId);
  if (!product) throw new Error(`No existe el producto local ${item.inventoryId}`);
  const nextStock = Number(product.stock || 0) + delta;
  if (nextStock < 0) throw new Error(`Stock insuficiente para ${product.codigo || product.id}`);
  await table.put({ ...product, stock: nextStock, updatedAt: nowIso(), syncStatus: product.syncStatus || 'synced' });
  return { product, nextStock };
};

const guardarVentaLocalImpl = async ({ patient, consultationId, sale, initialPayment = null }) => {
  const saleId = sale.id || sale.pedido_id || createUuid();
  const consultationIdForSale = consultationId || sale.consultation_id || sale.consulta_id || createUuid();
  const isEdit = Boolean(await localDb.sales.get(saleId));
  const previousSale = isEdit ? await localDb.sales.get(saleId) : null;
  const previousItems = isEdit ? await localDb.saleItems.where('saleId').equals(saleId).toArray() : [];
  const items = await deriveItems({ ...sale, items: sale.items });
  const resolvedItems = [];
  // Una sola lectura del inventario para resolver todos los items de la venta.
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
          .filter(item => item.inventoryId !== null || safeString(item.code).trim() !== '')
          .map(item => ({
            inventario_id: item.inventoryId,
            codigo: item.inventoryId === null ? safeString(item.code).trim() || null : null,
            cantidad: item.quantity
          }))
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
          await localDb.inventoryMovements.put(movementRecord({
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
          await localDb.inventoryMovements.put(movementRecord({
            operationId: operation.id, saleId, inventoryId: item.inventoryId,
            type: delta > 0 ? 'SALIDA' : 'DEVOLUCION', quantity: Math.abs(delta)
          }));
        }
      }
      await localDb.outbox.put(operation);

      const paymentAmount = Number(safeNum(initialPayment?.monto).toFixed(2));
      if (paymentAmount > 0) {
        // El id de la venta se usa como clave de idempotencia cuando no viene una.
        // ANTES: se consultaba payments por paymentKey ANTES de declararla (6 lineas mas
        // abajo), lo que lanzaba ReferenceError y hacia IMPOSIBLE guardar cualquier
        // venta con abono inicial. El pago tampoco se registraba nunca.
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

const registrarPagoLocalImpl = async ({ saleId, amount, method = 'Efectivo', reference = null, receiptPath = null, idempotencyKey = createUuid() }) => {
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

// El servidor nunca anula una venta con abono. El reembolso es la unica salida
// y debe ser tan atomica e idempotente como el cobro.
const registrarReembolsoLocalImpl = async ({ saleId, amount, method = 'Efectivo', reference = null, idempotencyKey = createUuid() }) => {
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

const anularVentaConReembolsoImpl = async ({ saleId, method = 'Efectivo', reference = null }) => {
  const sale = await localDb.sales.get(saleId);
  if (!sale) throw new Error('La venta no existe en este dispositivo.');
  const abono = Number(safeNum(sale.abono).toFixed(2));
  // Primero devolver el dinero, despues anular: el servidor rechaza anular
  // una venta con saldo, y el orden inverso dejaria el pedido a medias.
  if (abono > 0) {
    await registrarReembolsoLocalImpl({ saleId, amount: abono, method, reference });
  }
  return anularVentaLocalImpl(saleId);
};

const cambiarEstadoVentaLocalImpl = async ({ saleId, estado }) => {
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

const anularVentaLocalImpl = async saleId => {
  const operation = createOutboxOperation({
    type: 'ANULAR_VENTA', entityId: saleId,
    payload: { p_venta_id: saleId }
  });
  // Productos que no existen en este dispositivo: no se puede devolver su stock
  // aqui, pero el servidor es la fuente de verdad y lo hara al sincronizar.
  const productosAusentes = [];

  await localDb.transaction(
    'rw', localDb.sales, localDb.saleItems, localDb.inventory, localDb.inventoryMovements, localDb.outbox,
    async () => {
      const sale = await localDb.sales.get(saleId);
      if (!sale) throw new Error('La venta no existe en este dispositivo.');
      if (sale.estado === 'Anulado') {
        // Ya estaba anulada pero el servidor aun no lo sabe: hay que encolar la
        // operacion igual, o la venta se quedaria anulada solo en este equipo para
        // siempre y el usuario veria que "Cancelar" no hace nada.
        await localDb.outbox.put(operation);
        return;
      }
      if (Number(safeNum(sale.abono)) > 0) {
        throw new Error(`Esta venta tiene $${Number(safeNum(sale.abono)).toFixed(2)} abonado. Reembolsa el abono antes de anularla.`);
      }

      const items = await localDb.saleItems.where('saleId').equals(saleId).toArray();
      for (const item of items) {
        const product = await localDb.inventory.get(item.inventoryId);
        if (!product) {
          productosAusentes.push(item.inventoryId);
          continue;
        }
        await localDb.inventory.put({
          ...product, stock: Number(product.stock || 0) + Number(item.quantity || 0),
          updatedAt: nowIso(), syncStatus: 'pending'
        });
        await localDb.inventoryMovements.put(movementRecord({
          operationId: operation.id, saleId, inventoryId: item.inventoryId,
          type: 'DEVOLUCION', quantity: Number(item.quantity || 0)
        }));
      }
      await localDb.sales.put({ ...sale, estado: 'Anulado', updatedAt: nowIso(), syncStatus: 'pending' });
      await localDb.outbox.put(operation);
    }
  );
  return { saleId, estado: 'Anulado', productosAusentes };
};

const guardarInventarioLocalImpl = async ({ id, ...data }) => {
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

const eliminarInventarioLocalImpl = async inventoryId => {
  const operation = createOutboxOperation({
    type: 'ELIMINAR_INVENTARIO', entityId: inventoryId,
    payload: { p_inventario_id: inventoryId }
  });
  await localDb.transaction('rw', localDb.inventory, localDb.outbox, async () => {
    await localDb.inventory.delete(inventoryId);
    await localDb.outbox.put(operation);
  });
};

const guardarPrecioLocalImpl = async ({ id, ...data }) => {
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

const eliminarPrecioLocalImpl = async priceId => {
  const operation = createOutboxOperation({ type: 'ELIMINAR_PRECIO', entityId: priceId, payload: { p_precio_id: priceId } });
  await localDb.transaction('rw', localDb.prices, localDb.outbox, async () => {
    await localDb.prices.delete(priceId);
    await localDb.outbox.put(operation);
  });
};

const archivarConsultaLocalImpl = async consultationId => {
  await localDb.transaction('rw', localDb.consultations, localDb.outbox, async () => {
    const consultation = await localDb.consultations.get(consultationId);
    if (!consultation) throw new Error('La consulta no existe en este dispositivo.');

    await localDb.consultations.put({ ...consultation, archivedAt: nowIso(), syncStatus: 'pending' });

    // Si la consulta NUNCA llego al servidor, no hay nada que archivar alla y
    // el servidor rechazaria el comando para siempre ("La consulta X no existe"),
    // dejando una barra roja permanente. Solo se encola si ya vive alli.
    if (consultation.syncStatus === 'synced') {
      await localDb.outbox.put(createOutboxOperation({
        type: 'ARCHIVAR_CONSULTA', entityId: consultationId,
        payload: { p_consulta_id: consultationId }
      }));
    }
  });
};

const cacheServerHistorialImpl = async rows => {
  const [localPatients, localConsultations, localSales] = await Promise.all([
    localDb.patients.toArray(),
    localDb.consultations.toArray(),
    localDb.sales.toArray()
  ]);
  const patientMap = new Map(localPatients.map(row => [row.id, row]));
  const consultationMap = new Map(localConsultations.map(row => [row.id, row]));
  const saleMap = new Map(localSales.map(row => [row.id, row]));
  const nextPatients = [];
  const nextConsultations = [];
  const nextSales = [];
  const remoteRecords = [];
  const archivedRemoteIds = [];

  for (const row of rows || []) {
    const patientId = row.paciente_id || row.patient_id;
    const consultationId = row.id;
    const localPatient = patientMap.get(patientId);
    const localConsultation = consultationMap.get(consultationId);

    if (patientId && (!localPatient || localPatient.syncStatus !== 'pending')) {
      nextPatients.push({
        id: patientId, cedula: row.cedula, nombre: row.nombre, telefono: row.telefono,
        correo: row.correo, fecha_nacimiento: row.fecha_nacimiento,
        antecedentes: row.antecedentes, alias: row.alias,
        syncStatus: 'synced', updatedAt: nowIso()
      });
    }
    if (localConsultation?.archivedAt) {
      archivedRemoteIds.push(`remote:${consultationId}`);
      continue;
    }
    if (!localConsultation || localConsultation.syncStatus !== 'pending') {
      nextConsultations.push({
        ...row, id: consultationId, patientId, fecha: row.fecha,
        syncStatus: 'synced', updatedAt: nowIso()
      });
    }
    if (row.pedido_id) {
      const localSale = saleMap.get(row.pedido_id);
      if (!localSale || localSale.syncStatus !== 'pending') {
        nextSales.push({
          ...row, id: row.pedido_id, patientId, consultationId,
          fecha: row.fecha_venta || row.fecha, abono: row.abono || '0',
          version: localSale?.version || 0,
          syncStatus: 'synced', updatedAt: nowIso()
        });
      }
    }
    remoteRecords.push({ ...row, id: `remote:${row.id}`, kind: 'historial', updatedAt: nowIso() });
  }

  await localDb.transaction('rw', localDb.cache, localDb.patients, localDb.consultations, localDb.sales, async () => {
    if (remoteRecords.length > 0) await localDb.cache.bulkPut(remoteRecords);
    if (archivedRemoteIds.length > 0) await localDb.cache.bulkDelete(archivedRemoteIds);
    if (nextPatients.length > 0) await localDb.patients.bulkPut(nextPatients);
    if (nextConsultations.length > 0) await localDb.consultations.bulkPut(nextConsultations);
    if (nextSales.length > 0) await localDb.sales.bulkPut(nextSales);
  });
};
const cacheServerCatalogImpl = async ({ inventory = [], prices = [] } = {}) => {
  // ORDEN IMPORTANTE: primero se escribe el catalogo del servidor y despues se
  // resuelve la hidratacion de los items de venta. Si se invirtiera, una venta
  // que referencia un producto nuevo para el dispositivo no lo encontraria en el
  // indice y el pull entero fallaria.
  await localDb.transaction('rw', localDb.inventory, localDb.prices, async () => {
    for (const row of inventory) {
      const local = await localDb.inventory.get(row.id);
      if (!local || local.syncStatus !== 'pending') {
        await localDb.inventory.put({ ...row, syncStatus: 'synced', updatedAt: nowIso() });
      }
    }
    for (const row of prices) {
      const local = await localDb.prices.get(row.id);
      if (!local || local.syncStatus !== 'pending') {
        await localDb.prices.put({ ...row, syncStatus: 'synced', updatedAt: nowIso() });
      }
    }
  });

  const [inventarioActual, sales, saleItems] = await Promise.all([
    localDb.inventory.toArray(),
    localDb.sales.toArray(),
    localDb.saleItems.toArray()
  ]);
  const inventoryIndex = buildInventoryIndex(inventarioActual);
  const existingSaleIds = new Set(saleItems.map(item => item.saleId));
  const newSaleItems = [];

  for (const sale of sales) {
    if (existingSaleIds.has(sale.id)) continue;
    const items = await deriveItems(sale);
    for (const item of items) {
      const producto = await locateInventory(item, inventoryIndex).catch(() => null);
      // Un producto que no esta ni en el servidor ni en el dispositivo no debe
      // tumbar el pull completo: se omite este item y el resto sigue.
      if (!producto) continue;
      newSaleItems.push({
        id: createUuid(), saleId: sale.id, inventoryId: producto.id,
        quantity: item.quantity, price: producto.precio, code: producto.codigo,
        syncStatus: 'synced'
      });
    }
  }

  if (newSaleItems.length > 0) {
    await localDb.transaction('rw', localDb.saleItems, async () => {
      await localDb.saleItems.bulkPut(newSaleItems);
    });
  }
};
const importLegacyCacheImpl = async () => {
  if (await getMeta('legacyCacheImported', false)) return;
  const { leerBoveda } = await import('./motorOffline.js');
  const [legacyHistorial, legacyInventory, legacyPrices] = await Promise.all([
    leerBoveda('backup_historial'),
    leerBoveda('backup_inventario'),
    leerBoveda('backup_precios')
  ]);

  try {
    await localDb.transaction('rw', localDb.patients, localDb.consultations, localDb.sales, localDb.inventory, localDb.prices, async () => {
      for (const row of legacyHistorial || []) {
        if (!row?.id) continue;
        const patientId = row.paciente_id || row.patient_id;
        if (patientId && !(await localDb.patients.get(patientId))) {
          await localDb.patients.put({
            id: patientId, cedula: row.cedula, nombre: row.nombre, telefono: row.telefono,
            correo: row.correo, fecha_nacimiento: row.fecha_nacimiento,
            antecedentes: row.antecedentes, alias: row.alias,
            syncStatus: 'synced', updatedAt: nowIso()
          });
        }
        if (!(await localDb.consultations.get(row.id))) {
          await localDb.consultations.put({
            ...row, id: row.id, patientId, fecha: row.fecha,
            syncStatus: 'synced', updatedAt: nowIso()
          });
        }
        if (row.pedido_id && !(await localDb.sales.get(row.pedido_id))) {
          await localDb.sales.put({
            ...row, id: row.pedido_id, patientId, consultationId: row.id,
            fecha: row.fecha_venta || row.fecha, abono: row.abono || '0',
            syncStatus: 'synced', updatedAt: nowIso()
          });
        }
      }
      for (const row of legacyInventory || []) {
        const id = Number(row.id);
        if (Number.isFinite(id) && !(await localDb.inventory.get(id))) {
          await localDb.inventory.put({ ...row, id, syncStatus: 'synced', updatedAt: nowIso() });
        }
      }
      for (const row of legacyPrices || []) {
        const id = Number(row.id);
        if (Number.isFinite(id) && !(await localDb.prices.get(id))) {
          await localDb.prices.put({ ...row, id, syncStatus: 'synced', updatedAt: nowIso() });
        }
      }
    });
  } catch (error) {
    // La bandera se escribe IGUAL. Este era el bucle infinito: si la transaccion
    // fallaba, el flag nunca se guardaba, y cada carga de datos volvia a
    // intentar la migracion y a fallar otra vez, sin parar.
    await setMeta('legacyCacheImported', true);
    console.warn('[migracion] no se pudo importar el cache antiguo; se marcara como hecho para no reintentar en bucle:', error);
    return;
  }

  await setMeta('legacyCacheImported', true);
};
export const obtenerSnapshotLocal = async () => {
  const [patients, consultations, sales, items, payments, inventory, prices, outbox, cache] = await Promise.all([
    localDb.patients.toArray(), localDb.consultations.toArray(), localDb.sales.toArray(),
    localDb.saleItems.toArray(), localDb.payments.toArray(), localDb.inventory.toArray(),
    localDb.prices.toArray(), localDb.outbox.toArray(), localDb.cache.toArray()
  ]);
  const patientById = new Map(patients.map(row => [row.id, row]));
  const saleByConsultation = new Map(sales.filter(row => row.consultationId).map(row => [row.consultationId, row]));
  const itemsBySale = new Map();
  items.forEach(item => itemsBySale.set(item.saleId, [...(itemsBySale.get(item.saleId) || []), item]));
  const paymentsBySale = new Map();
  payments.forEach(payment => paymentsBySale.set(payment.saleId, [...(paymentsBySale.get(payment.saleId) || []), payment]));

  const localHistorial = consultations.filter(row => !row.archivedAt).map(consultation => {
    const patient = patientById.get(consultation.patientId) || {};
    const sale = saleByConsultation.get(consultation.id) || null;
    const salePayments = sale ? (paymentsBySale.get(sale.id) || []) : [];
    const abono = sale ? safeNum(sale.abono || salePayments.reduce((sum, payment) => sum + safeNum(payment.monto), 0)) : 0;
    return {
      ...patient, ...consultation, ...(sale || {}),
      id: consultation.id, patient_id: patient.id, paciente_id: patient.id,
      pedido_id: sale?.id || '', fecha_venta: sale?.fecha || null,
      abono: String(abono || 0), syncStatus: sale?.syncStatus || consultation.syncStatus || 'synced'
    };
  });
  const remoteHistorial = cache.filter(row => row.kind === 'historial' && !row.archivedAt).map(row => {
    const data = { ...row };
    delete data.kind;
    delete data.updatedAt;
    data.syncStatus = 'synced';
    return data;
  });
  const combined = [...localHistorial, ...remoteHistorial].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  const byCedula = new Map();
  combined.forEach(row => {
    const key = normalizeCedula(row.cedula) || `id:${row.id}`;
    if (!byCedula.has(key)) byCedula.set(key, row);
  });

  return {
    historial: [...byCedula.values()],
    inventory,
    prices,
    patients,
    consultations,
    sales,
    outbox,
    pendingCount: outbox.filter(row => row.status === 'pending' || row.status === 'failed').length,
    conflictCount: outbox.filter(row => row.status === 'conflict').length
  };
};

const markLocalOperationSyncedImpl = async operation => {
  const marcarSincronizado = async (tabla, id) => {
    if (!id) return;
    const entity = await localDb[tabla].get(id);
    if (entity) await localDb[tabla].put({ ...entity, syncStatus: 'synced', updatedAt: nowIso() });
  };
  const interno = operation.payload?.p_payload || {};
  switch (operation.type) {
    case 'GUARDAR_CONSULTA':
      await marcarSincronizado('consultations', operation.entityId);
      await marcarSincronizado('patients', interno.paciente?.id);
      break;
    case 'CREAR_VENTA':
    case 'EDITAR_VENTA':
      await marcarSincronizado('sales', operation.entityId);
      await marcarSincronizado('patients', interno.paciente?.id);
      await marcarSincronizado('consultations', interno.consulta_id);
      break;
    case 'REGISTRAR_PAGO':
    case 'REEMBOLSAR_PAGO':
      await marcarSincronizado('payments', operation.entityId);
      await marcarSincronizado('sales', operation.payload?.p_pedido_id);
      break;
    case 'CAMBIAR_ESTADO_VENTA':
    case 'ANULAR_VENTA':
      await marcarSincronizado('sales', operation.entityId);
      break;
    case 'ARCHIVAR_CONSULTA':
      await marcarSincronizado('consultations', operation.entityId);
      break;
    case 'UPSERT_INVENTARIO':
      await marcarSincronizado('inventory', operation.entityId);
      break;
    case 'UPSERT_PRECIO':
      await marcarSincronizado('prices', operation.entityId);
      break;
  }
};
// --- Adjuntos offline ------------------------------------------------------
// Antes, una foto tomada sin conexion se perdia en silencio: el catch solo
// hacia console.error y el estado del formulario se limpiaba igual. Aqui el
// binario queda en IndexedDB y se encola su subida.

const sanitizeNombre = nombre => safeString(nombre).replace(/[^a-zA-Z0-9.]/g, '').slice(-40) || 'archivo.jpg';

const guardarAdjuntoLocalImpl = async ({ blob, nombre = 'archivo.jpg', mime = 'image/jpeg', bucket, refType, refId }) => {
  if (!blob) throw new Error('No hay ningun archivo para adjuntar.');
  const adjuntoId = createUuid();
  const ruta = `${safeString(nombre).replace(/[^a-zA-Z0-9._-]/g, '') || 'archivo'}_${Date.now()}_${adjuntoId.substring(0, 8)}${mime === 'image/png' ? '.png' : '.jpg'}`;
  const adjunto = {
    id: adjuntoId,
    ruta,
    bucket,
    refType,
    refId,
    mime,
    nombre: sanitizeNombre(nombre),
    blob,
    status: 'pending',
    lastError: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const operation = createOutboxOperation({
    type: 'SUBIR_ADJUNTO',
    entityId: adjuntoId,
    payload: { p_adjunto_id: adjuntoId, p_bucket: bucket, p_ruta: ruta, p_ref_tipo: refType, p_ref_id: refId }
  });

  await localDb.transaction('rw', localDb.attachments, localDb.outbox, async () => {
    await localDb.attachments.put(adjunto);
    await localDb.outbox.put(operation);
  });

  return { adjuntoId, ruta, bucket, refId, refType, status: 'pending' };
};

const leerAdjuntoLocalImpl = async adjuntoId => {
  const adjunto = await localDb.attachments.get(adjuntoId);
  return adjunto?.blob || null;
};

const obtenerAdjuntosDeRefImpl = async refId => localDb.attachments.where('refId').equals(refId).toArray();

const marcarAdjuntoSubidoImpl = async (adjuntoId, { status = 'uploaded', lastError = null } = {}) => {
  const adjunto = await localDb.attachments.get(adjuntoId);
  if (adjunto) await localDb.attachments.put({ ...adjunto, status, lastError, updatedAt: nowIso() });
};

const contarAdjuntosPendientesImpl = async () => localDb.attachments.where('status').notEqual('uploaded').count();

// --- API publica serializada ---------------------------------------------
export const guardarVentaLocal = args => enColaEscritura(() => guardarVentaLocalImpl(args), 'alta', 'guardarVentaLocal');
export const cacheServerHistorial = rows => enColaEscritura(() => cacheServerHistorialImpl(rows), 'bajo', 'cacheServerHistorial');
export const cacheServerCatalog = datos => enColaEscritura(() => cacheServerCatalogImpl(datos), 'bajo', 'cacheServerCatalog');
export const importLegacyCache = () => enColaEscritura(() => importLegacyCacheImpl(), 'bajo', 'importLegacyCache');
export const guardarConsultaLocal = args => enColaEscritura(() => guardarConsultaLocalImpl(args), 'alta', 'guardarConsultaLocal');
export const registrarPagoLocal = args => enColaEscritura(() => registrarPagoLocalImpl(args), 'alta', 'registrarPagoLocal');
export const registrarReembolsoLocal = args => enColaEscritura(() => registrarReembolsoLocalImpl(args), 'alta', 'registrarReembolso');
export const anularVentaConReembolso = args => enColaEscritura(() => anularVentaConReembolsoImpl(args), 'alta', 'anularVentaConReembolso');
export const cambiarEstadoVentaLocal = args => enColaEscritura(() => cambiarEstadoVentaLocalImpl(args), 'alta', 'cambiarEstadoVentaLocal');
export const anularVentaLocal = id => enColaEscritura(() => anularVentaLocalImpl(id), 'alta', 'anularVentaLocal');
export const guardarInventarioLocal = args => enColaEscritura(() => guardarInventarioLocalImpl(args), 'alta', 'guardarInventarioLocal');
export const eliminarInventarioLocal = id => enColaEscritura(() => eliminarInventarioLocalImpl(id), 'alta', 'eliminarInventarioLocal');
export const guardarPrecioLocal = args => enColaEscritura(() => guardarPrecioLocalImpl(args), 'alta', 'guardarPrecioLocal');
export const eliminarPrecioLocal = id => enColaEscritura(() => eliminarPrecioLocalImpl(id), 'alta', 'eliminarPrecioLocal');
export const archivarConsultaLocal = id => enColaEscritura(() => archivarConsultaLocalImpl(id), 'alta', 'archivarConsultaLocal');
export const markLocalOperationSynced = op => enColaEscritura(() => markLocalOperationSyncedImpl(op), 'alta', 'markSync');
export const guardarAdjuntoLocal = args => enColaEscritura(() => guardarAdjuntoLocalImpl(args), 'alta', 'guardarAdjunto');
export const leerAdjuntoLocal = id => enColaEscritura(() => leerAdjuntoLocalImpl(id), 'alta', 'leerAdjunto');
export const obtenerAdjuntosDeRef = id => enColaEscritura(() => obtenerAdjuntosDeRefImpl(id), 'alta', 'leerAdjuntos');
export const marcarAdjuntoSubido = (id, opts) => enColaEscritura(() => marcarAdjuntoSubidoImpl(id, opts));
export const contarAdjuntosPendientes = () => enColaEscritura(() => contarAdjuntosPendientesImpl(), 'bajo', 'contarAdjuntos');

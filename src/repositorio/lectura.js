// ---------------------------------------------------------------------------
// LECTURA: SNAPSHOT LOCAL, CACHE DEL SERVIDOR Y MIGRACION
// ---------------------------------------------------------------------------
// Todo lo que solo LEE. Reune el estado del dispositivo en un unico objeto
// (obtenerSnapshotLocal), baja lo que hay en el servidor y lo guarda en local,
// y migra el cache antiguo de la version previa de la app.
// Codigo movido tal cual desde localRepository.js.
// ---------------------------------------------------------------------------
import { localDb, createUuid, getMeta, setMeta, nowIso } from '../localDb.js';
import { safeString, safeNum, archivada, normalizeCedula, buildInventoryIndex, deriveItems, locateInventory } from './base.js';

export const cacheServerHistorialImpl = async rows => {
  const [localPatients, localConsultations, localSales, cedulasLocales, cedulasServidor] = await Promise.all([
    localDb.patients.toArray(),
    localDb.consultations.toArray(),
    localDb.sales.toArray(),
    getMeta('cedulasArchivadas', []),
    getMeta('cedulasArchivadasServidor', [])
  ]);

  const cedulasBloqueadas = new Set([
    ...(cedulasLocales || []).map(normalizeCedula),
    ...(cedulasServidor || []).map(normalizeCedula)
  ].filter(Boolean));

  const patientMap = new Map(localPatients.map(row => [row.id, row]));
  const consultationMap = new Map(localConsultations.map(row => [row.id, row]));
  const saleMap = new Map(localSales.map(row => [row.id, row]));
  const nextPatients = [];
  const nextConsultations = [];
  const nextSales = [];
  const remoteRecords = [];
  const archivedRemoteIds = [];

  for (const row of rows || []) {
    const consultationId = row.id;
    const cedulaFila = normalizeCedula(row.cedula);

    if (archivada(row) || (cedulaFila && cedulasBloqueadas.has(cedulaFila))) {
      archivedRemoteIds.push(`remote:${consultationId}`);
      continue;
    }

    const patientId = row.paciente_id || row.patient_id;
    const localPatient = patientMap.get(patientId);
    const localConsultation = consultationMap.get(consultationId);

    if (localConsultation && archivada(localConsultation)) {
      archivedRemoteIds.push(`remote:${consultationId}`);
      continue;
    }

    if (patientId && (!localPatient || localPatient.syncStatus !== 'pending')) {
      nextPatients.push({
        id: patientId, cedula: row.cedula, nombre: row.nombre, telefono: row.telefono,
        correo: row.correo, fecha_nacimiento: row.fecha_nacimiento,
        antecedentes: row.antecedentes, alias: row.alias,
        syncStatus: 'synced', updatedAt: nowIso()
      });
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

export const cacheServerCatalogImpl = async ({ inventory = [], prices = [] } = {}) => {
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

export const importLegacyCacheImpl = async () => {
  if (await getMeta('legacyCacheImported', false)) return;
  // Import dinamico a proposito: motorOffline.js (y con el localforage que trae)
  // solo se necesita la primera vez, para traer el cache de la version anterior.
  const { leerBoveda } = await import('../motorOffline.js');
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
    await setMeta('legacyCacheImported', true);
    console.warn('[migracion] no se pudo importar el cache antiguo; se marcara como hecho:', error);
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

  const cedulasVivas = new Set(
    consultations.filter(c => !archivada(c)).map(c => normalizeCedula(c.cedula)).filter(Boolean)
  );
  const soloArchivadas = consultations
    .filter(c => archivada(c))
    .map(c => normalizeCedula(c.cedula))
    .filter(cedula => cedula && !cedulasVivas.has(cedula));

  const cedulasArchivadas = new Set([
    ...(await getMeta('cedulasArchivadas', [])).map(normalizeCedula),
    ...(await getMeta('cedulasArchivadasServidor', [])).map(normalizeCedula),
    ...soloArchivadas
  ].filter(Boolean));

  const patientById = new Map(patients.map(row => [row.id, row]));
  const saleByConsultation = new Map(sales.filter(row => row.consultationId).map(row => [row.consultationId, row]));
  const itemsBySale = new Map();
  items.forEach(item => itemsBySale.set(item.saleId, [...(itemsBySale.get(item.saleId) || []), item]));
  const paymentsBySale = new Map();
  payments.forEach(payment => paymentsBySale.set(payment.saleId, [...(paymentsBySale.get(payment.saleId) || []), payment]));

  // Todas las consultas clínicas locales reales (CON FECHA Y HORA COMPLETAS)
  const localHistorial = consultations
    .filter(row => !row.archivedAt && !row.archived_at)
    .filter(row => {
      const cedula = normalizeCedula(row.cedula);
      return !(cedula && cedulasArchivadas.has(cedula));
    })
    .map(consultation => {
      const patient = patientById.get(consultation.patientId) || {};
      const sale = saleByConsultation.get(consultation.id) || null;
      const salePayments = sale ? (paymentsBySale.get(sale.id) || []) : [];
      const ventaAnulada = Boolean(sale) && safeString(sale.estado).trim() === 'Anulado';
      const abonoCalculado = sale 
        ? safeNum(sale.abono || salePayments.reduce((sum, payment) => sum + safeNum(payment.monto), 0)) 
        : 0;
      const abono = ventaAnulada ? 0 : abonoCalculado;

      return {
        ...patient, ...consultation, ...(sale || {}),
        id: consultation.id, patient_id: patient.id, paciente_id: patient.id,
        pedido_id: sale?.id || '', fecha_venta: sale?.fecha || null,
        fecha: consultation.fecha || sale?.fecha || nowIso().slice(0, 10),
        abono: String(abono || 0), syncStatus: sale?.syncStatus || consultation.syncStatus || 'synced'
      };
    });

  const archivadasLocales = new Set(consultations.filter(c => archivada(c)).map(c => String(c.id)));
  const remoteHistorial = cache
    .filter(row => row.kind === 'historial' && !archivada(row))
    .filter(row => !archivadasLocales.has(String(row.id).replace(/^remote:/, '')))
    .filter(row => {
      const cedula = normalizeCedula(row.cedula);
      return !(cedula && cedulasArchivadas.has(cedula));
    })
    .map(row => {
      const data = { ...row };
      delete data.kind;
      delete data.updatedAt;
      data.syncStatus = 'synced';
      if (!safeString(data.pedido_id).trim() && safeNum(data.venta) <= 0) {
        data.estado = 'Ninguno';
      }
      return data;
    });

  // Orden estrictamente cronológico descendente (las consultas más recientes primero)
  const combined = [...localHistorial, ...remoteHistorial].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

  return {
    // Entregamos el array COMPLETO de todas las consultas históricas
    historial: combined,
    cedulasArchivadas: [...cedulasArchivadas],
    ventasArchivadas: sales
      .map(venta => ({ venta, patient: patientById.get(venta.patientId) || {} }))
      .filter(({ patient }) => {
        const cedula = normalizeCedula(patient.cedula);
        return cedula && cedulasArchivadas.has(cedula);
      })
      .map(({ venta, patient }) => ({
        ...patient,
        ...venta,
        id: venta.id,
        pedido_id: venta.pedido_id || venta.id,
        patient_id: patient.id,
        paciente_id: patient.id,
        cedula: patient.cedula,
        nombre: patient.nombre,
        fecha: venta.fecha,
        _pacienteArchivado: true
      })),
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

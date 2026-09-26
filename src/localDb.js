import Dexie from 'dexie';

export const localDb = new Dexie('vermas-local');

localDb.version(2).stores({
  patients: 'id,cedula,updatedAt,syncStatus',
  consultations: 'id,patientId,fecha,updatedAt,syncStatus',
  sales: 'id,patientId,consultationId,fecha,updatedAt,syncStatus,version',
  saleItems: 'id,saleId,inventoryId,[saleId+inventoryId]',
  payments: 'id,saleId,idempotencyKey,createdAt,syncStatus',
  inventory: 'id,codigo,updatedAt,syncStatus',
  prices: 'id,updatedAt,syncStatus',
  inventoryMovements: 'id,saleId,inventoryId,operationId,createdAt,syncStatus',
  outbox: 'id,type,entityId,status,createdAt,[status+createdAt]',
  meta: 'key',
  cache: 'id,kind,updatedAt',
  // Binarios pendientes de subir (comprobantes de pago, fotos de producto).
  // Se guardan como Blob para que la foto no se pierda al trabajar sin
  // conexion; el motor de sincronizacion los sube cuando vuelve la red.
  attachments: 'id,refType,refId,status,createdAt,[status+createdAt]'

});

export const LOCAL_DB_NAME = 'vermas-local';

export const nowIso = () => new Date().toISOString();

export const createUuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.random() * 16 | 0;
    return (char === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
  });
};

export const pendingRecord = (record, extra = {}) => ({
  ...record,
  updatedAt: nowIso(),
  syncStatus: 'pending',
  ...extra
});

export const syncedRecord = (record, extra = {}) => ({
  ...record,
  updatedAt: nowIso(),
  syncStatus: 'synced',
  ...extra
});

export const createOutboxOperation = ({ type, entityId, payload, baseVersion = 0 }) => ({
  id: createUuid(),
  type,
  entityId,
  payload,
  baseVersion,
  status: 'pending',
  attempts: 0,
  lastError: null,
  createdAt: nowIso()
});

export const getMeta = (key, fallback = null) => localDb.meta.get(key).then(row => row?.value ?? fallback);
export const setMeta = (key, value) => localDb.meta.put({ key, value, updatedAt: nowIso() });

export const requestPersistentStorage = async () => {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
};

export const resetLocalDatabase = async () => {
  await localDb.delete();
  await localDb.open();
};

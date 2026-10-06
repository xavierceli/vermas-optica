import Dexie from 'dexie';

export const localDb = new Dexie('vermas-local');

// Versión 2 del esquema local con soporte para archivado, colas y adjuntos binarios
localDb.version(2).stores({
  patients: 'id,cedula,updatedAt,syncStatus',
  consultations: 'id,patientId,fecha,updatedAt,syncStatus,archived_at',
  sales: 'id,patientId,consultationId,fecha,updatedAt,syncStatus,version',
  saleItems: 'id,saleId,inventoryId,[saleId+inventoryId]',
  payments: 'id,saleId,idempotencyKey,createdAt,syncStatus',
  inventory: 'id,codigo,updatedAt,syncStatus',
  prices: 'id,updatedAt,syncStatus',
  inventoryMovements: 'id,saleId,inventoryId,operationId,createdAt,syncStatus',
  outbox: 'id,type,entityId,status,createdAt,updatedAt,[status+createdAt]',
  meta: 'key',
  cache: 'id,kind,updatedAt',
  // Binarios locales (comprobantes de pago y fotos de armazones)
  attachments: 'id,refType,refId,status,createdAt,[status+createdAt]'
});

export const nowIso = () => new Date().toISOString();

/**
 * Generador de UUID v4 estándar (RFC 4122).
 * Prioriza crypto.randomUUID y utiliza crypto.getRandomValues como fallback seguro.
 */
export const createUuid = () => {
  const cryptoObj = globalThis.crypto || globalThis.msCrypto;

  if (typeof cryptoObj?.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  if (typeof cryptoObj?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);

    // Ajuste de versión 4 (0100) y variante RFC 4122 (10xx)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Fallback final para navegadores heredados sin WebCrypto
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = (Date.now() + Math.random() * 16) % 16 | 0;
    return (char === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
  });
};

export const pendingRecord = (record, extra = {}) => ({
  ...record,
  updatedAt: nowIso(),
  syncStatus: 'pending',
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
  createdAt: nowIso(),
  updatedAt: nowIso()
});

export const getMeta = (key, fallback = null) => 
  localDb.meta.get(key).then(row => row?.value ?? fallback);

export const setMeta = (key, value) => 
  localDb.meta.put({ key, value, updatedAt: nowIso() });

export const requestPersistentStorage = async () => {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
};

export const resetLocalDatabase = async () => {
  try {
    localDb.close();
  } catch {
    /* Silencioso */
  }
  await localDb.delete();
  await localDb.open();
};
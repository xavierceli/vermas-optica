// ---------------------------------------------------------------------------
// BASE COMPARTIDA DEL REPOSITORIO LOCAL
// ---------------------------------------------------------------------------
// Utilidades y helpers que usan varios modulos del repositorio (ventas,
// consultas, catalogos, lectura y adjuntos). Vive aparte para que ninguno
// dependa del otro solo por un `safeString`.
//
// El comportamiento es EXACTAMENTE el que tinha todo en localRepository.js:
// no se cambio ni una linea de logica, solo se movio a este archivo.
// ---------------------------------------------------------------------------

import { localDb } from '../localDb.js';

export const safeString = value => {
  if (value === null || value === undefined) return '';
  try {
    return String(value);
  } catch {
    return '';
  }
};

export const safeNum = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeCedula = value => safeString(value).trim().toUpperCase();

export const archivada = fila => Boolean(fila?.archivedAt || fila?.archived_at);

export const numericId = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Busca una ficha por id y, si no hay, por cedula normalizada. */
export const findPatient = (patientId, cedula) => {
  if (patientId) return localDb.patients.get(patientId);
  if (cedula) return localDb.patients.toArray().then(rows => rows.find(row => normalizeCedula(row.cedula) === normalizeCedula(cedula)) || null);
  return Promise.resolve(null);
};

/** Indice en memoria del inventario: buscar por id o por codigo sin recorrerlo. */
export const buildInventoryIndex = rows => ({
  byId: new Map(rows.map(row => [Number(row.id), row])),
  byCode: new Map(rows.filter(row => row.codigo).map(row => [safeString(row.codigo).trim().toUpperCase(), row]))
});

/** Fecha y hora locales como texto: "2026-10-04 14:30". */
export const fechaHoraActual = () => {
  const d = new Date();
  const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${fecha} ${hora}`;
};

/** Los campos del perfil del paciente que viajan al servidor. */
export const patientPayload = patient => ({
  id: patient.id,
  cedula: normalizeCedula(patient.cedula),
  nombre: safeString(patient.nombre),
  alias: safeString(patient.alias) || null,
  telefono: safeString(patient.telefono) || null,
  correo: safeString(patient.correo) || null,
  fecha_nacimiento: safeString(patient.fecha_nacimiento) || null,
  antecedentes: safeString(patient.antecedentes) || null
});

/** La consulta clinica sin los campos que son solo internos del dispositivo. */
export const consultationPayload = consultation => {
  const payload = { ...consultation };
  ['id', 'patientId', 'syncStatus', 'updatedAt', 'archivedAt', 'archived_at'].forEach(key => delete payload[key]);
  return payload;
};

let contadorEscaneosInventario = 0;
export const obtenerContadorEscaneosInventario = () => contadorEscaneosInventario;

/** Busca un producto por codigo, usando el indice si se le pasa. */
export const findInventoryByCode = (code, index) => {
  if (index) return index.byCode.get(safeString(code).trim().toUpperCase()) || null;
  contadorEscaneosInventario += 1;
  return localDb.inventory.toArray().then(rows => rows.find(row => safeString(row.codigo).trim().toUpperCase() === safeString(code).trim().toUpperCase()));
};

/** Resuelve un item (por id o por codigo) contra el inventario local. */
export const locateInventory = async (item, inventoryIndex = null) => {
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

/**
 * Los productos de una venta, normalizados.
 * Si la venta trae `items` se usan tal cual; si no, se deducen del armazon y del
 * accesorio. El armazon "2905" significa "del paciente": no entra al inventario.
 */
export const deriveItems = async sale => {
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

/** Fila de la bitacora de movimientos de inventario. */
export const movementRecord = ({ operationId, saleId, inventoryId, type, quantity, createUuid, nowIso }) => ({
  id: createUuid(),
  operationId,
  saleId,
  inventoryId,
  type,
  quantity,
  syncStatus: 'pending',
  createdAt: nowIso()
});
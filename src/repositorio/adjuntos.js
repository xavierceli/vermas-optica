// ---------------------------------------------------------------------------
// ADJUNTOS: COMPROBANTES DE PAGO Y FOTOS
// ---------------------------------------------------------------------------
// Los archivos binarios (comprobantes y fotografias) se guardan en IndexedDB y
// suben al servidor despues. El nombre del archivo se limpia antes de usarlo
// como ruta para no llevar espacios ni caracteres raros al almacenamiento.
// Codigo movido tal cual desde localRepository.js.
// ---------------------------------------------------------------------------
import { localDb, createUuid, nowIso, createOutboxOperation } from '../localDb.js';
import { safeString } from './base.js';

export const sanitizeNombre = nombre => safeString(nombre).replace(/[^a-zA-Z0-9.]/g, '').slice(-40) || 'archivo.jpg';

export const guardarAdjuntoLocalImpl = async ({ blob, nombre = 'archivo.jpg', mime = 'image/jpeg', bucket, refType, refId }) => {
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

export const leerAdjuntoLocalImpl = async adjuntoId => {
  const adjunto = await localDb.attachments.get(adjuntoId);
  return adjunto?.blob || null;
};

export const obtenerAdjuntosDeRefImpl = async refId => localDb.attachments.where('refId').equals(refId).toArray();

export const contarAdjuntosPendientesImpl = async () => localDb.attachments.where('status').notEqual('uploaded').count();

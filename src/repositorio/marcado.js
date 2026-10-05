// ---------------------------------------------------------------------------
// MARCADO DE OPERACIONES SINCRONIZADAS
// ---------------------------------------------------------------------------
// Cuando el servidor confirma una operacion, sus filas locales pasan de
// 'pending' a 'synced'. De ahi depende que la siguiente descarga del servidor
// pueda sobrescribirlas sin pisar trabajo sin terminar.
// Codigo movido tal cual desde localRepository.js.
// ---------------------------------------------------------------------------
import { localDb, nowIso } from '../localDb.js';

export const markLocalOperationSyncedImpl = async operation => {
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

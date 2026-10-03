import { supabase } from './supabaseClient';
import { localDb, nowIso, requestPersistentStorage } from './localDb';
import { cacheServerCatalog, cacheServerHistorial, enColaEscritura, markLocalOperationSynced } from './localRepository';
import { paginarConsulta } from './paginacion';
import { esFalloDeRed } from './reglas';

// Topes de paginación declarados al inicio para evitar valores indefinidos
const TAMPAGINA_HISTORIAL = 200;
const MAX_PAGINAS_HISTORIAL = 25;
const TIEMPO_LIMITE_MS = 10000;
const DIAS_RETENCION_DESCARTADAS = 7;
const MAX_INTENTOS = 5;
const TIEMPO_ESPERA_BASE_MS = 15000;

let running = false;
let started = false;
let intervalId = null;
let unsubscribeFocus = null;
const listeners = new Set();

const initialStatus = {
  phase: 'idle',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  conflicts: 0,
  descartadas: 0,
  lastSync: null,
  lastError: null,
  historialParcial: false,
  historialDescargadas: 0,
  historialTope: TAMPAGINA_HISTORIAL * MAX_PAGINAS_HISTORIAL
};

let status = { ...initialStatus };
let sesionAusente = false;

const esFalloDeSesion = error => {
  if (!error) return false;
  const codigo = String(error.code || '');
  return error.status === 401
    || error.status === 403
    || codigo === '42501'
    || codigo.startsWith('PGRST301');
};

const conTimeout = (promesa, ms, etiqueta) => {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`Tiempo agotado (${ms / 1000}s) en ${etiqueta}`)), ms);
  });

  return Promise.race([promesa, timeoutPromise]).finally(() => {
    if (timerId) clearTimeout(timerId);
  });
};

export const fijarSesionAusente = activa => {
  sesionAusente = Boolean(activa);
  if (sesionAusente) {
    status.online = false;
    status.phase = 'offline';
  } else {
    status.online = typeof navigator === 'undefined' ? true : navigator.onLine;
    status.phase = status.pending > 0 ? 'pending' : 'synced';
  }
  emit();
};

const emit = () => {
  status = { ...status };
  listeners.forEach(listener => listener(status));
};

const purgarDescartadas = async () => {
  const limite = Date.now() - DIAS_RETENCION_DESCARTADAS * 24 * 60 * 60 * 1000;
  const viejas = await localDb.outbox.where('status').equals('descartada').toArray();
  const aBorrar = viejas.filter(op => new Date(op.updatedAt || op.createdAt).getTime() < limite);
  if (aBorrar.length === 0) return 0;
  await localDb.outbox.bulkDelete(aBorrar.map(op => op.id));
  return aBorrar.length;
};

const refrescarItemsDeVenta = async operation => {
  if (operation.type !== 'CREAR_VENTA' && operation.type !== 'EDITAR_VENTA') return operation;
  const items = await localDb.saleItems.where('saleId').equals(operation.entityId).toArray();
  const resueltos = items
    .filter(item => item?.inventoryId !== null && item?.inventoryId !== undefined)
    .map(item => ({ inventario_id: item.inventoryId, codigo: null, cantidad: Math.max(1, Number(item.quantity) || 1) }));
  
  const actuales = operation?.payload?.p_payload?.items || [];
  if (JSON.stringify(actuales) === JSON.stringify(resueltos)) return operation;

  const actualizado = {
    ...operation,
    attempts: 0,
    status: 'pending',
    lastError: null,
    payload: { ...operation.payload, p_payload: { ...operation.payload.p_payload, items: resueltos } }
  };
  await localDb.outbox.put(actualizado);
  return actualizado;
};

const marcarPendientePorRed = async operation => {
  await localDb.outbox.put({
    ...operation,
    status: 'pending',
    lastError: null,
    updatedAt: nowIso()
  });
  status.online = false;
  status.phase = 'offline';
};

const RECHAZO_PERMANENTE = [
  'Item de venta inválido', 'Item de venta invalido',
  'Stock insuficiente', 'violates check constraint', 'duplicate key',
  'foreign key', 'violates foreign key', '23503', 'no existe'
];

const esRechazoPermanente = motivo => {
  const texto = String(motivo || '').toLowerCase();
  return RECHAZO_PERMANENTE.some(marca => texto.includes(marca.toLowerCase()));
};

const refreshCounts = async () => {
  const operations = await localDb.outbox.toArray();
  status.pending = operations.filter(row => row.status === 'pending' || row.status === 'failed').length;
  status.conflicts = operations.filter(row => row.status === 'conflict').length;
  status.fallos = operations
    .filter(row => row.status === 'failed' || row.status === 'conflict')
    .map(row => ({ tipo: row.type, motivo: row.lastError || 'Sin detalle del servidor', estado: row.status }));
  status.descartadas = operations.filter(row => row.status === 'descartada').length;
};

const subscribe = listener => {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
};

export const obtenerDetalleCola = async () => {
  const operaciones = await localDb.outbox.orderBy('createdAt').toArray();
  return operaciones.map(op => ({
    id: op.id,
    tipo: op.type,
    entidad: op.entityId,
    estado: op.status,
    intentos: op.attempts || 0,
    motivo: op.lastError || null,
    creada: op.createdAt
  }));
};

export const reintentarOperacion = async (operationId) => {
  await localDb.outbox.update(operationId, {
    status: 'pending', lastError: null, attempts: 0, updatedAt: nowIso()
  });
  await refreshCounts();
  emit();
  return sincronizarAhora({ pull: false });
};

export const descartarOperacion = async (operationId) => {
  await localDb.outbox.delete(operationId);
  await refreshCounts();
  emit();
  return obtenerDetalleCola();
};

export const descartarTodoLoAtascado = async () => {
  const atascadas = await localDb.outbox
    .filter(row => row.status === 'failed' || row.status === 'conflict' || row.status === 'descartada')
    .primaryKeys();
  if (atascadas.length > 0) await localDb.outbox.bulkDelete(atascadas);
  await refreshCounts();
  emit();
  return atascadas.length;
};

const markOperation = async (operation, nextStatus, error = null) => {
  await localDb.outbox.update(operation.id, {
    status: nextStatus,
    lastError: error,
    attempts: (operation.attempts || 0) + 1,
    updatedAt: nowIso()
  });
};

const reconciliarStockVenta = async serverResult => {
    const ids = (serverResult?.items || [])
    // El servidor devuelve cada producto como inventario_id (crear) o inventory_id (editar).
    .map(item => Number(item.inventario_id ?? item.inventory_id))
    .filter(Number.isFinite);
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from('inventario')
    .select('id,stock')
    .in('id', [...new Set(ids)]);
  if (error) return;

  await enColaEscritura(async () => {
    for (const row of data || []) {
      const local = await localDb.inventory.get(row.id);
      if (local) await localDb.inventory.put({ ...local, stock: Number(row.stock), syncStatus: 'synced', updatedAt: nowIso() });
    }
  }, 'bajo');
};

const finalizarOperacion = async (operation, estadoFinal, motivo) => {
  await markOperation(operation, estadoFinal, motivo);
};

const aplicarBackoff = async operation => {
  const intentos = operation.attempts || 0;
  if (intentos <= 0) return true;
  const espera = Math.min(TIEMPO_ESPERA_BASE_MS * (2 ** (intentos - 1)), 5 * 60 * 1000);
  const transcurrido = Date.now() - new Date(operation.updatedAt || operation.createdAt).getTime();
  return transcurrido >= espera;
};

const applyResults = async results => {
  const fallos = [];
  for (const result of results || []) {
    const operation = await localDb.outbox.get(result.id);
    if (!operation) continue;

    if (result.status === 'applied' || result.status === 'synced') {
      const serverResult = result.result || {};
      if (operation.type === 'CREAR_VENTA' || operation.type === 'EDITAR_VENTA') {
        await reconciliarStockVenta(serverResult);
      }
      if (operation.type === 'UPSERT_INVENTARIO' && serverResult.inventario) {
        const serverId = Number(serverResult.servidor_id);
        if (Number(operation.entityId) !== serverId) {
          await enColaEscritura(async () => {
            await localDb.saleItems.where('inventoryId').equals(operation.entityId).modify({ inventoryId: serverId });
            await localDb.inventoryMovements.where('inventoryId').equals(operation.entityId).modify({ inventoryId: serverId });
            await localDb.inventory.delete(operation.entityId);
            await localDb.inventory.put({ ...serverResult.inventario, syncStatus: 'synced', updatedAt: nowIso() });
          }, 'bajo');
        } else {
          await enColaEscritura(
            () => localDb.inventory.put({ ...serverResult.inventario, syncStatus: 'synced', updatedAt: nowIso() }),
            'bajo'
          );
        }
      } else if (operation.type === 'UPSERT_PRECIO' && serverResult.precio) {
        const serverId = Number(serverResult.servidor_id);
        await enColaEscritura(async () => {
          if (Number(operation.entityId) !== serverId) await localDb.prices.delete(operation.entityId);
          await localDb.prices.put({ ...serverResult.precio, syncStatus: 'synced', updatedAt: nowIso() });
        }, 'bajo');
      } else {
        await markLocalOperationSynced(operation);
        if (operation.type === 'EDITAR_VENTA' && serverResult.version) {
          const sale = await localDb.sales.get(operation.entityId);
          if (sale) await localDb.sales.put({ ...sale, version: Number(serverResult.version), syncStatus: 'synced' });
        }
      }
      await localDb.outbox.delete(operation.id);
    } else if (result.status === 'conflict') {
      await finalizarOperacion(operation, 'conflict', result.error || 'Conflicto de datos');
      fallos.push({ tipo: operation.type, motivo: result.error || 'Conflicto de datos', estado: 'conflict' });
    } else {
      const motivo = result.error || 'La operación fue rechazada por el servidor';

      if (esFalloDeRed(motivo)) {
        await marcarPendientePorRed(operation);
        continue;
      }

      const esArchivoDeConsultaInexistente =
        operation.type === 'ARCHIVAR_CONSULTA' &&
        /no existe/i.test(motivo);

      if (esArchivoDeConsultaInexistente) {
        await finalizarOperacion(operation, 'descartada',
          'La consulta nunca se sincronizó: no había nada que archivar en el servidor.');
        await markLocalOperationSynced(operation).catch(() => {});
        await localDb.outbox.delete(operation.id);
        continue;
      }

      const intentos = (operation.attempts || 0) + 1;
      if (intentos >= MAX_INTENTOS || esRechazoPermanente(motivo)) {
        await finalizarOperacion(operation, 'descartada',
          `${motivo} (no se reintenta: dato inválido o inexistente en servidor)`);
        fallos.push({
          tipo: operation.type,
          motivo: `${motivo}. Descartada: revisar los datos antes de reintentarlo.`,
          estado: 'descartada'
        });
      } else {
        await markOperation(operation, 'failed', motivo);
        fallos.push({ tipo: operation.type, motivo, estado: 'failed', intentos });
      }
    }
  }
  status.fallos = fallos;
  return fallos;
};

const subirAdjuntosPendientes = async () => {
  const operaciones = (await localDb.outbox.orderBy('createdAt').toArray())
    .filter(row => row.type === 'SUBIR_ADJUNTO' && (row.status === 'pending' || row.status === 'failed'));
  if (operaciones.length === 0) return;

  for (const operacion of operaciones) {
    const adjunto = await localDb.attachments.get(operacion.entityId);
    if (!adjunto) {
      await localDb.outbox.delete(operacion.id);
      continue;
    }
    try {
      const { error } = await conTimeout(
        supabase.storage
          .from(adjunto.bucket)
          .upload(adjunto.ruta, adjunto.blob, { contentType: adjunto.mime, upsert: true }),
        TIEMPO_LIMITE_MS,
        'subir adjunto'
      );
      if (error) throw new Error(error.message);
      await localDb.attachments.put({ ...adjunto, status: 'uploaded', lastError: null, updatedAt: nowIso() });
      await localDb.outbox.delete(operacion.id);
    } catch (error) {
      const mensaje = error?.message || 'No se pudo subir el archivo';
      await markOperation(operacion, 'failed', mensaje);
      await localDb.attachments.put({ ...adjunto, status: 'failed', lastError: mensaje, updatedAt: nowIso() });
    }
  }
};

// Descargamos TODAS las consultas históricas, NO solo los pacientes únicos
const descargarHistorialPaginado = async () => {
  const { filas, paginasDescargadas } = await paginarConsulta({
    pageSize: TAMPAGINA_HISTORIAL,
    maxPaginas: MAX_PAGINAS_HISTORIAL,
    fetchPagina: async (desde, limite) => {
      // Usamos vista_pacientes para traer TODAS las consultas de cada paciente
      const { data, error } = await supabase
        .from('vista_pacientes')
        .select('*')
        .order('fecha', { ascending: false })
        .order('id', { ascending: false })
        .range(desde, desde + limite - 1);
      if (error) throw error;
      return data || [];
    }
  });
  return { filas, paginasDescargadas };
};

const leerCedulasArchivadasDelServidor = async () => {
  try {
    const soloVivas = await supabase
      .from('consultas_clinicas')
      .select('paciente_id')
      .is('archived_at', null);
    if (soloVivas.error) throw soloVivas.error;

    const { data: archivadas, error: errorArchivadas } = await supabase
      .from('consultas_clinicas')
      .select('paciente_id')
      .not('archived_at', 'is', null);
    if (errorArchivadas) throw errorArchivadas;

    const conConsultaViva = new Set((soloVivas.data || []).map(r => String(r.paciente_id ?? '')));
    const idsArchivados = [...new Set((archivadas || [])
      .map(r => String(r.paciente_id ?? ''))
      .filter(id => id && !conConsultaViva.has(id)))];
    
    if (idsArchivados.length === 0) {
      await localDb.meta.put({ key: 'cedulasArchivadasServidor', value: [], updatedAt: nowIso() });
      return;
    }

    const { data: pacientes, error: errorPacientes } = await supabase
      .from('pacientes_perfil')
      .select('cedula')
      .in('id', idsArchivados);
    if (errorPacientes) throw errorPacientes;

    const lista = [...new Set((pacientes || [])
      .map(row => String(row?.cedula ?? '').trim().toUpperCase())
      .filter(Boolean))];
    await localDb.meta.put({ key: 'cedulasArchivadasServidor', value: lista, updatedAt: nowIso() });
  } catch (e) {
    console.warn('[sync] No se pudieron sincronizar las cédulas archivadas del servidor:', e?.message || e);
  }
};

const pullServerCache = async () => {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const results = await conTimeout(Promise.allSettled([
    supabase.from('inventario').select('*').order('id', { ascending: false }),
    supabase.from('lista_precios').select('*').order('id', { ascending: false })
  ]), TIEMPO_LIMITE_MS, 'pull de catalogo');
  const [inventoryResult, pricesResult] = results.map(result =>
    result.status === 'fulfilled' ? result.value : { data: null, error: result.reason }
  );

  if (inventoryResult.error) throw inventoryResult.error;
  if (pricesResult.error) console.warn('Tarifario local no actualizado:', pricesResult.error.message);

  let historialRows = [];
  try {
    const descargado = await descargarHistorialPaginado();
    historialRows = descargado.filas;
    status.historialDescargadas = descargado.filas.length;
    status.historialParcial = descargado.paginasDescargadas >= MAX_PAGINAS_HISTORIAL;
  } catch (error) {
    console.warn('Historial local no actualizado:', error?.message || error);
  }

  await leerCedulasArchivadasDelServidor();
  await cacheServerHistorial(historialRows);
  await cacheServerCatalog({ inventory: inventoryResult.data || [], prices: pricesResult.data || [] });
  
};

export const sincronizarAhora = async ({ pull = true } = {}) => {
  if (running) { await refreshCounts(); emit(); return status; }
  running = true;
  status.phase = 'syncing';
  status.lastError = null;
  status.fallos = [];
  status.sesionInvalida = false;
  emit();

  try {
    await requestPersistentStorage();
    await purgarDescartadas();
    await refreshCounts();
    if (status.online === false) {
      status.phase = 'offline';
      emit();
      return status;
    }

    await subirAdjuntosPendientes();
    await refreshCounts();

    const candidatas = (await localDb.outbox.orderBy('createdAt').toArray())
      .filter(row => (row.status === 'pending' || row.status === 'failed') && row.type !== 'SUBIR_ADJUNTO');
    const operations = [];
    for (const row of candidatas) {
      if (await aplicarBackoff(row)) operations.push(await refrescarItemsDeVenta(row));
    }

    for (let index = 0; index < operations.length; index += 20) {
      const batch = operations.slice(index, index + 20);
      if (batch.length === 0) continue;
      const { data, error } = await conTimeout(
        supabase.rpc('aplicar_operaciones', { p_operaciones: batch }),
        TIEMPO_LIMITE_MS,
        'aplicar_operaciones'
      );
      if (error) throw error;
      await applyResults(data?.results || []);
      await refreshCounts();
    }

    if (pull) await pullServerCache();
    status.lastSync = nowIso();
    if (!sesionAusente) status.online = true;
    status.phase = status.pending > 0 ? 'pending' : 'synced';
    emit();
  } catch (error) {
    if (esFalloDeRed(error) && !sesionAusente) {
      status.online = false;
      status.phase = 'offline';
    } else {
      status.phase = status.online === false ? 'offline' : 'error';
    }
    status.lastError = error?.message || String(error);
    if (esFalloDeSesion(error)) {
      status.sesionInvalida = true;
      status.lastError = 'Tu sesión expiró. Inicia sesión nuevamente para sincronizar.';
    }
    await refreshCounts();
    emit();
  } finally {
    running = false;
  }
  return status;
};

export const iniciarMotorSync = () => {
  if (started || typeof window === 'undefined') return;
  started = true;
  const onOnline = () => {
    if (!sesionAusente) status.online = true;
    emit();
    void sincronizarAhora();
  };
  const onOffline = () => {
    status.online = false;
    status.phase = 'offline';
    emit();
  };
  const onFocus = () => { void sincronizarAhora({ pull: false }); };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('focus', onFocus);
  unsubscribeFocus = () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('focus', onFocus);
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    started = false;
  };
  intervalId = window.setInterval(() => { void sincronizarAhora({ pull: false }); }, 30000);
  void sincronizarAhora();
};

export const detenerMotorSync = () => {
  if (unsubscribeFocus) unsubscribeFocus();
};

export const suscribirSync = subscribe;
export { pullServerCache };

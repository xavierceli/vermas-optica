import { supabase } from './supabaseClient';
import { localDb, nowIso, requestPersistentStorage } from './localDb';
import { cacheServerCatalog, cacheServerHistorial, markLocalOperationSynced } from './localRepository';
import { paginarConsulta } from './paginacion';

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
  lastSync: null,
  lastError: null
};
let status = { ...initialStatus };
// Cuando el usuario entra con el PIN local no hay token del servidor. La
// sincronizacion queda suspendida por mucho que haya conexion.
let sesionAusente = false;

// Una sesion caducada hace que supabase-js envie las peticiones con el rol
// `anon`: el servidor responde 403 a las tablas y "Bucket not found" a Storage,
// sin avisar. Antes eso solo se veia en la consola; aqui lo detectamos para
// poder decirlo en la interfaz.
const esFalloDeSesion = error => {
  if (!error) return false;
  const codigo = String(error.code || '');
  const mensaje = String(error.message || '').toLowerCase();
  return error.status === 401 || error.status === 403 || codigo === '42501'
    || codigo.startsWith('PGRST30') || mensaje.includes('jwt')
    || mensaje.includes('token') || mensaje.includes('permission denied');
};

/**
 * Marca que no hay sesion del servidor. Mientras sea true, el motor se
 * considera offline: la Outbox se acumula y se subira al volver a entrar.
 */
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

const refreshCounts = async () => {
  const operations = await localDb.outbox.toArray();
  status.pending = operations.filter(row => row.status === 'pending' || row.status === 'failed').length;
  status.conflicts = operations.filter(row => row.status === 'conflict').length;
};

const subscribe = listener => {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
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
    .map(item => Number(item.inventory_id))
    .filter(Number.isFinite);
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from('inventario')
    .select('id,stock')
    .in('id', [...new Set(ids)]);
  if (error) return;
  for (const row of data || []) {
    const local = await localDb.inventory.get(row.id);
    if (local) await localDb.inventory.put({ ...local, stock: Number(row.stock), syncStatus: 'synced', updatedAt: nowIso() });
  }
};
const applyResults = async results => {
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
        if (operation.entityId !== serverId) {
          await localDb.saleItems.where('inventoryId').equals(operation.entityId).modify({ inventoryId: serverId });
          await localDb.inventoryMovements.where('inventoryId').equals(operation.entityId).modify({ inventoryId: serverId });
          await localDb.inventory.delete(operation.entityId);
        }
        await localDb.inventory.put({ ...serverResult.inventario, syncStatus: 'synced', updatedAt: nowIso() });
      } else if (operation.type === 'UPSERT_PRECIO' && serverResult.precio) {
        const serverId = Number(serverResult.servidor_id);
        if (operation.entityId !== serverId) await localDb.prices.delete(operation.entityId);
        await localDb.prices.put({ ...serverResult.precio, syncStatus: 'synced', updatedAt: nowIso() });
      } else {
        await markLocalOperationSynced(operation);
        if (operation.type === 'EDITAR_VENTA' && serverResult.version) {
          const sale = await localDb.sales.get(operation.entityId);
          if (sale) await localDb.sales.put({ ...sale, version: Number(serverResult.version), syncStatus: 'synced' });
        }
      }
      await localDb.outbox.delete(operation.id);
    } else if (result.status === 'conflict') {
      await markOperation(operation, 'conflict', result.error || 'Conflicto de datos');
    } else {
      await markOperation(operation, 'failed', result.error || 'La operación fue rechazada por el servidor');
    }
  }
};

// Los adjuntos NO viajan por aplicar_operaciones: ese RPC solo entiende
// comandos de base de datos, no subidas a Storage. Se procesan aparte y antes
// del lote, para que cuando se registre el pago la ruta apunte a un archivo
// que ya existe en el bucket.
const subirAdjuntosPendientes = async () => {
  const operaciones = (await localDb.outbox.orderBy('createdAt').toArray())
    .filter(row => row.type === 'SUBIR_ADJUNTO' && (row.status === 'pending' || row.status === 'failed'));
  if (operaciones.length === 0) return;

  for (const operacion of operaciones) {
    const adjunto = await localDb.attachments.get(operacion.entityId);
    if (!adjunto) {
      // El binario ya no esta (limpieza manual): la operacion ya no tiene sentido.
      await localDb.outbox.delete(operacion.id);
      continue;
    }
    try {
      const { error } = await supabase.storage
        .from(adjunto.bucket)
        .upload(adjunto.ruta, adjunto.blob, { contentType: adjunto.mime, upsert: true });
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

const TAMPAGINA_HISTORIAL = 200;
const MAX_PAGINAS_HISTORIAL = 25;

// Descarga el historial completo por paginas. El orden secondary por id es
// necesario: la vista usa DISTINCT ON y "fecha" no es unico, asi que sin un
// desempate estable una fila podria saltar entre paginas y perderse.
const descargarHistorialPaginado = async () => {
  const { filas, paginasDescargadas } = await paginarConsulta({
    pageSize: TAMPAGINA_HISTORIAL,
    maxPaginas: MAX_PAGINAS_HISTORIAL,
    fetchPagina: async (desde, limite) => {
      const { data, error } = await supabase
        .from('vista_pacientes_unicos')
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

const pullServerCache = async () => {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  // Catalogo, metricas y deudas van en paralelo; el historial va aparte porque
  // son varias peticiones encadenadas y no debe bloquear al resto.
  const results = await Promise.allSettled([
    supabase.from('inventario').select('*').order('id', { ascending: false }),
    supabase.from('lista_precios').select('*').order('id', { ascending: false }),
    supabase.rpc('deudas_pacientes'),
    supabase.rpc('stats_negocio')
  ]);
  const [inventoryResult, pricesResult, debtsResult, statsResult] = results.map(result =>
    result.status === 'fulfilled' ? result.value : { data: null, error: result.reason }
  );

  if (inventoryResult.error) throw inventoryResult.error;
  if (pricesResult.error) console.warn('No se pudo actualizar tarifario local:', pricesResult.error.message);

  let historialRows = [];
  try {
    const descargado = await descargarHistorialPaginado();
    historialRows = descargado.filas;
    if (descargado.paginasDescargadas >= MAX_PAGINAS_HISTORIAL) {
      console.warn(`Historial descargado hasta el tope de ${MAX_PAGINAS_HISTORIAL} paginas.`);
    }
  } catch (error) {
    // El historial no es critico: si falla, el catalogo debe seguir actualizandose.
    console.warn('No se pudo actualizar historial local:', error?.message || error);
  }

  await cacheServerHistorial(historialRows);
  await cacheServerCatalog({ inventory: inventoryResult.data || [], prices: pricesResult.data || [] });
  const remoteStats = statsResult.data?.[0] || null;
  const remoteDebts = debtsResult.data || [];
  await localDb.meta.put({ key: 'remoteStats', value: remoteStats, updatedAt: nowIso() });
  await localDb.meta.put({ key: 'remoteDebts', value: remoteDebts, updatedAt: nowIso() });
  return { stats: remoteStats, debts: remoteDebts };
};

export const sincronizarAhora = async ({ pull = true } = {}) => {
  if (running) { await refreshCounts(); emit(); return status; }
  running = true;
  status.phase = 'syncing';
  status.lastError = null;
  emit();

  try {
    await requestPersistentStorage();
    await refreshCounts();
    if (status.online === false) {
      status.phase = 'offline';
      emit();
      return status;
    }

    // Primero los adjuntos: son subidas a Storage, no comandos de base de datos.
    await subirAdjuntosPendientes();
    await refreshCounts();


    const operations = (await localDb.outbox.orderBy('createdAt').toArray())
      .filter(row => (row.status === 'pending' || row.status === 'failed') && row.type !== 'SUBIR_ADJUNTO');

    for (let index = 0; index < operations.length; index += 20) {
      const batch = operations.slice(index, index + 20);
      if (batch.length === 0) continue;
      const { data, error } = await supabase.rpc('aplicar_operaciones', {
        p_operaciones: batch
      });
      if (error) throw error;
      await applyResults(data?.results || []);
      await refreshCounts();
    }

    if (pull) await pullServerCache();
    status.lastSync = nowIso();
    status.phase = status.pending > 0 ? 'pending' : 'synced';
    emit();
  } catch (error) {
    status.phase = status.online === false ? 'offline' : 'error';
    status.lastError = error?.message || String(error);
    if (esFalloDeSesion(error)) {
      status.sesionInvalida = true;
      status.lastError = 'Tu sesion expiro. Vuelve a iniciar sesion para poder sincronizar.';
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
    // Con desbloqueo offline NO hay sesion del servidor: por mucha red que haya,
    // el dispositivo sigue sin poder sincronizar hasta que se vuelva a entrar.
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

export const obtenerEstadoSync = () => status;
export const suscribirSync = subscribe;
export { pullServerCache };

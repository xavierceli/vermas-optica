import { supabase } from './supabaseClient';
import { localDb, nowIso, requestPersistentStorage } from './localDb';
import { cacheServerCatalog, cacheServerHistorial, enColaEscritura, markLocalOperationSynced } from './localRepository';

// OJO, TRAMPA DE INTERBLOQUEO: markLocalOperationSynced y cacheServerHistorial
// YA pasan por la cola de escritura. Envolverlos aqui otra vez dejaria la cola
// esperando a si misma y TODO se quedaria colgado. Solo se encolan bloques que
// escriben directamente en localDb (ver test en avisos.test.js).
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
  // Operaciones que el servidor rechazo y que ya no se reintentan. No son
  // "pendientes": se muestran aparte para que el usuario sepa que se perdieron.
  descartadas: 0,
  lastSync: null,
  lastError: null,
  // El historial tiene tope de paginas para no descargarse la base entera. Si
  // se llega al tope, este equipo tiene una VISTA PARCIAL del historial: las
  // consultas mas antiguas siguen en la nube (se encuentran buscando por cedula
  // o nombre) pero no salen en la lista. Antes esto solo se avisaba por consola,
  // que el optometria no abre: parecia que el historial estaba completo.
  historialParcial: false,
  historialDescargadas: 0,
  historialTope: TAMPAGINA_HISTORIAL * MAX_PAGINAS_HISTORIAL
};
let status = { ...initialStatus };
// Cuando el usuario entra con el PIN local no hay token del servidor. La
// sincronizacion queda suspendida por mucho que haya conexion.
let sesionAusente = false;

// Una sesion caducada hace que supabase-js envie las peticiones con el rol
// `anon`: el servidor responde 403 a las tablas y "Bucket not found" a Storage,
// sin avisar. Antes eso solo se veia en la consola; aqui lo detectamos para
// poder decirlo en la interfaz.
//
// Solo se aceptan los codigos REALES de sesion/permisos. Antes bastaba con que
// el mensaje contuviera la palabra "token" y cualquier error de red con esa
// palabra (un timeout, un 502 de la CDN) se leia como "tu sesion expiro", que
// es una orientacion falsa para el usuario.
const esFalloDeSesion = error => {
  if (!error) return false;
  const codigo = String(error.code || '');
  return error.status === 401
    || error.status === 403
    || codigo === '42501'            // insufficient_privilege
    || codigo.startsWith('PGRST301'); // JWT ausente, caducado o invalido
};

// supabase-js NO aplica timeout por defecto: en una red movil degenerada (el caso
// real de uso de esta app) la peticion se queda colgada, el candado `running`
// nunca se libera y la app deja de sincronizar en silencio para siempre.
// Este tope convierte un cuelgue invisible en un reintento honesto.
const TIEMPO_LIMITE_MS = 10000;

const conTimeout = (promesa, ms, etiqueta) => Promise.race([
  promesa,
  new Promise((_, rechazar) => {
    const id = setTimeout(() => rechazar(new Error(`Tiempo agotado (${ms / 1000}s) en ${etiqueta}`)), ms);
    // No dejar el temporizador vivo si la peticion responde antes.
    promesa.then(() => clearTimeout(id), () => clearTimeout(id));
  })
]);

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

// Una operacion 'descartada' ya no esta pendiente de nada: no se reintentara y no
// debe contar como tal. Antes seguia dentro del conteo para siempre, que es
// justo lo que hacia que la app mostrara "21 pendientes" sin poder reducirlos.
// La outbox solo guarda operaciones vivas: lo que el servidor ya aplico se
// borra en applyResults. Las 'descartada' si se acumulan, y una tabla que crece
// sin limite hace que cada ciclo se lea entera de mas. Se conservan 7 dias para
// poder diagnosticar, y luego se purgan.
const DIAS_RETENcion_DESCARTADAS = 7;

const purgarDescartadas = async () => {
  const limite = Date.now() - DIAS_RETENcion_DESCARTADAS * 24 * 60 * 60 * 1000;
  const viejas = await localDb.outbox.where('status').equals('descartada').toArray();
  const aBorrar = viejas.filter(op => new Date(op.updatedAt || op.createdAt).getTime() < limite);
  if (aBorrar.length === 0) return 0;
  await localDb.outbox.bulkDelete(aBorrar.map(op => op.id));
  return aBorrar.length;
};

const refreshCounts = async () => {
  const operations = await localDb.outbox.toArray();
  status.pending = operations.filter(row => row.status === 'pending' || row.status === 'failed').length;
  status.conflicts = operations.filter(row => row.status === 'conflict').length;
  // Los fallos se reconstruyen desde la cola en cada conteo: asi sobreviven a un
  // reinicio de la app y el usuario ve el motivo real de cada rechazo, no solo el
  // del ultimo ciclo.
  status.fallos = operations
    .filter(row => row.status === 'failed' || row.status === 'conflict')
    .map(row => ({ tipo: row.type, motivo: row.lastError || 'Sin detalle del servidor', estado: row.status }));
  // Las descartadas ya no son pendientes: se cuentan aparte para poder avisar.
  status.descartadas = operations.filter(row => row.status === 'descartada').length;
};

const subscribe = listener => {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
};

// ---------------------------------------------------------------------------
// ACCIONES DESDE LA INTERFAZ
// ---------------------------------------------------------------------------
// Antes, resolver una operacion atascada exigia abrir la consola del navegador y
// escribir un script a mano. Eso no es una solucion: cualquier operacion que el
// servidor rechazara por una causa permanente dejaba la barra roja puesta para
// siempre y el usuario no tenia ninguna salida sin conocimientos tecnicos.
// Estas funciones le dan al boton de la barra algo real que hacer.

/** Detalle completo de la cola, para mostrarlo en un panel. */
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

/** Reintentar una operacion ahora: vuelve a la cola y se sincroniza. */
export const reintentarOperacion = async (operationId) => {
  await localDb.outbox.update(operationId, {
    status: 'pending', lastError: null, attempts: 0, updatedAt: nowIso()
  });
  await refreshCounts();
  emit();
  return sincronizarAhora({ pull: false });
};

/**
 * Descartar una operacion. Borra SOLO la fila de la cola: el paciente, la venta
 * y el inventario no se tocan. La operacion simplemente no se enviara.
 */
export const descartarOperacion = async (operationId) => {
  await localDb.outbox.delete(operationId);
  await refreshCounts();
  emit();
  return obtenerDetalleCola();
};

/** Descartar todas las atascadas (fallidas, en conflicto o ya descartadas). */
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
    .map(item => Number(item.inventory_id))
    .filter(Number.isFinite);
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from('inventario')
    .select('id,stock')
    .in('id', [...new Set(ids)]);
  if (error) return;
  // Lee, MODIFICA y escribe el stock de productos que el usuario puede estar
  // editando a la vez. Sin la cola, un cambio de precio hecho por el optometria
  // en ese instante se pierde: se sobrescribe con el valor viejo del servidor.
  await enColaEscritura(async () => {
    for (const row of data || []) {
      const local = await localDb.inventory.get(row.id);
      if (local) await localDb.inventory.put({ ...local, stock: Number(row.stock), syncStatus: 'synced', updatedAt: nowIso() });
    }
  }, 'bajo');
};
const MAX_INTENTOS = 5;
const TIEMPO_ESPERA_BASE_MS = 15000;

// Una operacion rechazada NO se puede reintentar para siempre: si la causa es
// permanente (datos invalidos, un producto que ya no existe, un estado que el
// servidor no acepta), cada 30 s se volveria a enviar la misma fila y a fallar
// igual, indefinidamente. Eso es lo que hacia que la cuenta de "pendientes"
// subiera y no bajara nunca. Tras MAX_INTENTOS la operacion pasa a 'descartada':
// sale del conteo, se conserva para diagnostico y se le dice al usuario.
const finalizarOperacion = async (operation, estadoFinal, motivo) => {
  await markOperation(operation, estadoFinal, motivo);
  console.warn(`[sync] "${operation.type}" (${operation.entityId}) queda en "${estadoFinal}": ${motivo}`);
};

const aplicarBackoff = async operation => {
  const intentos = operation.attempts || 0;
  if (intentos <= 0) return true;
  // Backoff exponencial con tope: 15 s, 30 s, 60 s, 120 s, 240 s.
  const espera = Math.min(TIEMPO_ESPERA_BASE_MS * (2 ** (intentos - 1)), 5 * 60 * 1000);
  const transcurrido = Date.now() - new Date(operation.updatedAt || operation.createdAt).getTime();
  if (transcurrido < espera) {
    return false; // todavia no toca reintentarla
  }
  return true;
};

const applyResults = async results => {
  // El servidor puede rechazar una operacion concreta sin fallar el lote. Antes
  // eso se guardaba en la fila del outbox y no se mostraba nunca: la app se
  // quedaba con "Pendientes: 5" reintentando en silencio, sin decir por que.
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
        // OJO: los dos ids se comparan como NUMERO. operation.entityId es el id
        // que dio el dispositivo y puede venir como TEXTO desde un formulario;
        // comparar texto con numero da siempre "distintos" y hacia reconciliar
        // de mas (borrar y reinsertar el producto local) en cada subida.
        // Todo el bloque va en la cola: cambia el id del producto en ventaItems,
        // movimientos e inventario, y el usuario puede estar editando ese
        // producto a la vez.
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
        // Mismo motivo que en el inventario: comparar como numero, no como texto.
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
      // Un conflicto no se resuelve solo reintentando: el servidor tiene una
      // version distinta y mandarla otra vez dara el mismo conflicto. Se marca
      // para revision humana y NO se reintenta nunca mas por su cuenta.
      await finalizarOperacion(operation, 'conflict', result.error || 'Conflicto de datos');
      fallos.push({ tipo: operation.type, motivo: result.error || 'Conflicto de datos', estado: 'conflict' });
    } else {
      const motivo = result.error || 'La operación fue rechazada por el servidor';

      // "La consulta X no existe" al archivar significa que la consulta NUNCA
      // llego al servidor (se creo y archivo antes de que se sincronizara). El
      // objetivo del archivo esta entonces cumplido de sobra: no hay nada que
      // archivar alla. Reintentarlo no dara nunca un resultado distinto, asi que
      // se descarta como resuelta en vez de marcarlo como fallo.
      const esArchivoDeConsultaInexistente =
        operation.type === 'ARCHIVAR_CONSULTA' &&
        /no existe/i.test(motivo);

      if (esArchivoDeConsultaInexistente) {
        await finalizarOperacion(operation, 'descartada',
          'La consulta nunca se sincronizó: no había nada que archivar en el servidor.');
        await markLocalOperationSynced(operation).catch(() => {});
        await localDb.outbox.delete(operation.id);
        console.log('[sync] archivo de consulta no sincronizado: nada que hacer en el servidor');
        continue;
      }

      const intentos = (operation.attempts || 0) + 1;
      if (intentos >= MAX_INTENTOS) {
        await finalizarOperacion(operation, 'descartada',
          `${motivo} (se descartó tras ${intentos} intentos)`);
        fallos.push({
          tipo: operation.type,
          motivo: `${motivo}. Descartada tras ${intentos} intentos.`,
          estado: 'descartada'
        });
      } else {
        await markOperation(operation, 'failed', motivo);
        fallos.push({ tipo: operation.type, motivo, estado: 'failed', intentos });
      }
    }
  }
  status.fallos = fallos;
  if (fallos.length > 0) {
    console.warn('[sync] el servidor rechazo operaciones:', fallos);
  }
  return fallos;
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
  // son varias peticiones encadenadas y no debe bloquear al resto. El tope cubre
  // el conjunto: si el servidor no responde, se abandona el pull y se conserva lo
  // que ya habia en el dispositivo, en vez de dejar la app colgada.
  const results = await conTimeout(Promise.allSettled([
    supabase.from('inventario').select('*').order('id', { ascending: false }),
    supabase.from('lista_precios').select('*').order('id', { ascending: false }),
    supabase.rpc('deudas_pacientes'),
    supabase.rpc('stats_negocio')
  ]), TIEMPO_LIMITE_MS, 'pull de catalogo');
  const [inventoryResult, pricesResult, debtsResult, statsResult] = results.map(result =>
    result.status === 'fulfilled' ? result.value : { data: null, error: result.reason }
  );

  if (inventoryResult.error) throw inventoryResult.error;
  if (pricesResult.error) console.warn('No se pudo actualizar tarifario local:', pricesResult.error.message);

  let historialRows = [];
  try {
    const descargado = await descargarHistorialPaginado();
    historialRows = descargado.filas;
    // Se recalcula en cada pull: si la clinica archiva consultas y el equipo
    // vuelve a caber en el tope, el aviso tiene que desaparecer solo.
    status.historialDescargadas = descargado.filas.length;
    status.historialParcial = descargado.paginasDescargadas >= MAX_PAGINAS_HISTORIAL;
    if (status.historialParcial) {
      // No basta con avisar por consola: el optometria no la abre, y una lista
      // incompleta que parece completa es peor que un aviso.
      console.warn(`Historial descargado hasta el tope: este equipo solo tiene ${descargado.filas.length} consultas.`);
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
  // Cada ciclo arranca limpio: sin esto, un rechazo ya resuelto dejaba la barra
  // roja de App.jsx pegada para siempre, porque status.fallos solo se reescribia
  // dentro de applyResults y, con la cola vacia, esa funcion ni se llamaba.
  status.fallos = [];
  status.sesionInvalida = false;
  emit();

  try {
    await requestPersistentStorage();
    // La purga va primero: si no, la cola se lee entera incluyendo filas que
    // van a desaparecer de todas formas.
    const purgadas = await purgarDescartadas();
    if (purgadas > 0) console.log(`[sync] purgadas ${purgadas} operaciones descartadas antiguas`);
    await refreshCounts();
    if (status.online === false) {
      status.phase = 'offline';
      emit();
      return status;
    }

    // Primero los adjuntos: son subidas a Storage, no comandos de base de datos.
    await subirAdjuntosPendientes();
    await refreshCounts();


    // Solo se reenvian las que siguen siendo viables:
    //  - 'pending'  : nunca se intentó, o esperando su turno.
    //  - 'failed'   : reintentables, respetando el backoff.
    //  - NO 'conflict'   : el servidor tiene otra versión; reenviarlo da igual.
    //  - NO 'descartada' : ya se rindió tras MAX_INTENTOS.
    const candidatas = (await localDb.outbox.orderBy('createdAt').toArray())
      .filter(row => (row.status === 'pending' || row.status === 'failed') && row.type !== 'SUBIR_ADJUNTO');
    const operations = [];
    for (const row of candidatas) {
      if (await aplicarBackoff(row)) operations.push(row);
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

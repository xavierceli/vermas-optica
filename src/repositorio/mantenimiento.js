// ---------------------------------------------------------------------------
// MANTENIMIENTO DEL ALMACENAMIENTO LOCAL
// ---------------------------------------------------------------------------
// La app es offline-first: todo vive en IndexedDB. Con el uso diario crece:
//   - los adjuntos (comprobantes y fotos) se quedan para siempre aunque ya
//     esten subidos al servidor;
//   - el historial descargado se guarda DOS veces: en `consultations` y en
//     `cache` ("remote:<id>").
//
// Si no se limpia, el navegador acaba rechazando escrituras (sobre todo en
// iOS) y la app deja de guardar sin conexion, que es justo lo que no puede
// pasar. Este modulo libera solo lo que es seguro liberar:
//
//   - Adjuntos: SOLO los que ya estan en el servidor ('uploaded') y son mas
//     viejos que la retencion. Un adjunto pendiente o con error NUNCA se toca:
//     podria ser la unica copia.
//   - Cache: SOLO filas de historial que ya existen en `consultations` con
//     estado 'synced' (el dato vive en local). Las filas que solo estan en la
//     cache se conservan: son la unica copia en este equipo.
//
// No borra pacientes, consultas, ventas, pagos, inventario ni la cola.
// ---------------------------------------------------------------------------
import { localDb, getMeta, setMeta, nowIso } from '../localDb.js';
import { espacioEnDisco } from '../respaldo.js';

const DIA_MS = 24 * 60 * 60 * 1000;

// Retenciones. Se pueden ajustar sin tocar la logica.
export const DIAS_ADJUNTOS_SUBIDOS = 30;
export const DIAS_CACHE_REDUNDANTE = 90;
export const INTERVALO_MANTENIMIENTO_MS = DIA_MS;

const fechaDe = fila => Date.parse(fila?.updatedAt || fila?.createdAt) || 0;

/** Copia de la fila sin el binario (asi Dexie libera el Blob de verdad). */
const sinBlob = fila => {
  const copia = { ...fila };
  delete copia.blob;
  return copia;
};

/**
 * Libera el Blob de los adjuntos ya subidos y mas viejos que `dias`.
 * Conserva la fila (ruta, estado, refId): lo unico que se va es el binario,
 * que ya esta en Supabase Storage.
 *
 * @returns {Promise<number>} cuantos adjuntos se liberaron
 */
export const purgarAdjuntosSubidosImpl = async ({ dias = DIAS_ADJUNTOS_SUBIDOS, ahora = Date.now() } = {}) => {
  const limite = ahora - dias * DIA_MS;
  const subidos = await localDb.attachments.where('status').equals('uploaded').toArray();
  const candidatos = subidos.filter(fila => fila.blob && fechaDe(fila) < limite);

  for (const fila of candidatos) {
    await localDb.attachments.put({
      ...sinBlob(fila),
      blobLiberadoEn: nowIso(),
      updatedAt: nowIso()
    });
  }

  return candidatos.length;
};

/**
 * Borra las copias de cache del historial que ya estan en `consultations`
 * como sincronizadas. Nunca toca filas cuyo dato solo vive en la cache.
 *
 * @returns {Promise<number>} cuantas filas de cache se borraron
 */
export const purgarCacheRedundanteImpl = async ({ dias = DIAS_CACHE_REDUNDANTE, ahora = Date.now() } = {}) => {
  const limite = ahora - dias * DIA_MS;

  const [enCache, locales] = await Promise.all([
    localDb.cache.where('kind').equals('historial').toArray(),
    localDb.consultations.toArray()
  ]);

  const sincronizadas = new Set(
    locales.filter(fila => fila.syncStatus === 'synced').map(fila => String(fila.id))
  );

  const aBorrar = enCache
    .filter(fila => fechaDe(fila) < limite)
    .filter(fila => sincronizadas.has(String(fila.id).replace(/^remote:/, '')))
    .map(fila => fila.id);

  if (aBorrar.length > 0) await localDb.cache.bulkDelete(aBorrar);
  return aBorrar.length;
};

/**
 * Ejecuta el mantenimiento como maximo una vez al dia.
 * `forzar: true` lo ejecuta igual (lo usa el respaldo manual y las pruebas).
 */
export const ejecutarMantenimientoImpl = async ({ forzar = false, ahora = Date.now() } = {}) => {
  const ultimo = Number(await getMeta('mantenimientoUltimo', 0)) || 0;
  if (!forzar && ahora - ultimo < INTERVALO_MANTENIMIENTO_MS) {
    return { omitido: true, adjuntos: 0, cache: 0 };
  }

  const adjuntos = await purgarAdjuntosSubidosImpl({ ahora });
  const cache = await purgarCacheRedundanteImpl({ ahora });

  await setMeta('mantenimientoUltimo', ahora);
  await setMeta('mantenimientoUltimoResumen', {
    adjuntos,
    cache,
    cuando: new Date(ahora).toISOString()
  });

  return { omitido: false, adjuntos, cache };
};

/**
 * Uso real del almacenamiento del navegador, con porcentaje.
 * Devuelve null fuera del navegador (por ejemplo en las pruebas).
 */
export const revisarEspacioImpl = async () => {
  try {
    const espacio = await espacioEnDisco();
    if (!espacio || !espacio.cuota) return null;
    return {
      ...espacio,
      porcentaje: Math.round((espacio.usado / espacio.cuota) * 100)
    };
  } catch (error) {
    console.warn('[mantenimiento] no se pudo medir el almacenamiento:', error?.message || error);
    return null;
  }
};

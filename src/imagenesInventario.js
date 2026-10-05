// ---------------------------------------------------------------------------
// GESTION Y FIRMA DE FOTOGRAFIAS DE INVENTARIO
// ---------------------------------------------------------------------------
// Resuelve URLs firmadas de Supabase Storage para el catálogo de armazones.
// Si no hay conexión o la foto se guardó offline, recurre al Blob local
// almacenado en IndexedDB (tabla attachments).
// ---------------------------------------------------------------------------
import { supabase } from './supabaseClient';
import { localDb } from './localDb';
import { extraerRutaImagen } from './rutaImagen.js';

export { extraerRutaImagen };

const BUCKET = 'inventario_imagenes';
const DURACION_FIRMA_SEGUNDOS = 3600; // 1 hora
const DURACION_CACHE_MS = DURACION_FIRMA_SEGUNDOS * 1000;
const MARGEN_SEGURIDAD_MS = 60 * 1000; // 1 minuto antes de expirar

const cacheFirmas = new Map();
const cacheBlobsLocales = new Map();
const peticionesEnCurso = new Map();

const limpiarCacheExpirada = () => {
  if (cacheFirmas.size < 60) return;
  const ahora = Date.now();
  for (const [clave, item] of cacheFirmas.entries()) {
    if (item.expira <= ahora) {
      cacheFirmas.delete(clave);
    }
  }
};

// La tabla `attachments` se creo en src/localDb.js con la clave
// 'id,refType,refId,status,createdAt,[status+createdAt]'.
// NO incluye `bucket`, asi que consultar por ese campo lanzaba
//   SchemaError: KeyPath bucket on object store attachments is not indexed
// y el try/catch de abajo convertia ese error en un `null` silencioso:
// la foto existia en el dispositivo pero la app mostraba "Sin foto".
// Se consulta por `refType` (que SI esta indexado) y se filtra en memoria,
// igual que comprobantes.js ya hace con `refId` para los comprobantes de pago.
const buscarBlobLocalInventario = async ruta => {
  try {
    const lista = await localDb.attachments.where('refType').equals('inventario').toArray();
    const hallado = lista.find(a => a.blob && (a.ruta === ruta || a.nombre === ruta));
    return hallado?.blob || null;
  } catch {
    return null;
  }
};

/**
 * Devuelve una URL utilizable en <img>, o null si no se puede resolver.
 * Reutiliza firmas en memoria, comparte peticiones simultáneas y recurre a IndexedDB offline.
 * @param {string} valor Ruta o identificador de imagen
 * @returns {Promise<string|null>}
 */
export const resolverUrlImagenInventario = async (valor) => {
  if (!valor) return null;

  const ruta = extraerRutaImagen(valor);
  if (!ruta) return null;

  limpiarCacheExpirada();

  // 1. Revisa si ya tenemos la URL firmada en caché vigente
  const enCache = cacheFirmas.get(ruta);
  if (enCache && enCache.expira > Date.now()) {
    return enCache.url;
  }

  // 2. Revisa si ya tenemos un Blob local generado para esta ruta
  if (cacheBlobsLocales.has(ruta)) {
    return cacheBlobsLocales.get(ruta);
  }

  // 3. Si hay una petición remota en curso para esta misma ruta, esperamos el resultado
  if (peticionesEnCurso.has(ruta)) {
    return peticionesEnCurso.get(ruta);
  }

  // 4. Si hay conexión a internet, solicitamos la firma a Supabase Storage
  if (navigator.onLine) {
    const promesaFirma = (async () => {
      try {
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(ruta, DURACION_FIRMA_SEGUNDOS);

        if (!error && data?.signedUrl) {
          cacheFirmas.set(ruta, {
            url: data.signedUrl,
            expira: Date.now() + DURACION_CACHE_MS - MARGEN_SEGURIDAD_MS
          });
          return data.signedUrl;
        }
      } catch (err) {
        console.warn('[inventario] Error al solicitar URL firmada:', err);
      } finally {
        peticionesEnCurso.delete(ruta);
      }
      return null;
    })();

    peticionesEnCurso.set(ruta, promesaFirma);
    const resultadoUrl = await promesaFirma;
    if (resultadoUrl) return resultadoUrl;
  }

  // 5. Contingencia sin red o foto pendiente de subida: buscar en IndexedDB
  const blobLocal = await buscarBlobLocalInventario(ruta);
  if (blobLocal) {
    const blobUrl = URL.createObjectURL(blobLocal);
    cacheBlobsLocales.set(ruta, blobUrl);
    return blobUrl;
  }

  return null;
};
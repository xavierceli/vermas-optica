// ---------------------------------------------------------------------------
// ACCESO A COMPROBANTES
// ---------------------------------------------------------------------------
// El bucket comprobantes_pagos es PRIVADO.
// Lo que se guarda en la base de datos es la RUTA del archivo, y aquí se resuelve
// a una URL firmada de corta duración. Sin conexión, recurre al Blob local
// guardado en IndexedDB para que el comprobante siga visible sin internet.
// ---------------------------------------------------------------------------
import { supabase } from './supabaseClient';
import { localDb } from './localDb';
import { extraerRutaArchivo } from './rutaImagen.js';

const DURACION_FIRMA_SEGUNDOS = 3600; // 1 hora
const DURACION_CACHE_MS = DURACION_FIRMA_SEGUNDOS * 1000;
const MARGEN_SEGURIDAD_MS = 60 * 1000; // 1 minuto antes de expirar

const cacheFirmas = new Map();
const cacheBlobsLocales = new Map();

// createSignedUrl() recibe el bucket por separado; se normaliza la ruta sin prefijo
const extraerRuta = valor => extraerRutaArchivo(valor, 'comprobantes_pagos');

const limpiarCacheExpirada = () => {
  if (cacheFirmas.size < 50) return;
  const ahora = Date.now();
  for (const [clave, item] of cacheFirmas.entries()) {
    if (item.expira <= ahora) {
      cacheFirmas.delete(clave);
    }
  }
};

const buscarBlobLocal = async (refId, ruta) => {
  try {
    if (refId) {
      const lista = await localDb.attachments.where('refId').equals(refId).toArray();
      const hallado = lista.find(adjunto => adjunto.blob);
      if (hallado) return hallado;
    }
    if (ruta) {
      const todos = await localDb.attachments.toArray();
      return todos.find(a => a.blob && (a.ruta === ruta || a.nombre === ruta)) || null;
    }
  } catch {
    return null;
  }
  return null;
};

/**
 * Devuelve una URL utilizable en <img> o <a>, o null si no se puede resolver.
 * @param {string} valor Ruta o URL guardada en la base
 * @param {string} [refId] ID de la venta/pago para buscar la copia local offline
 * @returns {Promise<string|null>}
 */
export const resolverUrlComprobante = async (valor, refId = null) => {
  const ruta = extraerRuta(valor);
  if (!ruta && !refId) return null;

  limpiarCacheExpirada();

  // 1. Si ya tenemos una URL firmada válida en memoria, la usamos
  if (ruta) {
    const enCache = cacheFirmas.get(ruta);
    if (enCache && enCache.expira > Date.now()) {
      return enCache.url;
    }
  }

  // 2. Si hay conexión a internet y tenemos ruta válida, solicitamos la firma a Supabase
  if (navigator.onLine && ruta) {
    try {
      const { data, error } = await supabase.storage
        .from('comprobantes_pagos')
        .createSignedUrl(ruta, DURACION_FIRMA_SEGUNDOS);

      if (!error && data?.signedUrl) {
        cacheFirmas.set(ruta, { 
          url: data.signedUrl, 
          expira: Date.now() + DURACION_CACHE_MS - MARGEN_SEGURIDAD_MS 
        });
        return data.signedUrl;
      }
    } catch (err) {
      console.warn('[comprobantes] Error al firmar comprobante en Supabase:', err);
    }
  }

  // 3. Contingencia sin red o fallo de firma: recurrimos al archivo Blob local en IndexedDB
  const claveBlob = refId || ruta;
  if (claveBlob && cacheBlobsLocales.has(claveBlob)) {
    return cacheBlobsLocales.get(claveBlob);
  }

  const adjunto = await buscarBlobLocal(refId, ruta);
  if (adjunto?.blob) {
    const blobUrl = URL.createObjectURL(adjunto.blob);
    if (claveBlob) {
      cacheBlobsLocales.set(claveBlob, blobUrl);
    }
    return blobUrl;
  }

  return null;
};
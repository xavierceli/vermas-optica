// ---------------------------------------------------------------------------
// ACCESO A COMPROBANTES
// El bucket comprobantes_pagos es PRIVADO. Por eso getPublicUrl ya no sirve:
// lo que se guarda en la base es la RUTA del archivo, y aquí se resuelve a
// una URL firmada de corta duración. Sin conexión se recurre al Blob local
// que dejó el módulo de adjuntos offline, para que el comprobante siga
// visible aunque la red esté caída.
// ---------------------------------------------------------------------------
import { supabase } from './supabaseClient';
import { localDb } from './localDb';
import { extraerRutaArchivo } from './rutaImagen.js';

const DURACION_FIRMA_SEGUNDOS = 3600; // 1 hora en segundos para Supabase
const DURACION_CACHE_MS = DURACION_FIRMA_SEGUNDOS * 1000;
const MARGEN_SEGURIDAD_MS = 60 * 1000; // 1 minuto antes de expirar

const cacheFirmas = new Map();

// createSignedUrl() recibe el bucket por separado, así que la ruta nunca puede
// llevar delante "comprobantes_pagos". Este normalizador lo recorta siempre.
const extraerRuta = valor => extraerRutaArchivo(valor, 'comprobantes_pagos');

const urlDeBlobLocal = async (refId) => {
  if (!refId) return null;
  try {
    const lista = await localDb.attachments.where('refId').equals(refId).toArray();
    return lista.find(adjunto => adjunto.blob) || null;
  } catch {
    return null;
  }
};

/**
 * Devuelve una URL utilizable en <img> o <a>, o null si no se puede resolver.
 * @param valor ruta o URL guardada en la base
 * @param refId id de la venta, para buscar la copia local sin conexión
 */
export const resolverUrlComprobante = async (valor, refId = null) => {
  const ruta = extraerRuta(valor);
  if (!ruta) return null;

  // 1. Si ya tenemos una URL firmada válida en memoria, la usamos (con o sin red)
  const enCache = cacheFirmas.get(ruta);
  if (enCache && enCache.expira > Date.now()) {
    return enCache.url;
  }

  // 2. Si hay conexión a internet, solicitamos una nueva firma a Supabase
  if (navigator.onLine) {
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
      console.warn('[comprobantes] Error al firmar comprobante:', err);
    }
  }

  // 3. Contingencia sin red o fallo de firma: recurrimos al archivo Blob local en IndexedDB
  const adjunto = await urlDeBlobLocal(refId);
  if (adjunto?.blob) {
    return URL.createObjectURL(adjunto.blob);
  }

  return null;
};
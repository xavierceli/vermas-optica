// ---------------------------------------------------------------------------
// ACCESO A COMPROBANTES
// El bucket comprobantes_pagos es PRIVADO. Por eso getPublicUrl ya no sirve:
// lo que se guarda en la base es la RUTA del archivo, y aqui se resuelve a
// una URL firmada de corta duracion. Sin conexion se recurre al Blob local
// que dejo el modulo de adjuntos offline, para que el comprobante siga
// visible aunque la red este caida.
// ---------------------------------------------------------------------------
import { supabase } from './supabaseClient';
import { localDb } from './localDb';
import { extraerRutaArchivo } from './rutaImagen.js';

const DURACION_FIRMA_MS = 60 * 60 * 1000;
const cacheFirmas = new Map();

// createSignedUrl() recibe el bucket por separado, asi que la ruta nunca puede
// llevar delante "comprobantes_pagos". Este normalizador lo recorta siempre,
// tanto si lo guardado es una ruta simple como una URL publica antigua.
const extraerRuta = valor => extraerRutaArchivo(valor, 'comprobantes_pagos');

const urlDeBlobLocal = refId => {
  if (!refId) return null;
  const pendientes = localDb.attachments.where('refId').equals(refId).toArray();
  return pendientes.then(lista => lista.find(adjunto => adjunto.blob) || null);
};

/**
 * Devuelve una URL utilizable en <img> o <a>, o null si no se puede resolver.
 * @param valor ruta o URL publica antigua guardada en la base
 * @param refId id de la venta, para buscar la copia local sin conexion
 */
export const resolverUrlComprobante = async (valor, refId = null) => {
  const ruta = extraerRuta(valor);
  if (!ruta) return null;

  if (navigator.onLine) {
    const enCache = cacheFirmas.get(ruta);
    if (enCache && enCache.expira > Date.now()) return enCache.url;
    const { data, error } = await supabase.storage
      .from('comprobantes_pagos')
      .createSignedUrl(ruta, DURACION_FIRMA_MS);
    if (!error && data?.signedUrl) {
      cacheFirmas.set(ruta, { url: data.signedUrl, expira: Date.now() + DURACION_FIRMA_MS - 60000 });
      return data.signedUrl;
    }
  }

  // Sin red: usamos la copia local si existe todavia en el dispositivo.
  const adjunto = await urlDeBlobLocal(refId);
  if (adjunto?.blob) return URL.createObjectURL(adjunto.blob);
  return null;
};
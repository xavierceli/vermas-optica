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

const DURACION_FIRMA_MS = 60 * 60 * 1000;
const cacheFirmas = new Map();

const extraerRuta = valor => {
  if (!valor) return null;
  const texto = String(valor).trim();
  if (!texto) return null;
  if (texto.startsWith('http')) {
    try {
      const url = new URL(texto);
      const partes = url.pathname.split('/').filter(Boolean);
      const indice = partes.indexOf('comprobantes_pagos');
      if (indice >= 0) return partes.slice(indice).join('/');
      return partes.join('/');
    } catch {
      return null;
    }
  }
  return texto.replace(/^\/+/, '');
};

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
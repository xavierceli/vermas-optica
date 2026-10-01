import { supabase } from './supabaseClient';
import { extraerRutaImagen } from './rutaImagen.js';

export { extraerRutaImagen };

const BUCKET = 'inventario_imagenes';
const DURACION_FIRMA_SEGUNDOS = 3600; // 1 hora en segundos para Supabase Storage
const DURACION_CACHE_MS = DURACION_FIRMA_SEGUNDOS * 1000;
const MARGEN_SEGURIDAD_MS = 60 * 1000; // 1 minuto antes de expirar

const cacheFirmas = new Map();

/**
 * Devuelve una URL utilizable en <img>, o null si no se puede resolver.
 * Firma una vez por hora y reutiliza la firma en memoria mientras siga vigente.
 */
export const resolverUrlImagenInventario = async (valor) => {
  if (!valor) return null;

  const ruta = extraerRutaImagen(valor);
  if (!ruta) return null;

  // 1. Revisa si ya tenemos la URL firmada en caché vigente (incluso si está offline)
  const enCache = cacheFirmas.get(ruta);
  if (enCache && enCache.expira > Date.now()) {
    return enCache.url;
  }

  // 2. Si no hay conexión y no está en caché, no podemos generar una firma nueva
  if (!navigator.onLine) return null;

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(ruta, DURACION_FIRMA_SEGUNDOS);

    if (error || !data?.signedUrl) {
      console.warn('[inventario] No se pudo firmar la imagen:', ruta, error?.message);
      return null;
    }

    cacheFirmas.set(ruta, {
      url: data.signedUrl,
      expira: Date.now() + DURACION_CACHE_MS - MARGEN_SEGURIDAD_MS
    });

    return data.signedUrl;
  } catch (err) {
    console.warn('[inventario] Error al solicitar URL firmada:', err);
    return null;
  }
};

/**
 * Firma una foto recién seleccionada o subida para visualizarla inmediatamente.
 */
export const urlInmediataParaVista = async (valor) => {
  const ruta = extraerRutaImagen(valor);
  if (!ruta) return null;

  try {
    const { data } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(ruta, DURACION_FIRMA_SEGUNDOS);

    return data?.signedUrl || null;
  } catch {
    return null;
  }
};
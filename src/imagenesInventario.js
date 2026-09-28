// ---------------------------------------------------------------------------
// ACCESO A LAS FOTOGRAFIAS DEL INVENTARIO
// ---------------------------------------------------------------------------
// El bucket `inventario_imagenes` es PRIVADO (migracion 006 y 008 lo posta a
// public=false por una buena razon: con el bucket publico, sin iniciar sesion,
// cualquier persona podia LEER comprobantes de pago y SOBRESCRIBIR imagenes).
//
// Por eso getPublicUrl dejo de funcionar: construye una URL publica, pero para
// un bucket privado esa URL responde 400/404 y la foto sale rota. Lo correcto
// es firmar la URL como ya se hace con los comprobantes (ver comprobantes.js).
//
// En la base se guarda la RUTA del archivo, nunca la URL firmada: las URLs
// firmadas caducan a la hora y guardarlas dejaria la foto rota al dia
// siguiente.
import { supabase } from './supabaseClient';
import { extraerRutaImagen } from './rutaImagen.js';

export { extraerRutaImagen };

const BUCKET = 'inventario_imagenes';
const DURACION_FIRMA_MS = 60 * 60 * 1000; // 1 hora
const cacheFirmas = new Map();

/**
 * Devuelve una URL utilizable en <img>, o null si no se puede resolver.
 * Firma una vez por hora y reutiliza la firma mientras siga vigente.
 */
export const resolverUrlImagenInventario = async (valor) => {
  // Se normaliza DOS veces a proposito: createSignedUrl() ya recibe el bucket
  // por separado (.from(BUCKET)), asi que la ruta jamas puede llevar delante el
  // nombre del bucket. Antes pasaba "inventario_imagenes/foto.jpg" y Storage
  // buscaba "inventario_imagenes/inventario_imagenes/foto.jpg" -> HTTP 400.
  const ruta = extraerRutaImagen(extraerRutaImagen(valor));
  if (!ruta) return null;
  if (!/^https?:/i.test(String(valor).trim()) && String(valor).includes(BUCKET)) {
    console.warn('[inventario] imagen_url guardada con el bucket dentro; se recorta al firmar:', valor);
  }

  const enCache = cacheFirmas.get(ruta);
  if (enCache && enCache.expira > Date.now()) return enCache.url;

  if (!navigator.onLine) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(ruta, DURACION_FIRMA_MS);

  if (error || !data?.signedUrl) {
    console.warn('[inventario] no se pudo firmar la imagen', ruta, error?.message);
    return null;
  }
  cacheFirmas.set(ruta, {
    url: data.signedUrl,
    expira: Date.now() + DURACION_FIRMA_MS - 60000
  });
  return data.signedUrl;
};

/**
 * Firma una foto recien subida para guardarla en el registro. Se usa de inmediato
 * para que el usuario vea su foto, pero en la base se sigue guardando SOLO la
 * ruta: una URL firmada caduca y dejaria el inventario con fotos rotas.
 */
export const urlInmediataParaVista = async valor => {
  const ruta = extraerRutaImagen(valor);
  if (!ruta) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, DURACION_FIRMA_MS);
  return data?.signedUrl || null;
};

// ---------------------------------------------------------------------------
// RUTA INTERNA DE UN ARCHIVO EN STORAGE (Supabase Storage Path Normalizer)
// ---------------------------------------------------------------------------
// Módulo puro sin dependencias externas para normalizar nombres y rutas
// de imágenes de armazones y comprobantes de pago.
//
// Convierte URLs completas, URLs firmadas con tokens caducos o rutas con
// prefijos repetidos en la ruta relativa limpia requerida por Supabase Storage.
// ---------------------------------------------------------------------------

const BUCKET = 'inventario_imagenes';

// Prefijos de la API de Storage de Supabase:
//   /storage/v1/object/public/<bucket>/foto.jpg
//   /storage/v1/object/sign/<bucket>/foto.jpg?token=...
//   /storage/v1/render/image/authenticated/<bucket>/foto.jpg
const PREFIJO_STORAGE =
  /^\/?(?:storage\/v1\/)?(?:object\/(?:public|sign|authenticated)|render\/image\/(?:public|authenticated))\//i;

/** Elimina el nombre del bucket del inicio si viene redundante */
const recortarBucket = (ruta, bucket) => {
  if (!bucket) return ruta;
  let salida = ruta;
  const prefijo = bucket.toLowerCase() + '/';
  while (salida.toLowerCase().startsWith(prefijo)) {
    salida = salida.slice(prefijo.length);
  }
  return salida;
};

/**
 * Extrae la ruta relativa de un archivo almacenado dentro de un bucket específico.
 * @param {string} valor URL o ruta original
 * @param {string} bucket Nombre del bucket de destino
 * @returns {string|null} Ruta normalizada o null si es inválida
 */
export const extraerRutaArchivo = (valor, bucket = BUCKET) => {
  if (!valor) return null;
  const texto = String(valor).trim();
  if (!texto) return null;

  let ruta = texto;

  // 1. Si es una URL absoluta, extraemos únicamente el pathname
  if (/^https?:\/\//i.test(texto)) {
    try {
      const parsedUrl = new URL(texto);
      ruta = parsedUrl.pathname;
    } catch {
      return null;
    }
  }

  // 2. Limpieza de tokens, queries y fragmentos hash
  ruta = ruta.split(/[?#]/)[0];

  // 3. Decodificación de caracteres especiales (%20, tildes, etc.)
  try {
    ruta = decodeURIComponent(ruta);
  } catch {
    /* Mantener original si contiene porcentajes malformados */
  }

  // 4. Limpieza de prefijos de Supabase Storage y barras redundantes
  ruta = ruta
    .replace(/^\/+/, '')          // Barras iniciales
    .replace(PREFIJO_STORAGE, '') // Prefijos de la API de Supabase
    .replace(/\/{2,}/g, '/')      // Barras repetidas (// -> /)
    .replace(/\/+$/, '');         // Barra final

  // 5. Eliminamos el nombre del bucket si viene incluido en el path
  ruta = recortarBucket(ruta, bucket);

  // 6. Protección de seguridad contra Directory Traversal (..)
  if (!ruta || ruta.split('/').some(parte => parte === '..')) {
    return null;
  }

  return ruta;
};

/** Atajo preconfigurado para el bucket de inventario de armazones y accesorios */
export const extraerRutaImagen = valor => extraerRutaArchivo(valor, BUCKET);
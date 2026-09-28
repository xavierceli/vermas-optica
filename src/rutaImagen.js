// ---------------------------------------------------------------------------
// RUTA INTERNA DE UN ARCHIVO EN STORAGE
// ---------------------------------------------------------------------------
// Logica pura, sin dependencias: se separa para poder probarla con node --test
// (el modulo que firma URLs importa supabaseClient y no se puede cargar en Node).
//
// La base guarda la RUTA del archivo, no una URL firmada: las URLs firmadas
// caducan a la hora y dejarian la foto rota al dia siguiente. Esta funcion
// convierte lo que haya guardado (ruta simple, ruta con el bucket de sobra, o
// URL publica/firmada antigua) en la ruta que espera Supabase Storage.
//
// Es un normalizador GENERICO: lo usan el bucket del inventario
// (extraerRutaImagen) y el de comprobantes de pago (extraerRutaArchivo), que
// sufrian el mismo defecto por tener cada uno su copia de la funcion.
const BUCKET = 'inventario_imagenes';

// Prefijos que antepone la API de Storage a la ruta del archivo:
//   /storage/v1/object/public/<bucket>/foto.jpg
//   /storage/v1/object/sign/<bucket>/foto.jpg?token=...
//   /storage/v1/render/image/authenticated/<bucket>/foto.jpg
const PREFIJO_STORAGE =
  /^\/?(?:storage\/v1\/)?(?:object\/(?:public|sign|authenticated)|render\/image\/(?:public|authenticated))\//i;

/** Quita el nombre del bucket del principio, por veces repetido. */
const recortarBucket = (ruta, bucket) => {
  let salida = ruta;
  while (salida.slice(0, bucket.length + 1).toLowerCase() === bucket + '/') {
    salida = salida.slice(bucket.length + 1);
  }
  return salida;
};

export const extraerRutaArchivo = (valor, bucket) => {
  if (!valor) return null;
  const texto = String(valor).trim();
  if (!texto) return null;

  let ruta = texto;

  if (/^https?:\/\//i.test(texto)) {
    let pathname;
    try {
      pathname = new URL(texto).pathname;
    } catch {
      // Una URL malformada no debe tumbar el listado de inventario.
      return null;
    }
    try {
      ruta = decodeURIComponent(pathname);
    } catch {
      ruta = pathname; // porcentaje mal formado: se deja tal cual
    }
  }

  ruta = ruta
    .replace(/^\/+/, '')          // barras iniciales
    .replace(PREFIJO_STORAGE, '') // /storage/v1/object/public/...
    .replace(/[?#].*$/, '')        // token de URL firmada pegado a una ruta
    .replace(/\/{2,}/g, '/')      // barras duplicadas
    .replace(/\/+$/, '');         // barra final

  ruta = recortarBucket(ruta, bucket);

  // Una ruta que sube de directorio no se firma nunca.
  if (!ruta || ruta.split('/').some(parte => parte === '..')) return null;
  return ruta;
};

/** Atajo para el bucket del inventario. */
export const extraerRutaImagen = valor => extraerRutaArchivo(valor, BUCKET);

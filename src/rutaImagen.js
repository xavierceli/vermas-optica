// ---------------------------------------------------------------------------
// RUTA DE UNA IMAGEN DEL INVENTARIO
// ---------------------------------------------------------------------------
// Logica pura, sin dependencias: se separa para poder probarla con node --test
// (el modulo que firma URLs importa supabaseClient y no se puede cargar en Node).
//
// La base guarda la RUTA del archivo, no una URL firmada: las URLs firmadas
// caducan a la hora y dejarian la foto rota al dia siguiente. Esta funcion
// convierte lo que haya guardado (ruta simple o URL publica antigua) en la ruta
// que espera Supabase Storage.
const BUCKET = 'inventario_imagenes';

export const extraerRutaImagen = valor => {
  if (!valor) return null;
  const texto = String(valor).trim();
  if (!texto) return null;

  if (texto.startsWith('http')) {
    try {
      const url = new URL(texto);
      const partes = url.pathname.split('/').filter(Boolean);
      const indice = partes.indexOf(BUCKET);
      if (indice >= 0) return partes.slice(indice).join('/');
      return partes.join('/');
    } catch {
      // Una URL malformada no debe tumbar el listado de inventario.
      return null;
    }
  }

  // Ruta ya relativa: se quitan las barras iniciales y el prefijo sobrante de
  // almacenamiento, si lo trajera.
  return texto
    .replace(/^\/+/, '')
    .replace(/^storage\/v1\/object\/[^/]+\//, '');
};

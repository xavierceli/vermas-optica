// ---------------------------------------------------------------------------
// PESO DEL RESPALDO
// ---------------------------------------------------------------------------
// El respaldo convierte cada foto y comprobante a texto base64, que pesa un 33%
// mas que el binario. Medido: 200 fotos de 25 KB (5 MB en el dispositivo) producen
// un .json de 6,6 MB.
//
// El problema no era el tamaño en si, sino que la app no decia nada: el boton
// ponia "Preparando..." durante un rato sin dar idea de cuanto iba a tardar ni de
// cuanto peso, y el navegador se queda sin memoria y la descarga falla AL FINAL,
// cuando el usuario ya espera un archivo que no llega.
//
// Aqui se calcula el peso ANTES de generar nada, para poder avisar con numeros.
// Modulo puro y sin dependencias: se puede probar con node --test.
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;
const KIB = 1024;

/**
 * Peso estimado del archivo de respaldo, en bytes.
 * Los adjuntos se miden de verdad (su binario esta en IndexedDB y se puede sumar);
 * el resto se estima a partir del numero de filas de cada tabla.
 *
 * @param {object} conteos  { tabla: numeroDeFilas }
 * @param {number} pesoAdjuntos Total en bytes de los archivos (Blobs)
 * @returns {number} Bytes estimados del .json
 */
export const estimarPesoRespaldo = (conteos = {}, pesoAdjuntos = 0) => {
  // Base64: 4 caracteres por cada 3 bytes de binario.
  // Se fuerza a 0 lo que no sea un numero: si pesoAdjuntos fuese NaN, contaminaria
  // todo el resultado y la pantalla mostraria "NaN MB".
  const binario = Number(pesoAdjuntos) || 0;
  const adjuntosEnBase64 = Math.ceil(binario * 4 / 3);

  // Una fila de datos (paciente, consulta, venta...) ocupa de media ~400 bytes
  // en el JSON: identificadores, fechas y los muchos campos en null o "".
  const POR_FILA = 400;
  const filas = Object.entries(conteos || {})
    .filter(([tabla]) => tabla !== 'attachments')
    .reduce((total, [, n]) => total + (Number(n) || 0), 0);

  return adjuntosEnBase64 + filas * POR_FILA;
};

/**
 * El peso en palabras de una persona: "unos 6 MB".
 * @param {number} bytes
 */
export const formatearPeso = (bytes) => {
  const n = Number(bytes) || 0;
  if (n <= 0) return 'casi nada';
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / KIB).toFixed(0)} KB`;
  if (n < 200 * MB) return `${(n / MB).toFixed(1)} MB`;
  return `${Math.round(n / MB)} MB`;
};

/**
 * Como debe actuar la app segun el peso:
 *  - 'ok'      : se puede generar sin problema.
 *  - 'aviso'   : conviene avisar porque tardara (mas de 20 MB).
 *  - 'peligro' : no conviene generarlo de una vez; se sugiere la version ligera.
 */
export const nivelDePeso = (bytes) => {
  const n = Number(bytes) || 0;
  if (n > 200 * MB) return 'peligro';
  if (n > 20 * MB) return 'aviso';
  return 'ok';
};

/** El mensaje que se le enseña al usuario segun el peso y el espacio libre. */
export const mensajeDePeso = (bytes, libre = null) => {
  const peso = formatearPeso(bytes);
  const nivel = nivelDePeso(bytes);

  if (nivel === 'peligro') {
    return {
      tipo: 'aviso',
      texto: `El respaldo pesará unos ${peso}. Puede tardar y agotar la memoria del navegador. `
        + 'Si el equipo va justo, usa el respaldo sin fotos: los datos clinically quedan igual.'
    };
  }
  if (nivel === 'aviso') {
    return {
      tipo: 'aviso',
      texto: `El respaldo pesará unos ${peso}. Tendrá que esperar un momento.`
    };
  }
  // OJO: se comparan BYTES con BYTES. Comparar contra `peso` (que ya es el texto
  // "6.0 MB") daria siempre false y este aviso no se mostraria nunca.
  if (libre !== null && Number(libre) < Number(bytes)) {
    return {
      tipo: 'aviso',
      texto: `El respaldo pesará unos ${peso} pero solo quedan ${formatearPeso(libre)} libres en este equipo. `
        + 'Puede que la descarga falle: libera espacio o borra archivos viejos.'
    };
  }
  return { tipo: 'ok', texto: `El respaldo pesará unos ${peso}.` };
};
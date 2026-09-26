// ---------------------------------------------------------------------------
// PAGINACION DE DESCARGAS
// Antes el historial remoto se bajaba con un limite fijo de 100 filas: cualquier
// paciente con mas de 100 consultas quedaba invisible en el dispositivo. Esto
// recorre la vista por paginas, con topes de seguridad para que un fallo de red
// o un orden inestable no dejen la app colgada en un bucle.
// ---------------------------------------------------------------------------

/**
 * Recorre paginas hasta agotar los datos o alcanzar el tope.
 * @param fetchPagina (desde, limite) => Promise<array>
 * @param pageSize filas por peticion
 * @param maxPaginas tope de seguridad
 * @param onPagina callback opcional por pagina descargada
 */
export const paginarConsulta = async ({ fetchPagina, pageSize = 200, maxPaginas = 25, onPagina }) => {
  const filas = [];
  const vistas = new Set();
  let paginasDescargadas = 0;

  for (let pagina = 0; pagina < maxPaginas; pagina += 1) {
    const desde = pagina * pageSize;
    const lote = await fetchPagina(desde, pageSize);
    if (!Array.isArray(lote) || lote.length === 0) break;

    let nuevas = 0;
    for (const fila of lote) {
      const clave = fila?.id ?? `${fila?.cedula ?? ''}:${fila?.fecha ?? ''}`;
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      filas.push(fila);
      nuevas += 1;
    }

    paginasDescargadas += 1;
    if (onPagina) await onPagina(lote, pagina);

    // Ultima pagina: el servidor devolvio menos filas de las pedidas.
    if (lote.length < pageSize) break;
    // La vista no avanza (orden inestable): seguir repetiria la misma pagina.
    if (nuevas === 0) break;
  }

  return { filas, paginasDescargadas, completa: filas.length > 0 };
};
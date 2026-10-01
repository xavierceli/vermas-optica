// ---------------------------------------------------------------------------
// PAGINACION DE DESCARGAS
// ---------------------------------------------------------------------------
// Recorre consultas remotas por bloques paginados, evitando sobrecargar la red
// o el límite de memoria del navegador. Incluye topes de seguridad contra
// bucles infinitos y deduplicación en memoria.
// ---------------------------------------------------------------------------

/**
 * Recorre páginas hasta agotar los datos o alcanzar el tope de seguridad.
 * @param {Function} fetchPagina (desde, limite) => Promise<Array>
 * @param {number} pageSize Cantidad de filas por petición
 * @param {number} maxPaginas Límite máximo de páginas a consultar
 * @param {Function} [onPagina] Callback opcional ejecutado por cada lote
 * @returns {Promise<{filas: Array, paginasDescargadas: number, completa: boolean}>}
 */
export const paginarConsulta = async ({ fetchPagina, pageSize = 200, maxPaginas = 25, onPagina }) => {
  const filas = [];
  const vistas = new Set();
  let paginasDescargadas = 0;
  let alcanzadoFinal = false;

  for (let pagina = 0; pagina < maxPaginas; pagina += 1) {
    const desde = pagina * pageSize;
    const lote = await fetchPagina(desde, pageSize);
    
    if (!Array.isArray(lote) || lote.length === 0) {
      alcanzadoFinal = true;
      break;
    }

    let nuevas = 0;
    for (let i = 0; i < lote.length; i += 1) {
      const fila = lote[i];
      const idValido = fila?.id !== null && fila?.id !== undefined ? String(fila.id) : null;
      const clave = idValido 
        ?? `${String(fila?.cedula || '').trim()}:${String(fila?.nombre || '').trim()}:${String(fila?.fecha || '')}:${pagina}_${i}`;

      if (vistas.has(clave)) continue;
      vistas.add(clave);
      filas.push(fila);
      nuevas += 1;
    }

    paginasDescargadas += 1;

    if (typeof onPagina === 'function') {
      try {
        await onPagina(lote, pagina);
      } catch (err) {
        console.warn('[paginacion] Advertencia en callback onPagina:', err);
      }
    }

    // Última página: el servidor devolvió menos filas de las solicitadas
    if (lote.length < pageSize) {
      alcanzadoFinal = true;
      break;
    }

    // Si no hubo ninguna fila nueva en este bloque, detenemos para evitar bucles por orden inestable
    if (nuevas === 0) {
      alcanzadoFinal = true;
      break;
    }
  }

  return { 
    filas, 
    paginasDescargadas, 
    completa: alcanzadoFinal 
  };
};
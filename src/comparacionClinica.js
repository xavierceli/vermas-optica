// ---------------------------------------------------------------------------
// COMPARACION DE UN CONFLICTO CLINICO
// ---------------------------------------------------------------------------
// Cuando dos equipos editan la misma ficha, el panel avisa del conflicto pero
// no mostraba QUE se estaba guardando ni QUE habia quedado en el servidor. Sin
// esa comparacion, "Reintentar" y "Descartar" se eligen a ciegas.
//
// Modulo puro: recibe el payload del outbox y la fila actual del servidor, y
// devuelve filas listas para mostrar. Sin Supabase ni IndexedDB, para probarlo
// con node --test.
// ---------------------------------------------------------------------------
import { resumenDeVersion } from './revisionesResumen.js';

const texto = valor => (valor === null || valor === undefined ? '' : String(valor).trim());

/**
 * La consulta que este equipo intento subir, tal como viaja en el outbox.
 *
 * @param {object} payload payload.p_payload de una operacion GUARDAR_CONSULTA
 * @returns {object|null}
 */
export const resumenCambioPendiente = payload => {
  const consulta = payload?.p_payload?.consulta;
  return consulta && typeof consulta === 'object' ? consulta : null;
};

/**
 * Filas "dato / tu cambio / servidor" con la marca de diferencia.
 *
 * Se comparan los mismos cuatro bloques que ya muestra el historial de
 * versiones, para que el optometra lea lo mismo en los dos sitios.
 *
 * @param {object} pendiente consulta del outbox
 * @param {object} servidor fila actual de consultas_clinicas
 * @returns {Array<{campo: string, etiqueta: string, pendiente: string, servidor: string, distinto: boolean}>}
 */
export const compararClinica = (pendiente, servidor) => {
  if (!pendiente || !servidor) return [];

  const mio = resumenDeVersion(pendiente);
  const otro = resumenDeVersion(servidor);

  return [
    { campo: 'fecha', etiqueta: 'Fecha', pendiente: texto(mio.fecha), servidor: texto(otro.fecha) },
    { campo: 'od', etiqueta: 'Ojo derecho', pendiente: texto(mio.od), servidor: texto(otro.od) },
    { campo: 'oi', etiqueta: 'Ojo izquierdo', pendiente: texto(mio.oi), servidor: texto(otro.oi) },
    { campo: 'notas', etiqueta: 'Notas', pendiente: texto(mio.notas), servidor: texto(otro.notas) }
  ].map(fila => ({ ...fila, distinto: fila.pendiente !== fila.servidor }));
};

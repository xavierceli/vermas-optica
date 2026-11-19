// ---------------------------------------------------------------------------
// CONSULTA CLINICA ACTUAL EN EL SERVIDOR
// ---------------------------------------------------------------------------
// Lectura puntual de una ficha para compararla con el cambio que quedo en la
// cola. Es solo SELECT: la tabla es de lectura para los usuarios autenticados
// (migracion 012) y nunca se escribe desde el navegador.
// ---------------------------------------------------------------------------
import { supabase } from '../supabaseClient.js';

/**
 * Fila actual de consultas_clinicas, o null si ya no existe.
 *
 * @param {string} consultaId
 * @returns {Promise<object|null>}
 */
export const cargarConsultaServidor = async consultaId => {
  if (!consultaId) return null;

  const { data, error } = await supabase
    .from('consultas_clinicas')
    .select('*')
    .eq('id', consultaId)
    .limit(1);

  if (error) throw error;
  return (data || [])[0] || null;
};

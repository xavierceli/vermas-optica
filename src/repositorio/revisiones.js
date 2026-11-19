// ---------------------------------------------------------------------------
// REVISIONES DE UNA CONSULTA
// ---------------------------------------------------------------------------
// Lee el historial de versiones que el servidor guarda antes de cada edicion.
// La logica vive en public.revisiones_consulta (migracion 026): se pide por
// RPC para no abrir la tabla completa a los clientes.
// ---------------------------------------------------------------------------
import { supabase } from '../supabaseClient.js';

export const LIMITE_REVISIONES = 20;

/**
 * Versiones anteriores de una consulta, de la mas reciente a la mas antigua.
 * Si la migracion 026 aun no esta aplicada, Supabase devuelve un error y la
 * interfaz lo muestra sin romper el panel.
 *
 * @param {string} consultaId
 * @param {number} [limite]
 * @returns {Promise<Array<{version:number, motivo:string|null, editado_en:string, editado_por:string, snapshot:object}>>}
 */
export const listarRevisionesConsulta = async (consultaId, limite = LIMITE_REVISIONES) => {
  if (!consultaId) return [];

  const { data, error } = await supabase.rpc('revisiones_consulta', {
    p_consulta_id: consultaId,
    p_limite: limite
  });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

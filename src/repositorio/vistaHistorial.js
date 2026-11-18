// ---------------------------------------------------------------------------
// ACCESO A LA VISTA DE HISTORIAL
// ---------------------------------------------------------------------------
// La vista versionada (migracion 024) trae la version de cada consulta, que es
// lo que permite detectar ediciones simultaneas. Si el servidor todavia no
// tiene esa migracion, se cae a vista_pacientes: las filas son compatibles y
// el historial sigue funcionando igual (solo sin version).
//
// Se aisla en su propio modulo para que la logica de datos local
// (repositorio/lectura.js) no dependa del cliente de Supabase.
// ---------------------------------------------------------------------------
import { supabase } from '../supabaseClient.js';

let vista = 'vista_pacientes_versionada';

/** Nombre de la vista que se esta usando (util para diagnostico y pruebas). */
export const nombreVistaHistorial = () => vista;

/** Vuelve a intentar la vista versionada (por ejemplo tras aplicar la 024). */
export const reiniciarVistaHistorial = () => { vista = 'vista_pacientes_versionada'; };

/**
 * Ejecuta una consulta sobre la vista de historial con caida automatica.
 *
 * @param {(nombreVista: string) => Promise<{data: any, error: any}>} construir
 *   Recibe el nombre de la vista y devuelve la promesa de Supabase.
 */
export const consultarHistorial = async construir => {
  let resultado = await construir(vista);

  if (resultado?.error && vista !== 'vista_pacientes') {
    console.warn(
      '[historial] vista_pacientes_versionada no disponible; se usa vista_pacientes:',
      resultado.error.message
    );
    vista = 'vista_pacientes';
    resultado = await construir(vista);
  }

  return resultado;
};

/**
 * Trae UNA fila del historial desde el servidor.
 *
 * @param {{id?: string, pedidoId?: string}} filtro
 *   `id` es el id de la consulta; `pedidoId` el de la venta. Se usa uno u otro
 *   segun el evento de Realtime que llego.
 * @returns {Promise<object|null>}
 */
export const cargarFilaHistorial = async ({ id = null, pedidoId = null } = {}) => {
  if (!id && !pedidoId) return null;

  const { data, error } = await consultarHistorial(nombre => {
    let consulta = supabase.from(nombre).select('*');
    consulta = id
      ? consulta.eq('id', id)
      : consulta.eq('pedido_id', pedidoId);
    return consulta.limit(1);
  });

  if (error) throw error;
  return (data || [])[0] || null;
};

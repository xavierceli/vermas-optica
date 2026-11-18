// ---------------------------------------------------------------------------
// RESUMEN DEL ESTADO DE TIEMPO REAL (para la interfaz)
// ---------------------------------------------------------------------------
// Realtime es una mejora: si el canal se cae, el sondeo de 30 s sigue trayendo
// los cambios. Por eso el aviso no debe alarmar ni aparecer al primer parpadeo
// de la red. Este modulo decide, sin depender de Supabase, que texto mostrar.
// ---------------------------------------------------------------------------

// A partir de cuanto tiempo caido merece la pena avisar en el panel.
export const UMBRAL_AVISO_TIEMPO_REAL_MS = 5 * 60 * 1000;

/**
 * @param {{ estado?: string, caidoMs?: number, online?: boolean }} datos
 * @returns {{ nivel: 'oculto'|'ok'|'espera'|'aviso', mensaje: string }}
 */
export const resumenTiempoReal = ({ estado = 'apagado', caidoMs = 0, online = true } = {}) => {
  // Sin sesion en la nube (modo PIN) o canal detenido: no hay nada que contar.
  if (estado === 'apagado') return { nivel: 'oculto', mensaje: '' };

  if (estado === 'SUBSCRIBED') {
    return {
      nivel: 'ok',
      mensaje: 'Tiempo real conectado: los cambios de otros equipos llegan al instante.'
    };
  }

  // Si no hay internet, ya se avisa arriba con el mensaje de conexion.
  if (!online) return { nivel: 'oculto', mensaje: '' };

  const transcurrido = Number(caidoMs) || 0;
  if (transcurrido >= UMBRAL_AVISO_TIEMPO_REAL_MS) {
    const minutos = Math.max(1, Math.floor(transcurrido / 60000));
    return {
      nivel: 'aviso',
      mensaje: `Tiempo real sin conexión desde hace ${minutos} min. Los cambios llegan igual cada 30 s.`
    };
  }

  return { nivel: 'espera', mensaje: 'Tiempo real reconectando…' };
};

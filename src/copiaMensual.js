// ---------------------------------------------------------------------------
// COPIA MENSUAL DE FOTOS Y COMPROBANTES
// ---------------------------------------------------------------------------
// El respaldo automatico copia las tablas de Supabase, nunca los archivos de
// Storage. Los comprobantes de pago son la evidencia de que un paciente pago y
// no se pueden reconstruir, asi que se copian a mano el dia 1 de cada mes.
//
// La app no puede saber si la copia se hizo: solo anota la fecha en la que el
// usuario lo confirma en este equipo y avisa cuando pasa mas de un mes.
// Modulo puro, sin React ni Dexie, para probarlo con node --test.

export const DIAS_ENTRE_COPIAS = 31;

const MS_DIA = 24 * 60 * 60 * 1000;

const aFecha = valor => {
  if (!valor) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
};

// Se comparan dias de calendario y no horas: una copia hecha a las 20:00 y
// consultada a las 08:00 del dia siguiente sigue siendo "de ayer".
const inicioDelDia = fecha => new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());

export const estadoCopiaMensual = ({ ultimo = null, hoy = new Date() } = {}) => {
  const ahora = aFecha(hoy) || new Date();
  const fecha = aFecha(ultimo);

  if (!fecha) {
    return {
      nivel: 'aviso',
      dias: null,
      ultimo: null,
      mensaje: 'Nunca se registró la copia mensual de comprobantes en este equipo.'
    };
  }

  // Un reloj adelantado no debe producir "hace -3 dias".
  const dias = Math.max(0, Math.round((inicioDelDia(ahora) - inicioDelDia(fecha)) / MS_DIA));
  const fechaTexto = fecha.toLocaleDateString('es-EC');

  if (dias >= DIAS_ENTRE_COPIAS) {
    return {
      nivel: 'aviso',
      dias,
      ultimo: fecha,
      mensaje: `La copia mensual de comprobantes está pendiente: la última fue hace ${dias} días (${fechaTexto}).`
    };
  }

  const hace = dias === 0 ? 'hoy' : dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
  return {
    nivel: 'ok',
    dias,
    ultimo: fecha,
    mensaje: `Última copia de comprobantes: ${fechaTexto} (${hace}).`
  };
};

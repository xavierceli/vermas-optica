// ---------------------------------------------------------------------------
// FECHAS CLINICAS
// ---------------------------------------------------------------------------
// Módulo puro, sin React ni Supabase, para poder probarlo con node --test.
//
// Evita el bug crítico de zona horaria:
// `new Date('1990-05-15')` se interpreta por especificación a medianoche UTC.
// En Ecuador (UTC-5), eso equivale a las 19:00 del día anterior, desfasando
// el cumpleaños y la edad del paciente en el informe optométrico y receta.
// ---------------------------------------------------------------------------

const FECHA_SOLO = /^\d{4}[-/.]\d{2}[-/.]\d{2}$/;

/** Nombres de mes en espanol. Fuente unica para toda la app. */
const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

/**
 * Nombre del mes y anio de una fecha, p. ej. "Octubre 2026".
 * Se usa en el panel de estadisticas. Antes el texto estaba escrito a mano
 * ("Octubre 2026") y nunca cambiaba: en noviembre el panel seguia rotulado con
 * octubre mientras mostraba los numeros de noviembre.
 * @param {Date} fecha
 */
export const nombreDelMes = (fecha = new Date()) => {
  const d = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date();
  return `${NOMBRES_MES[d.getMonth()]} ${d.getFullYear()}`;
};

/** Solo el nombre del mes, para etiquetas cortas como "Ingresos Mes (Oct)". */
export const nombreCortoDelMes = (fecha = new Date()) => {
  const d = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date();
  return NOMBRES_MES[d.getMonth()].slice(0, 3);
};

/**
 * Convierte un valor de fecha en un objeto Date a la medianoche LOCAL.
 * Acepta 'AAAA-MM-DD' e impide desbordamientos silenciosos (ej: 1990-02-31).
 */
export const parsearFechaLocal = (valor) => {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  const texto = String(valor).trim();
  if (!texto) return null;

  let fecha;
  if (FECHA_SOLO.test(texto)) {
    const normalizado = texto.replace(/[/.]/g, '-');
    const anio = Number(normalizado.slice(0, 4));
    const mes = Number(normalizado.slice(5, 7));
    const dia = Number(normalizado.slice(8, 10));
    fecha = new Date(anio, mes - 1, dia);

    // Date desborda en lugar de fallar: validamos que coincida exactamente
    if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
      return null;
    }
  } else {
    fecha = new Date(texto);
  }

  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

/** Retorna la fecha local actual a medianoche (sin horas/minutos). */
export const hoyLocal = (ahora = new Date()) =>
  new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());

/**
 * Calcula la edad en años cumplidos.
 * Devuelve '' si no hay fecha o es inválida; 0 si es un recién nacido o fecha futura.
 *
 * @param {string|Date} fechaNacimiento
 * @param {Date} [hoy] Fecha de referencia (útil para pruebas unitarias)
 */
export const calcularEdad = (fechaNacimiento, hoy = new Date()) => {
  try {
    const nacimiento = parsearFechaLocal(fechaNacimiento);
    if (!nacimiento) return '';

    const referencia = hoyLocal(hoy);
    if (nacimiento > referencia) return 0;

    let edad = referencia.getFullYear() - nacimiento.getFullYear();
    const meses = referencia.getMonth() - nacimiento.getMonth();
    
    if (meses < 0 || (meses === 0 && referencia.getDate() < nacimiento.getDate())) {
      edad -= 1;
    }

    return Math.max(0, edad);
  } catch {
    return '';
  }
};
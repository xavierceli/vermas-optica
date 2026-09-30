// ---------------------------------------------------------------------------
// FECHAS CLINICAS
// ---------------------------------------------------------------------------
// Modulo puro, sin React ni Supabase, para poder probarlo con node --test.
//
// EL ERROR QUE ESTE MODULO EVITA
// `new Date('1990-05-15')` NO se interpreta a medianoche local: segun la
// especificacion, una cadena de solo fecha se lee como MEDIANOCHE UTC. En
// Ecuador (UTC-5) eso es el 14 de mayo a las 19:00, y la edad del paciente se
// adelantaba un dia entero: el 14 de mayo la app ya decia "36 años" cuando
// cumplia 35. Medido, no supuesto.
//
// La edad de un paciente es un dato de salud: va en la receta, en el informe y
// sirve para decidir el tipo de lente. No puede quedar unaedad aproximada.

const FECHA_SOLO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convierte un valor de fecha en un Date a la HORA LOCAL, sin sorpresas de zona
 * horaria. Acepta 'AAAA-MM-DD' (lo que dan los <input type="date"> y las columnas
 * `date` de Postgres) y, si viene con hora, respeta ese instante.
 */
export const parsearFechaLocal = (valor) => {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  const texto = String(valor).trim();
  if (!texto) return null;
  let fecha;
  if (FECHA_SOLO.test(texto)) {
    const anio = Number(texto.slice(0, 4));
    const mes = Number(texto.slice(5, 7));
    const dia = Number(texto.slice(8, 10));
    fecha = new Date(anio, mes - 1, dia);
    // El constructor de Date DESBORDA en vez de fallar: "1990-13-45" se
    // convertiria en enero de 1991 sin avisar. Se comprueba que no hay desborde.
    if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
      return null;
    }
  } else {
    fecha = new Date(texto);
  }
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

/** El "hoy" local, sin la hora: evita que un `new Date()` con hora Compare mal. */
export const hoyLocal = (ahora = new Date()) =>
  new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());

/**
 * Edad en años cumplidos. Devuelve '' si no hay fecha o es ilegible, como antes:
 * la interfaz ya trata '' como "sin dato" y lo muestra como guion.
 *
 * @param {string|Date} fechaNacimiento
 * @param {Date} [hoy] solo para las pruebas
 */
export const calcularEdad = (fechaNacimiento, hoy = new Date()) => {
  try {
    const nacimiento = parsearFechaLocal(fechaNacimiento);
    if (!nacimiento) return '';
    const referencia = hoyLocal(hoy);
    let edad = referencia.getFullYear() - nacimiento.getFullYear();
    const meses = referencia.getMonth() - nacimiento.getMonth();
    if (meses < 0 || (meses === 0 && referencia.getDate() < nacimiento.getDate())) edad -= 1;
    return edad;
  } catch {
    return '';
  }
};
// ---------------------------------------------------------------------------
// CUANDO SUBEN LOS DATOS: QUE DECIRLE AL USUARIO
// ---------------------------------------------------------------------------
// La app guarda todo en el equipo y lo sube despues. El usuario siempre hace la
// misma pregunta: "¿cuando sube esto?". Y la respuesta NO es la misma en los dos
// casos que existen:
//
//   - Sin internet: sube solo cuando vuelva la conexion.
//   - Sin sesion (modo PIN local, o sesion expirada): hay internet, pero nada se
//     sube hasta que el usuario entre con su correo y su contraseña.
//
// Antes los avisos decian siempre "al recuperar conexión". Con el PIN activo eso
// es falso: el usuario se quedaba mirando la barra de estado esperando una subida
// que nunca ocurre. Aqui vive la frase correcta, en un solo lugar y sin React ni
// Supabase, para poder probarla con node --test.
// ---------------------------------------------------------------------------

/**
 * Completa la frase "se subirá ...".
 * @param {boolean} sinSesion true cuando no hay sesión con la nube (modo PIN o sesión expirada).
 * @returns {string} "al iniciar sesión" o "al recuperar conexión".
 */
export const cuandoSube = sinSesion => (sinSesion ? 'al iniciar sesión' : 'al recuperar conexión');

/** Barra de estado: hay operaciones esperando en la cola de salida. */
export const textoColaPendiente = sinSesion => `Se subirán ${cuandoSube(sinSesion)}`;

/** Aviso al guardar una venta que todavía no llegó a la nube. */
export const textoVentaPendiente = sinSesion =>
  `Venta guardada localmente. Se subirá ${cuandoSube(sinSesion)}.`;

/** Aviso al guardar una consulta clínica que todavía no llegó a la nube. */
export const textoConsultaPendiente = sinSesion =>
  sinSesion
    ? 'Consulta guardada en este dispositivo. Se subirá a la nube al iniciar sesión.'
    : 'Consulta guardada en este dispositivo. Se subirá a la nube en unos segundos.';

/** Aviso al guardar un producto cuya fotografía todavía no subió a la nube. */
export const textoFotoPendiente = sinSesion =>
  `Producto guardado. La fotografía se subirá a la nube ${cuandoSube(sinSesion)}.`;

/** Aviso al guardar un comprobante de pago que todavía no subió a la nube. */
export const textoComprobantePendiente = sinSesion =>
  `Comprobante guardado localmente. Se subirá ${cuandoSube(sinSesion)}.`;

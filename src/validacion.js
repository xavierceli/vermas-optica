// ---------------------------------------------------------------------------
// VALIDACION DE LA FICHA CLINICA
// ---------------------------------------------------------------------------
// Antes these reglas vivian dentro de useGestor y solo devolvian un mensaje
// generico ("FALTAN DATOS"), sin decir que campo faltaba. Con 18 campos de
// refraccion, el usuario no tenia forma de saber cual. Aqui cada campo tiene
// nombre legible y se accumulates la lista de faltantes.
//
// Reglas que corrigen un fallo real de validacion:
//  - El NOMBRE es obligatorio. Se permitia guardar una ficha con solo cedula,
//    y eso rompia el historial: la venta pedia el nombre despues y fallaba.
//  - Cedula y nombre se validan juntos y se reportan los DOS problemas a la vez,
//    no de uno en uno: si no, el usuario corrige uno, guarda, y descubre el otro.

/** Nombre legible de cada campo clinico para mostrarlo en los mensajes. */
export const ETIQUETAS_CAMPOS = {
  avsl_od: 'AVS Lejos OD', avsc_od: 'AVS Cerca OD', esfera_od: 'Esfera OD',
  cilindro_od: 'Cilindro OD', eje_od: 'Eje OD', adicion_od: 'Adicion OD',
  dnp_od: 'DNP OD', avcl_od: 'AVC Lejos OD', avcc_od: 'AVC Cerca OD',
  avsl_oi: 'AVS Lejos OI', avsc_oi: 'AVS Cerca OI', esfera_oi: 'Esfera OI',
  cilindro_oi: 'Cilindro OI', eje_oi: 'Eje OI', adicion_oi: 'Adicion OI',
  dnp_oi: 'DNP OI', avcl_oi: 'AVC Lejos OI', avcc_oi: 'AVC Cerca OI'
};

const REFRACCION_OBLIGATORIA = Object.keys(ETIQUETAS_CAMPOS);

/** El documento admite cedula numerica (10 o 13 digitos), pasaporte o 9999999999. */
export const documentoValido = doc => {
  const str = String(doc ?? '').trim().toUpperCase();
  if (!str) return false;
  if (str === '9999999999') return true;          // consumidor final
  if (/^\d{10}$/.test(str) || /^\d{13}$/.test(str)) return true;
  // Pasaporte: 5 a 20 caracteres con letras Y digitos. Exigir ambos es
  // deliberado: una palabra suelta como "ABCDE" no es un documento, y aceptarla
  // dejaba pasar valores que no identifican a nadie.
  if (/^[A-Z0-9]{5,20}$/.test(str) && /[A-Z]/.test(str) && /\d/.test(str)) return true;
  return false;
};

/** Explica POR QUE un documento no es valido, en vez de un si/no. */
export const motivoDocumentoInvalido = doc => {
  const str = String(doc ?? '').trim().toUpperCase();
  if (!str) return 'Falta la cedula o documento';
  if (!documentoValido(str)) {
    return 'La cedula "' + str + '" no es valida. Debe tener 10 o 13 digitos, o ser un pasaporte.';
  }
  return null;
};

/**
 * Valida la ficha completa.
 * @returns {{ ok: boolean, faltantes: string[], mensaje: string|null }}
 */
export const validarFichaClinica = paciente => {
  const faltantes = [];

  const documento = String(paciente?.cedula ?? '').trim();
  if (!documento) faltantes.push('Cedula o documento');
  else if (!documentoValido(documento)) faltantes.push('Cedula valida (10 o 13 digitos, o pasaporte)');

  // BUG CORREGIDO: el nombre es obligatorio. Se permitia guardar sin el, y la
  // venta fallaba despues con "El nombre del paciente es obligatorio".
  const nombre = String(paciente?.nombre ?? '').trim();
  if (!nombre) faltantes.push('Nombre del paciente');

  const sinRefraccion = REFRACCION_OBLIGATORIA
    .filter(campo => String(paciente?.[campo] ?? '').trim() === '')
    .map(campo => ETIQUETAS_CAMPOS[campo]);

  if (sinRefraccion.length > 0) {
    faltantes.push(`Los ${sinRefraccion.length} datos de refraccion`);
  }

  return {
    ok: faltantes.length === 0,
    faltantes,
    sinRefraccion,
    mensaje: construirMensajeFaltantes(faltantes, sinRefraccion)
  };
};

/** Redacta el mensaje: primero lo esencial, luego el detalle de refraccion. */
export const construirMensajeFaltantes = (faltantes, sinRefraccion = []) => {
  if (faltantes.length === 0) return null;

  const partes = [];
  if (faltantes.includes('Cedula o documento')) partes.push('la cedula');
  if (faltantes.includes('Cedula valida (10 o 13 digitos, o pasaporte)')) partes.push('una cedula valida');
  if (faltantes.includes('Nombre del paciente')) partes.push('el nombre del paciente');
  if (faltantes.includes('Los 18 datos de refraccion')) partes.push('los 18 datos de refraccion');

  let mensaje = 'Falta completar: ' + partes.join(', ') + '.';

  // Con 18 campos, enumerarlos todos es util pero se resume si son muchos.
  if (sinRefraccion.length > 0) {
    const lista = sinRefraccion.length <= 6
      ? sinRefraccion.join(', ')
      : sinRefraccion.slice(0, 6).join(', ') + ` y ${sinRefraccion.length - 6} mas`;
    mensaje += `\n\nDatos de refraccion vacios: ${lista}.`;
  }
  return mensaje;
};

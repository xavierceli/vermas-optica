// ---------------------------------------------------------------------------
// VALIDACION DE LA FICHA CLINICA
// ---------------------------------------------------------------------------
// Módulo puro para validación estricta de expedientes clínicos y pacientes.
//
// Reglas de negocio:
//  - El NOMBRE es obligatorio para emitir órdenes, recibos y trazabilidad.
//  - La CÉDULA o DOCUMENTO admite 10 dígitos (cédula), 13 dígitos (RUC),
//    consumidor final (9999999999) o pasaporte alfanumérico.
//  - Valida y enumera con precisión los campos de refracción pendientes.
// ---------------------------------------------------------------------------

/** Nombre legible de cada campo clínico para los mensajes informativos. */
export const ETIQUETAS_CAMPOS = {
  avsl_od: 'AVS Lejos OD', avsc_od: 'AVS Cerca OD', esfera_od: 'Esfera OD',
  cilindro_od: 'Cilindro OD', eje_od: 'Eje OD', adicion_od: 'Adición OD',
  dnp_od: 'DNP OD', avcl_od: 'AVC Lejos OD', avcc_od: 'AVC Cerca OD',
  avsl_oi: 'AVS Lejos OI', avsc_oi: 'AVS Cerca OI', esfera_oi: 'Esfera OI',
  cilindro_oi: 'Cilindro OI', eje_oi: 'Eje OI', adicion_oi: 'Adición OI',
  dnp_oi: 'DNP OI', avcl_oi: 'AVC Lejos OI', avcc_oi: 'AVC Cerca OI'
};

const REFRACCION_OBLIGATORIA = Object.keys(ETIQUETAS_CAMPOS);

/** El documento admite cédula numérica (10 o 13 dígitos), pasaporte o 9999999999. */
export const documentoValido = doc => {
  const str = String(doc ?? '').trim().toUpperCase();
  if (!str) return false;
  if (str === '9999999999') return true;          // Consumidor final
  if (/^\d{10}$/.test(str) || /^\d{13}$/.test(str)) return true;
  // Pasaporte: 5 a 20 caracteres con letras y dígitos
  if (/^[A-Z0-9]{5,20}$/.test(str) && /[A-Z]/.test(str) && /\d/.test(str)) return true;
  return false;
};

/** Explica el motivo de invalidez de un documento. */
export const motivoDocumentoInvalido = doc => {
  const str = String(doc ?? '').trim().toUpperCase();
  if (!str) return 'Falta la cédula o documento';
  if (!documentoValido(str)) {
    return 'La cédula "' + str + '" no es válida. Debe tener 10 o 13 dígitos, o ser un pasaporte.';
  }
  return null;
};

/**
 * Valida la ficha clínica completa antes de guardar.
 * @returns {{ ok: boolean, faltantes: string[], sinRefraccion: string[], mensaje: string|null }}
 */
export const validarFichaClinica = paciente => {
  const faltantes = [];

  const documento = String(paciente?.cedula ?? '').trim();
  if (!documento) {
    faltantes.push('Cédula o documento');
  } else if (!documentoValido(documento)) {
    faltantes.push('Cédula válida (10 o 13 dígitos, o pasaporte)');
  }

  const nombre = String(paciente?.nombre ?? '').trim();
  if (!nombre) {
    faltantes.push('Nombre del paciente');
  }

  const sinRefraccion = REFRACCION_OBLIGATORIA
    .filter(campo => String(paciente?.[campo] ?? '').trim() === '')
    .map(campo => ETIQUETAS_CAMPOS[campo]);

  if (sinRefraccion.length > 0) {
    faltantes.push(
      sinRefraccion.length === 1
        ? '1 dato de refracción'
        : `${sinRefraccion.length} datos de refracción`
    );
  }

  return {
    ok: faltantes.length === 0,
    faltantes,
    sinRefraccion,
    mensaje: construirMensajeFaltantes(faltantes, sinRefraccion)
  };
};

/** Redacta el mensaje de validación con formato claro para el usuario. */
export const construirMensajeFaltantes = (faltantes, sinRefraccion = []) => {
  if (!faltantes || faltantes.length === 0) return null;

  const partes = [];
  if (faltantes.includes('Cédula o documento')) partes.push('la cédula');
  if (faltantes.includes('Cédula válida (10 o 13 dígitos, o pasaporte)')) partes.push('una cédula válida');
  if (faltantes.includes('Nombre del paciente')) partes.push('el nombre del paciente');
  
  if (sinRefraccion.length > 0) {
    partes.push(
      sinRefraccion.length === 1 
        ? '1 dato de refracción' 
        : `${sinRefraccion.length} datos de refracción`
    );
  }

  let mensaje = 'Falta completar: ' + partes.join(', ') + '.';

  if (sinRefraccion.length > 0) {
    const lista = sinRefraccion.length <= 6
      ? sinRefraccion.join(', ')
      : sinRefraccion.slice(0, 6).join(', ') + ` y ${sinRefraccion.length - 6} más`;
    mensaje += `\n\nDatos de refracción vacíos: ${lista}.`;
  }

  return mensaje;
};
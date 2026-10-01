// ---------------------------------------------------------------------------
// AVISOS DE LA APLICACION (Toast global sin dependencias de React)
// ---------------------------------------------------------------------------
// Proporciona un canal reactivo centralizado para mostrar notificaciones,
// alertas de validación y errores sin usar los bloqueantes alert() ni confirm().
// ---------------------------------------------------------------------------

let actual = null;
let temporizador = null;
const suscriptores = new Set();

const notificar = valor => {
  for (const fn of suscriptores) {
    try { 
      fn(valor); 
    } catch { 
      /* Silencioso para proteger otros observadores */ 
    }
  }
};

/** 
 * Muestra un aviso en pantalla.
 * @param {string} mensaje Texto a mostrar
 * @param {'success'|'warning'|'error'} tipo Tipo de alerta
 * @param {number} duracion Duración en milisegundos (0 para dejarlo fijo)
 */
export const mostrarAviso = (mensaje, tipo = 'success', duracion = 3500) => {
  if (mensaje === null || mensaje === undefined || mensaje === '') return null;
  
  if (temporizador) { 
    clearTimeout(temporizador); 
    temporizador = null; 
  }

  actual = { 
    id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    mensaje: String(mensaje), 
    tipo: tipo || 'success' 
  };
  
  notificar(actual);

  if (duracion > 0) {
    temporizador = setTimeout(() => { 
      actual = null; 
      temporizador = null; 
      notificar(null); 
    }, duracion);

    if (typeof temporizador?.unref === 'function') {
      temporizador.unref();
    }
  }

  return actual;
};

export const cerrarAviso = () => {
  if (temporizador) { 
    clearTimeout(temporizador); 
    temporizador = null; 
  }
  actual = null;
  notificar(null);
  return null;
};

export const leerAviso = () => actual;

/**
 * Se suscribe a los cambios del canal de avisos.
 * Devuelve la función de limpieza (unsubscribe).
 */
export const suscribirAvisos = fn => {
  if (typeof fn !== 'function') return () => {};
  suscriptores.add(fn);
  
  try { 
    fn(actual); 
  } catch { 
    /* Silencioso */ 
  }

  return () => { 
    suscriptores.delete(fn); 
  };
};

/** Atajo para registrar fallos y errores del sistema o peticiones */
export const avisarError = (mensaje, detalle) => {
  const textoDetalle = detalle instanceof Error 
    ? detalle.message 
    : (detalle?.message || (detalle ? String(detalle) : ''));
    
  return mostrarAviso(textoDetalle ? `${mensaje}: ${textoDetalle}` : mensaje, 'error');
};

/** Atajo para advertencias o validaciones que requieren atención */
export const avisarAviso = (mensaje, duracion = 6000) => 
  mostrarAviso(mensaje, 'warning', duracion);
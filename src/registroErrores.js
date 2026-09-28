// ---------------------------------------------------------------------------
// REGISTRO DE ERRORES EN EL DISPOSITIVO
// ---------------------------------------------------------------------------
// Logica pura y sin dependencias, para poder probarla con node --test (el resto
// de modulos que tocan Dexie necesitan IndexedDB, que no existe en Node).
//
// Que guarda: los ultimos errores en la tabla `meta` de Dexie, para poder
// diagnosticar sin pedirle al optometria que abra la consola del navegador.
// Antes el unico consejo de soporte era "revisa la consola (F12)", que no sirve
// en una optica: el error se perdia en el momento en que cerraba la pestana.

export const MAX_ERRORES = 20;
export const CLAVE_ERRORES = 'errores_recientes';

/** Convierte cualquier cosa lanzable en un registro legible y acotado. */
export const describirError = (error, contexto = '') => {
  const mensaje = error?.message ?? (typeof error === 'string' ? error : '');
  const pila = typeof error?.stack === 'string'
    ? error.stack.split('\n').slice(0, 5).map(line => line.trim()).join(' | ')
    : '';
  return {
    mensaje: String(mensaje || 'Sin mensaje').slice(0, 300),
    nombre: String(error?.name || 'Error').slice(0, 60),
    donde: String(contexto || '').slice(0, 60),
    pila: pila.slice(0, 600),
    hora: new Date().toISOString()
  };
};

/**
 * Anade un error al principio. Los errores identicos se agrupan: un componente
 * que revienta 200 veces por segundo no debe desplazar al resto del historial.
 */
export const agregarError = (lista, entrada) => {
  const previa = Array.isArray(lista) ? lista : [];
  const iguales = previa.filter(item => item.mensaje === entrada.mensaje);
  // Una entrada ya agrupada guarda cuantas veces ocurrio: se continua desde ahi.
  // Contar solo las filas hacia que el contador se quedara en 2 para siempre.
  const veces = iguales.reduce((total, item) => total + (item.repeticiones || 1), 0);
  const registro = veces > 0 ? { ...entrada, repeticiones: veces + 1 } : { ...entrada };
  const resto = previa.filter(item => item.mensaje !== entrada.mensaje);
  return [registro, ...resto].slice(0, MAX_ERRORES);
};

export const leerErrores = async meta => (await meta.get(CLAVE_ERRORES))?.value ?? [];
export const guardarErrores = async (meta, lista) =>
  meta.put({ key: CLAVE_ERRORES, value: lista, updatedAt: new Date().toISOString() });

export const registrarError = async (meta, error, contexto) => {
  const lista = await leerErrores(meta);
  await guardarErrores(meta, agregarError(lista, describirError(error, contexto)));
};

export const borrarErrores = async meta => meta.put({ key: CLAVE_ERRORES, value: [], updatedAt: new Date().toISOString() });

/** Una linea para un tooltip o un boton: que paso, no un volcado de datos. */
export const resumenErrores = (lista) => {
  if (!Array.isArray(lista) || lista.length === 0) return 'Sin errores registrados';
  const [primero] = lista;
  const repeticiones = primero.repeticiones > 1 ? ` (x${primero.repeticiones})` : '';
  const resto = lista.length - 1;
  return `${primero.mensaje}${repeticiones}${resto > 0 ? ` +${resto} más` : ''}`;
};

/** Texto que se pega en un correo o en WhatsApp para pedir ayuda. */
export const textoDiagnostico = ({ errores = [], pendientes = 0, version = '', online = null } = {}) => {
  const agente = globalThis.navigator?.userAgent || 'desconocido';
  const lineas = [
    'VER+ Óptica — diagnóstico',
    `Fecha: ${new Date().toLocaleString('es-EC')}`,
    `Versión desplegada: ${version || 'sin identificar'}`,
    `Conexión: ${online === null ? 'sin dato' : online ? 'en línea' : 'sin conexión'}`,
    `Operaciones en cola: ${pendientes}`,
    `Navegador: ${agente}`,
    '',
    'Errores registrados:',
    ...(Array.isArray(errores) && errores.length
      ? errores.map((e, i) => `${i + 1}. [${e.hora}] ${e.donde ? e.donde + ': ' : ''}${e.mensaje}${e.repeticiones > 1 ? ` (x${e.repeticiones})` : ''}`)
      : ['- ninguno']),
    ''
  ];
  return lineas.join('\n');
};
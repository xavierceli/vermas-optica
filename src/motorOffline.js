import localforage from 'localforage';

// 1. CONFIGURACIÓN DE LA BÓVEDA PRINCIPAL
localforage.config({
  name: 'VerMasOpticaDB',
  storeName: 'datos_offline'
});

// 2. GENERADOR DE IDs REALES (UUID - el estándar mundial)
// Desde ahora, un registro creado offline nace con SU identidad definitiva.
export const generarId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Respaldo para navegadores muy viejos:
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};

// Alias de compatibilidad: el código viejo llama generarIdFantasma
export const generarIdFantasma = () => generarId();

// 3. CANDADO (mutex): las escrituras a la bandeja se forman en fila
// Evita que dos operaciones simultáneas se pisen y borren tareas entre sí.
let candado = Promise.resolve();
const serializado = (fn) => {
  const resultado = candado.then(fn, fn);
  candado = resultado.catch(() => {});
  return resultado;
};

// 4. HERRAMIENTAS DE LECTURA Y ESCRITURA BÁSICA
export const leerBoveda = async (llave) => {
  try {
    return await localforage.getItem(llave);
  } catch (e) {
    console.warn(`Error leyendo la bóveda [${llave}]:`, e);
    return null;
  }
};

export const escribirBoveda = async (llave, datos) => {
  try {
    await localforage.setItem(llave, datos);
  } catch (e) {
    console.warn(`Error escribiendo en la bóveda [${llave}]:`, e);
  }
};

// 5. BANDEJA DE SALIDA (cola de sincronización)
export const encolarOperacion = (tabla, tipoOperacion, datos) => serializado(async () => {
  const colaActual = await leerBoveda('bandeja_salida') || [];

  const nuevaOperacion = {
    id_tarea: generarId(),
    tabla: tabla,
    tipo: tipoOperacion, // 'INSERT', 'UPDATE' o 'DELETE'
    datos: datos,
    fecha_intento: new Date().toISOString(),
    intentos: 0
  };

  await escribirBoveda('bandeja_salida', [...colaActual, nuevaOperacion]);
  return nuevaOperacion;
});

export const obtenerBandejaSalida = () => serializado(async () => {
  return await leerBoveda('bandeja_salida') || [];
});

export const eliminarTareaDeBandeja = (id_tarea) => serializado(async () => {
  const colaActual = await leerBoveda('bandeja_salida') || [];
  await escribirBoveda('bandeja_salida', colaActual.filter(tarea => tarea.id_tarea !== id_tarea));
});

// NUEVO: elimina TODAS las tareas pendientes de un registro específico.
// Se usa al borrar un registro creado offline, para que no "resucite" en la nube.
export const purgarTareasDeRegistro = (tabla, idRegistro) => serializado(async () => {
  const colaActual = await leerBoveda('bandeja_salida') || [];
  const colaLimpia = colaActual.filter(t =>
    !(t.tabla === tabla && t.datos && t.datos.id === idRegistro)
  );
  await escribirBoveda('bandeja_salida', colaLimpia);
});

// NUEVO: cementerio de tareas envenenadas (fallaron demasiadas veces).
// Así no se reintentan para siempre y puedes revisarlas con calma.
export const moverABandejaMuerta = (tarea, motivo) => serializado(async () => {
  const muertas = await leerBoveda('bandeja_muerta') || [];
  await escribirBoveda('bandeja_muerta', [
    ...muertas,
    { ...tarea, motivo: motivo || 'Desconocido', fecha_muerte: new Date().toISOString() }
  ]);
  await eliminarTareaDeBandeja(tarea.id_tarea);
});
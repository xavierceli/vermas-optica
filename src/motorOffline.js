import localforage from 'localforage';

// 1. CONFIGURACIÓN DE LA BÓVEDA PRINCIPAL
localforage.config({
  name: 'VerMasOpticaDB',
  storeName: 'datos_offline'
});

// 2. HERRAMIENTAS DE LECTURA Y ESCRITURA BÁSICA
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

// 3. GENERADOR DE IDs FANTASMAS (Prevención de Colisiones)
export const generarIdFantasma = () => {
  // Crea un código único como: "temp-4fxg7a-1698745"
  return 'temp-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();
};

// 4. BANDEJA DE SALIDA (Cola de Sincronización)
// Aquí guardaremos los pacientes o ventas cuando no haya internet
export const encolarOperacion = async (tabla, tipoOperacion, datos) => {
  const colaActual = await leerBoveda('bandeja_salida') || [];
  
  const nuevaOperacion = {
    id_tarea: generarIdFantasma(),
    tabla: tabla,
    tipo: tipoOperacion, // 'INSERT' (nuevo) o 'UPDATE' (editar)
    datos: datos,
    fecha_intento: new Date().toISOString()
  };

  colaActual.push(nuevaOperacion);
  await escribirBoveda('bandeja_salida', colaActual);
  
  console.log(`📦 Tarea guardada en bandeja de salida: ${tipoOperacion} en ${tabla}`);
  return nuevaOperacion;
};

// 5. LECTOR DE LA BANDEJA DE SALIDA
export const obtenerBandejaSalida = async () => {
  return await leerBoveda('bandeja_salida') || [];
};

// 6. LIMPIADOR DE TAREAS (Cuando ya se subieron a Supabase)
export const eliminarTareaDeBandeja = async (id_tarea) => {
  const colaActual = await leerBoveda('bandeja_salida') || [];
  const colaLimpia = colaActual.filter(tarea => tarea.id_tarea !== id_tarea);
  await escribirBoveda('bandeja_salida', colaLimpia);
};
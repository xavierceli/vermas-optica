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

// 3. HERRAMIENTAS DE LECTURA Y ESCRITURA BÁSICA

export const leerBoveda = async (llave) => {
  try {
    return await localforage.getItem(llave);
  } catch (e) {
    console.warn(`Error leyendo la bóveda [${llave}]:`, e);
    return null;
  }
};

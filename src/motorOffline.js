import localforage from 'localforage';
import { createUuid } from './localDb.js';

// 1. CONFIGURACIÓN DE LA BÓVEDA PRINCIPAL
localforage.config({
  name: 'VerMasOpticaDB',
  storeName: 'datos_offline'
});

// 2. GENERADOR DE IDs REALES (UUID v4 estándar)
// Reutiliza la función centralizada de alta entropía criptográfica de localDb
export const generarId = () => createUuid();

// Alias de compatibilidad hacia código heredado
export const generarIdFantasma = () => createUuid();

// 3. HERRAMIENTAS DE LECTURA Y ESCRITURA BÁSICA
export const leerBoveda = async (llave) => {
  try {
    return await localforage.getItem(llave);
  } catch (e) {
    console.warn(`Error leyendo la bóveda [${llave}]:`, e);
    return null;
  }
};
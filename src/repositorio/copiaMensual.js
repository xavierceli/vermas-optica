import { getMeta, setMeta } from '../localDb.js';

// La copia se hace a mano en Supabase, asi que la app no puede comprobarla:
// solo guarda en este equipo la fecha en la que el usuario confirma hacerla.
export const CLAVE_COPIA_MENSUAL = 'copiaMensualFotos';

export const leerUltimaCopiaMensual = () => getMeta(CLAVE_COPIA_MENSUAL, null);

export const registrarCopiaMensual = (fecha = new Date().toISOString()) =>
  setMeta(CLAVE_COPIA_MENSUAL, fecha);

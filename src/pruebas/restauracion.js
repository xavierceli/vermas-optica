// ---------------------------------------------------------------------------
// APOYO DEL SIMULACRO DE RESTAURACION
// ---------------------------------------------------------------------------
// Restaurar un volcado de Supabase en un PostgreSQL limpio tiene dos trampas
// que no se ven hasta que se intenta:
//
//   1. `public.perfiles.user_id` tiene una clave foranea contra `auth.users`,
//      pero el volcado solo trae el esquema `public`. Si `perfiles` tiene
//      filas, la restauracion falla al crear la clave foranea porque esos
//      usuarios no existen. Hay que recrear antes los ids en `auth.users`.
//   2. Los conteos deben coincidir con los del volcado. Si falta una tabla o
//      se restauro a medias, se detecta aqui.
//
// Este modulo contiene la logica pura (sin base de datos) para que se pueda
// probar con `node --test`.
// ---------------------------------------------------------------------------

import { TABLAS_CRITICAS } from './verificarRespaldo.js';

const CABECERA_COPY_PERFILES = /^COPY\s+(?:public\.)?"?perfiles"?\s*\(([^)]*)\)\s+FROM stdin;\s*$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extrae los `user_id` de las filas de `public.perfiles` del volcado.
 * Hacen falta para recrear `auth.users` antes de restaurar (ver arriba).
 */
export const extraerIdsPerfiles = sql => {
  const lineas = String(sql || '').split('\n');
  const ids = new Set();

  for (let i = 0; i < lineas.length; i += 1) {
    const cabecera = CABECERA_COPY_PERFILES.exec(lineas[i]);
    if (!cabecera) continue;

    const columnas = cabecera[1].split(',').map(columna => columna.trim().replace(/^"|"$/g, '').toLowerCase());
    const posicion = columnas.indexOf('user_id');
    if (posicion === -1) continue;

    for (let j = i + 1; j < lineas.length; j += 1) {
      if (lineas[j] === '\\.') {
        i = j;
        break;
      }
      const id = lineas[j].split('\t')[posicion];
      if (id && UUID.test(id)) ids.add(id.toLowerCase());
    }
  }

  return [...ids];
};

/** SQL para recrear en `auth.users` los ids que referencia `perfiles`. */
export const sqlInsertarUsuarios = ids => {
  if (!Array.isArray(ids) || ids.length === 0) return 'select 1;\n';
  const valores = ids.map(id => `('${id}')`).join(',\n  ');
  return `insert into auth.users (id) values\n  ${valores}\non conflict (id) do nothing;\n`;
};

/**
 * Compara las filas contadas en el volcado con las contadas en la base
 * restaurada. Devuelve una lista de diferencias (vacia si todo coincide).
 */
export const compararConteos = (esperado, real, tablas = TABLAS_CRITICAS) => {
  const diferencias = [];

  for (const tabla of tablas) {
    if (esperado?.[tabla] === undefined) continue;
    if (real?.[tabla] === undefined) {
      diferencias.push(`${tabla}: no se pudo contar en la base restaurada`);
      continue;
    }
    const esperadas = Number(esperado[tabla]);
    const restauradas = Number(real[tabla]);
    if (esperadas !== restauradas) {
      diferencias.push(`${tabla}: el respaldo tiene ${esperadas} filas y la restauracion ${restauradas}`);
    }
  }

  return diferencias;
};

export const formatearComparacion = (esperado, real, diferencias) => {
  const lineas = ['Conteos (respaldo -> restaurado):'];
  for (const tabla of TABLAS_CRITICAS) {
    if (esperado?.[tabla] === undefined) continue;
    const marca = Number(esperado[tabla]) === Number(real?.[tabla]) ? 'OK ' : 'NO ';
    lineas.push(`  ${marca}${tabla}: ${esperado[tabla]} -> ${real?.[tabla] ?? '?'}`);
  }
  for (const diferencia of diferencias) lineas.push(`ERROR: ${diferencia}`);
  lineas.push(diferencias.length === 0
    ? 'OK: la restauracion coincide con el respaldo.'
    : 'FALLO: la restauracion NO coincide.');
  return lineas.join('\n');
};

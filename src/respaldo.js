// ---------------------------------------------------------------------------
// RESPALDO LOCAL DEL DISPOSITIVO
// ---------------------------------------------------------------------------
// Logica pura salvo la base, que se recibe como parametro: asi se puede probar
// con node --test (los modulos que importan localDb necesitan IndexedDB).
//
// Por que existe: la app es offline-first, asi que todo lo que se guarda sin
// conexion vive SOLO en este dispositivo. Si se rompe el equipo, se limpia la
// cache del navegador o se borra el perfil, esa semana de trabajo se pierde sin
// dejar rastro. Un archivo .json en el escritorio es la unica copia que no
// depende del navegador.
//
// Decisiones importantes:
//   - No se respaldan `meta` (estado de la maquina: PIN, errores) ni `cache`
//     (copia de lo que ya esta en la nube y se regenera al sincronizar).
//   - Restaurar agrega solo registros ausentes: nunca reemplaza ni borra lo
//     que ya existe en el dispositivo.
import { estimarPesoRespaldo } from './pesoRespaldo.js';

export const FORMATO_RESPALDO = 'verplus-respaldo';
export const VERSION_RESPALDO = 1;

export const TABLAS = [
  'patients', 'consultations', 'sales', 'saleItems', 'payments',
  'inventory', 'prices', 'inventoryMovements', 'outbox', 'attachments'
];

// --- Binarios: un Blob no se puede meter en un JSON ------------------------
const TROZO = 0x8000;

export const blobABase64 = async blob => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = '';
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + TROZO));
  }
  return btoa(binario);
};

export const base64ABlob = (base64, mime) => {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
};

/** Lee el estado completo del dispositivo y lo devuelve como objeto plano. */
export const construirRespaldo = async (db) => {
  const tablas = {};
  const conteos = {};
  for (const nombre of TABLAS) {
    const filas = await db[nombre].toArray();
    conteos[nombre] = filas.length;
    // El binario va aparte: en las filas de adjuntos solo quedan los metadatos.
    // (Quitar el Blob con delete y no con desestructuracion: si no, el linter
    // ve una variable declarada y no usada.)
    tablas[nombre] = nombre === 'attachments'
      ? filas.map(fila => {
        const copia = { ...fila };
        delete copia.blob;
        return copia;
      })
      : filas;
  }

  const binarios = [];
  for (const fila of await db.attachments.toArray()) {
    if (fila.blob instanceof Blob) {
      binarios.push({
        id: fila.id,
        mime: fila.blob.type || 'application/octet-stream',
        base64: await blobABase64(fila.blob)
      });
    }
  }

  return {
    formato: FORMATO_RESPALDO,
    version: VERSION_RESPALDO,
    generadoEn: new Date().toISOString(),
    conteos,
    tablas,
    binarios
  };
};

/** Lee el texto de un archivo con mensajes que el optometria entienda. */
export const parsearRespaldo = texto => {
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error('Ese archivo no se pudo leer: no es un respaldo de VER+ Óptica.');
  }
  if (datos?.formato !== FORMATO_RESPALDO) {
    throw new Error('Ese archivo no es un respaldo de VER+ Óptica.');
  }
  if (Number(datos.version) > VERSION_RESPALDO) {
    throw new Error('El respaldo es de una versión más nueva de la app. Actualiza la app antes de restaurarlo.');
  }
  if (!Number.isInteger(Number(datos.version)) || Number(datos.version) < 1) {
    throw new Error('La versión de este respaldo no es válida.');
  }
  if (!datos.tablas || typeof datos.tablas !== 'object' || Array.isArray(datos.tablas)) {
    throw new Error('El respaldo está incompleto y no se puede restaurar con seguridad.');
  }
  for (const nombre of TABLAS) {
    const filas = datos.tablas[nombre];
    if (filas !== undefined && !Array.isArray(filas)) {
      throw new Error('El respaldo está incompleto y no se puede restaurar con seguridad.');
    }
    const ids = new Set();
    for (const fila of filas || []) {
      if (!fila || typeof fila !== 'object' || Array.isArray(fila) ||
          !['string', 'number'].includes(typeof fila.id) || fila.id === '' ||
          (typeof fila.id === 'number' && !Number.isFinite(fila.id))) {
        throw new Error('El respaldo contiene un registro incompleto y no se puede restaurar con seguridad.');
      }
      if (ids.has(fila.id)) {
        throw new Error('El respaldo contiene identificadores repetidos y no se puede restaurar con seguridad.');
      }
      ids.add(fila.id);
    }
  }
  if (datos.binarios !== undefined && !Array.isArray(datos.binarios)) {
    throw new Error('Los archivos adjuntos del respaldo no tienen un formato válido.');
  }
  return datos;
};
/** Agrega solo filas ausentes; una restauración nunca reemplaza filas locales. */
export const restaurarRespaldo = async (db, respaldo) => {
  if (respaldo?.formato !== FORMATO_RESPALDO || Number(respaldo.version) !== VERSION_RESPALDO) {
    throw new Error('El formato del respaldo no es compatible con esta versión de VER+.');
  }
  if (!respaldo.tablas || typeof respaldo.tablas !== 'object' || Array.isArray(respaldo.tablas)) {
    throw new Error('El respaldo está incompleto y no se puede restaurar con seguridad.');
  }

  // Preparar y validar todo antes de abrir la transacción evita una restauración parcial.
  const binarios = new Map();
  for (const binario of respaldo.binarios || []) {
    if (!binario || binario.id === undefined || typeof binario.base64 !== 'string' || binarios.has(binario.id)) {
      throw new Error('Los archivos adjuntos del respaldo no tienen un formato válido.');
    }
    binarios.set(binario.id, binario);
  }

  const listas = {};
  for (const nombre of TABLAS) {
    const filas = respaldo?.tablas?.[nombre];
    if (filas !== undefined && !Array.isArray(filas)) {
      throw new Error('El respaldo está incompleto y no se puede restaurar con seguridad.');
    }
    const ids = new Set();
    listas[nombre] = (filas || []).map(fila => {
      if (!fila || typeof fila !== 'object' || Array.isArray(fila) ||
          !['string', 'number'].includes(typeof fila.id) || fila.id === '' ||
          (typeof fila.id === 'number' && !Number.isFinite(fila.id)) || ids.has(fila.id)) {
        throw new Error('El respaldo contiene un registro incompleto o repetido y no se puede restaurar con seguridad.');
      }
      ids.add(fila.id);
      if (nombre !== 'attachments') return fila;
      const binario = binarios.get(fila.id);
      return binario?.base64 ? { ...fila, blob: base64ABlob(binario.base64, binario.mime) } : { ...fila };
    });
  }

  const conteos = {};
  let omitidos = 0;
  const tablasDexie = TABLAS.map(nombre => db[nombre]);
  if (typeof db.transaction !== 'function') {
    throw new Error('No se pudo iniciar una restauración segura en este dispositivo.');
  }
  await db.transaction('rw', ...tablasDexie, async () => {
    for (const nombre of TABLAS) {
      const filas = listas[nombre];
      if (!filas.length) continue;
      const existentes = new Set((await db[nombre].toArray()).map(fila => fila.id));
      const nuevas = filas.filter(fila => !existentes.has(fila.id));
      const omitidas = filas.length - nuevas.length;
      if (nuevas.length) {
        await db[nombre].bulkAdd(nuevas);
        conteos[nombre] = nuevas.length;
      }
      omitidos += omitidas;
    }
  });
  return { conteos, omitidos };
};

/** "24 pacientes, 31 consultas, 12 ventas": que hay dentro, en una linea. */
export const resumenRespaldo = (conteos = {}) => {
  const ETIQUETAS = {
    patients: 'pacientes', consultations: 'consultas', sales: 'ventas', saleItems: 'items de venta',
    payments: 'cobros', inventory: 'productos', prices: 'tarifas',
    inventoryMovements: 'movimientos', outbox: 'cambios en cola', attachments: 'adjuntos'
  };
  const partes = Object.entries(ETIQUETAS)
    .filter(([tabla]) => (conteos[tabla] || 0) > 0)
    .map(([tabla, nombre]) => `${conteos[tabla]} ${nombre}`);
  return partes.length ? partes.join(', ') : 'sin datos';
};

export const nombreArchivoRespaldo = (fecha = new Date()) => {
  const dos = n => String(n).padStart(2, '0');
  const sello = `${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}-${dos(fecha.getHours())}${dos(fecha.getMinutes())}`;
  return `verplus-respaldo-${sello}.json`;
};

// --- Espacio en disco ------------------------------------------------------
const MB = 1024 * 1024;

/**
 * El navegador borra los datos de un sitio cuando le falta espacio. En una
 * optica eso es perder las ventas de la semana sin aviso, asi que el margen se
 * calcula con holgura y se avisa ANTES de que sea tarde.
 */
export const nivelEspacio = (usado = 0, cuota = 0) => {
  if (!cuota) return 'desconocido';
  const libre = Math.max(0, cuota - usado);
  if (libre < 50 * MB) return 'critico';
  if (libre < 200 * MB) return 'poco';
  return 'ok';
};

/**
 * Cuanto pesara el respaldo, SIN generarlo.
 * Generar el archivo entero (convertir cada foto a base64) tarda y ocupa memoria,
 * asi que la interfaz lo pregunta antes de tiempo para poder avisar con numeros.
 *
 * Solo cuenta las filas y mide el tamano de los Blobs: no convierte nada a base64.
 */
export const estimarRespaldo = async (db) => {
  const conteos = {};
  for (const nombre of TABLAS) {
    conteos[nombre] = await db[nombre].count();
  }
  // El peso real de los archivos sale de la fila del adjunto, sin leer el Blob a
  // memoria: el navegador guarda tamano y tipo, que es justo lo que hace falta.
  let pesoAdjuntos = 0;
  for (const fila of await db.attachments.toArray()) {
    pesoAdjuntos += fila.blob?.size || fila.tamano || 0;
  }
  return estimarPesoRespaldo(conteos, pesoAdjuntos);
};

export const espacioEnDisco = async () => {
  const storage = globalThis.navigator?.storage;
  if (!storage?.estimate) return null;
  const estimacion = await storage.estimate();
  const usados = estimacion?.usage || 0;
  const total = estimacion?.quota || 0;
  const persistente = typeof storage.persisted === 'function' ? await storage.persisted() : null;
  return {
    usado: usados,
    cuota: total,
    libre: Math.max(0, total - usados),
    nivel: nivelEspacio(usados, total),
    persistente
  };
};

export const formatearMB = bytes => `${(Number(bytes || 0) / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;

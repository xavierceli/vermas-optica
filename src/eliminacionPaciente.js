// ---------------------------------------------------------------------------
// BORRADO DEFINITIVO DE UN PACIENTE
// ---------------------------------------------------------------------------
// Que hace: borra de raiz a UN paciente y todo lo que cuelga de el, en tres sitios:
//   1) El servidor (funcion eliminar_paciente_definitivo, migracion 018): consultas,
//      sus copias de version, ventas, cobros, reembolsos, movimientos de stock y la
//      ficha. Todo o nada, en una sola transaccion.
//   2) Los archivos de comprobantes de pago guardados en Supabase Storage.
//   3) Este dispositivo: la copia local de todo lo anterior.
// Los demas dispositivos limpian su copia local al sincronizar, leyendo la tabla
// registros_eliminados (solo codigos aleatorios, sin datos del paciente).
//
// Es IRREVERSIBLE. Por eso la pantalla pide escribir la cedula y ofrece descargar
// antes una copia del paciente.
// ---------------------------------------------------------------------------
import { localDb } from './localDb.js';
import { extraerRutaArchivo } from './rutaImagen.js';

// El cliente de Supabase se carga solo cuando hace falta. Asi este modulo se puede
// probar con node --test (supabaseClient usa import.meta.env, que solo existe en Vite).
let clienteDePrueba = null;
export const usarClienteDePrueba = cliente => { clienteDePrueba = cliente; };
const obtenerCliente = async () => clienteDePrueba || (await import('./supabaseClient.js')).supabase;

const BUCKET_COMPROBANTES = 'comprobantes_pagos';

const normalizar = valor => String(valor ?? '').replace(/[^0-9A-Za-z]/g, '').toLowerCase();

export const traducirErrorEliminacion = error => {
  const mensaje = String(error?.message || error || '');
  const codigo = String(error?.code || '');
  if (codigo === 'PGRST202' || /does not exist|could not find the function/i.test(mensaje)) {
    return 'El servidor todavía no tiene la función de borrado (falta aplicar la migración 018).';
  }
  if (codigo === '42501' || /permission denied|autenticaci/i.test(mensaje)) {
    return 'No hay permiso o la sesión expiró. Inicia sesión de nuevo e inténtalo otra vez.';
  }
  if (/failed to fetch|network|load failed/i.test(mensaje)) {
    return 'No se pudo conectar con el servidor. Si el problema persiste, vuelve a intentarlo: repetir el borrado es seguro.';
  }
  return mensaje || 'Error desconocido.';
};

// --- Conteo previo (para mostrar al usuario que se va a borrar) -------------

export const contarRegistrosPaciente = async cedula => {
  const limpia = String(cedula ?? '').trim();
  if (!limpia) throw new Error('La cédula es obligatoria.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Sin conexión a internet. El borrado definitivo solo se puede hacer con conexión.');
  }
  const supabase = await obtenerCliente();
  const { data, error } = await supabase.rpc('contar_registros_paciente', { p_cedula: limpia });
  if (error) throw new Error(traducirErrorEliminacion(error));
  return data || { encontrado: false };
};

// --- Copia previa del paciente (solo lo que hay en este dispositivo) ---------

/**
 * Los comprobantes van DENTRO del .json de la copia, en base64.
 *
 * Por que: al borrar un paciente se borran tambien sus comprobantes (es lo
 * correcto para la privacidad), asi que despues no hay forma de recuperarlos.
 * Copiarlos ANTES es la unica ventana para tener la evidencia de los pagos.
 *
 * Van en el mismo archivo y no en una carpeta aparte a proposito: una carpeta
 * con varios archivos se descarga mal en celular (a veces baja solo el primero,
 * en silencio), y una copia incompleta de un borrado irreversible es peor que
 * no tener copia. Un solo .json baja entero o no baja.
 *
 * Nota: los comprobantes que ya se subieron al servidor y no quedaron en este
 * equipo NO se pueden copiar (no hay red en este punto). Por eso la pantalla
 * avisa de cuantos se incluyen.
 */
const adjuntosDelPaciente = async (cedulaNorm, ventaIds, consultaIds) => {
  const cobros = await localDb.payments.filter(p => ventaIds.has(String(p.saleId))).toArray();
  const cobroIds = new Set(cobros.map(p => String(p.id)));
  return localDb.attachments.filter(a => (
    ventaIds.has(String(a.refId)) || cobroIds.has(String(a.refId)) || consultaIds.has(String(a.refId))
  )).toArray();
};

/** Convierte un Blob en base64 para poder meterlo dentro del .json. */
const blobABase64Local = async blob => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = '';
  const TROZO = 0x8000;
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + TROZO));
  }
  return btoa(binario);
};

/** Prepara los comprobantes para el .json. Los que no tengan blob se omiten. */
const prepararComprobantes = async adjuntos => {
  const comprobantes = [];
  for (const adjunto of adjuntos) {
    // Sin blob no hay nada que copiar (p.ej. solo quedo la ruta en el servidor).
    if (!adjunto.blob) continue;
    comprobantes.push({
      refId: String(adjunto.refId ?? ''),
      refType: adjunto.refType || '',
      nombre: adjunto.nombre || adjunto.ruta || 'comprobante.jpg',
      mime: adjunto.mime || 'image/jpeg',
      base64: await blobABase64Local(adjunto.blob)
    });
  }
  return comprobantes;
};

export const armarCopiaPaciente = async cedula => {
  const cedulaNorm = normalizar(cedula);
  const pacientes = new Set();
  const fichas = await localDb.patients.filter(p => cedulaNorm && normalizar(p.cedula) === cedulaNorm).toArray();
  fichas.forEach(p => pacientes.add(String(p.id)));
  const consultas = await localDb.consultations
    .filter(c => pacientes.has(String(c.patientId)) || (cedulaNorm && normalizar(c.cedula) === cedulaNorm)).toArray();
  const consultaIds = new Set(consultas.map(c => String(c.id)));
  const ventas = await localDb.sales
    .filter(v => pacientes.has(String(v.patientId)) || consultaIds.has(String(v.consultationId))
      || (cedulaNorm && normalizar(v.cedula) === cedulaNorm)).toArray();
  const ventaIds = new Set(ventas.map(v => String(v.id)));
  const items = await localDb.saleItems.filter(i => ventaIds.has(String(i.saleId))).toArray();
  const cobros = await localDb.payments.filter(p => ventaIds.has(String(p.saleId))).toArray();
  const movimientos = await localDb.inventoryMovements.filter(m => ventaIds.has(String(m.saleId))).toArray();

  // Los comprobantes se buscan con la misma logica que usa el borrado, para que
  // la copia incluya exactamente los archivos que despues se van a borrar.
  const adjuntos = await adjuntosDelPaciente(cedulaNorm, ventaIds, consultaIds);
  const comprobantes = await prepararComprobantes(adjuntos);

  return {
    formato: 'verplus-copia-paciente',
    version: 2,
    generadoEn: new Date().toISOString(),
    aviso: 'Contiene datos personales y clínicos, incluidos los comprobantes de pago. '
      + 'Guárdalo en un lugar privado. Los comprobantes van en base64 dentro de este mismo archivo.',
    pacientes: fichas,
    consultas,
    ventas,
    items,
    cobros,
    movimientos,
    comprobantes
  };
};

/**
 * Cuantos comprobantes incluira la copia, para poder avisar ANTES de borrar.
 * Es la misma busqueda que hace armarCopiaPaciente, pero sin convertir a base64:
 * contar es barato y no retiene los archivos en memoria.
 */
export const contarComprobantesCopia = async cedula => {
  const cedulaNorm = normalizar(cedula);
  const fichas = await localDb.patients.filter(p => cedulaNorm && normalizar(p.cedula) === cedulaNorm).toArray();
  const pacientes = new Set(fichas.map(p => String(p.id)));
  const consultas = await localDb.consultations
    .filter(c => pacientes.has(String(c.patientId)) || (cedulaNorm && normalizar(c.cedula) === cedulaNorm)).toArray();
  const consultaIds = new Set(consultas.map(c => String(c.id)));
  const ventas = await localDb.sales
    .filter(v => pacientes.has(String(v.patientId)) || consultaIds.has(String(v.consultationId))
      || (cedulaNorm && normalizar(v.cedula) === cedulaNorm)).toArray();
  const ventaIds = new Set(ventas.map(v => String(v.id)));
  const adjuntos = await adjuntosDelPaciente(cedulaNorm, ventaIds, consultaIds);
  return adjuntos.filter(a => a.blob).length;
};

export const descargarCopiaPaciente = async cedula => {
  const copia = await armarCopiaPaciente(cedula);
  if (typeof document === 'undefined') return copia;
  const blob = new Blob([JSON.stringify(copia, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `copia-paciente-${normalizar(cedula) || 'sin-cedula'}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return copia;
};

// --- Limpieza local ----------------------------------------------------------

/** ¿Alguna operacion pendiente menciona esta cedula en cualquier parte de su contenido? */
const mencionaCedula = (contenido, cedulaNorm) => {
  if (!cedulaNorm || contenido === null || contenido === undefined) return false;
  if (typeof contenido === 'string' || typeof contenido === 'number') {
    return normalizar(contenido) === cedulaNorm;
  }
  if (Array.isArray(contenido)) return contenido.some(valor => mencionaCedula(valor, cedulaNorm));
  if (typeof contenido === 'object') {
    return Object.entries(contenido).some(([clave, valor]) => (
      (clave === 'cedula' && normalizar(valor) === cedulaNorm) || mencionaCedula(valor, cedulaNorm)
    ));
  }
  return false;
};

/**
 * Borra de ESTE dispositivo todo lo ligado a un paciente: ficha, consultas, ventas,
 * productos de venta, cobros, movimientos, adjuntos, operaciones pendientes de subir
 * (para que no resuciten datos al sincronizar) y la cache de historial.
 * Se busca por los codigos que informa el servidor y, ademas, por cedula y por los
 * identificadores locales, porque el id local de un paciente puede diferir del servidor.
 */
export const purgarPacienteLocal = async ({ pacienteIds = [], consultaIds = [], pedidoIds = [], cedula = '' } = {}) => {
  const cedulaNorm = normalizar(cedula);
  const tablas = [
    localDb.patients, localDb.consultations, localDb.sales, localDb.saleItems, localDb.payments,
    localDb.inventoryMovements, localDb.outbox, localDb.attachments, localDb.cache
  ];
  return localDb.transaction('rw', tablas, async () => {
    const pacientes = new Set(pacienteIds.map(String));
    const consultas = new Set(consultaIds.map(String));
    const ventas = new Set(pedidoIds.map(String));

    const fichas = await localDb.patients
      .filter(p => pacientes.has(String(p.id)) || (cedulaNorm && normalizar(p.cedula) === cedulaNorm)).toArray();
    fichas.forEach(p => pacientes.add(String(p.id)));

    const consultasLocales = await localDb.consultations
      .filter(c => consultas.has(String(c.id)) || pacientes.has(String(c.patientId))
        || (cedulaNorm && normalizar(c.cedula) === cedulaNorm)).toArray();
    consultasLocales.forEach(c => consultas.add(String(c.id)));

    const ventasLocales = await localDb.sales
      .filter(v => ventas.has(String(v.id)) || pacientes.has(String(v.patientId))
        || consultas.has(String(v.consultationId)) || (cedulaNorm && normalizar(v.cedula) === cedulaNorm)).toArray();
    ventasLocales.forEach(v => ventas.add(String(v.id)));

    const items = await localDb.saleItems.filter(i => ventas.has(String(i.saleId))).toArray();
    const cobros = await localDb.payments.filter(p => ventas.has(String(p.saleId))).toArray();
    const cobroIds = new Set(cobros.map(p => String(p.id)));
    const movimientos = await localDb.inventoryMovements.filter(m => ventas.has(String(m.saleId))).toArray();
    const adjuntos = await localDb.attachments
      .filter(a => ventas.has(String(a.refId)) || cobroIds.has(String(a.refId)) || consultas.has(String(a.refId))).toArray();

    const codigos = [...pacientes, ...consultas, ...ventas, ...cobroIds].filter(Boolean);
    // Tambien por cedula: una operacion atascada de un borrado anterior puede nombrar
    // al paciente solo por su cedula, y al sincronizar lo volveria a crear en el servidor.
    const operaciones = (codigos.length === 0 && !cedulaNorm) ? [] : await localDb.outbox.filter(op => {
      if (codigos.includes(String(op.entityId))) return true;
      const texto = JSON.stringify(op.payload ?? {});
      if (codigos.some(codigo => texto.includes(codigo))) return true;
      return mencionaCedula(op.payload, cedulaNorm);
    }).toArray();

    const enCache = await localDb.cache.filter(fila => {
      const consultaDeFila = String(fila.id ?? '').replace(/^remote:/, '');
      return consultas.has(consultaDeFila) || pacientes.has(String(fila.paciente_id))
        || ventas.has(String(fila.pedido_id)) || (cedulaNorm && normalizar(fila.cedula) === cedulaNorm);
    }).toArray();

    await localDb.patients.bulkDelete(fichas.map(p => p.id));
    await localDb.consultations.bulkDelete(consultasLocales.map(c => c.id));
    await localDb.sales.bulkDelete(ventasLocales.map(v => v.id));
    await localDb.saleItems.bulkDelete(items.map(i => i.id));
    await localDb.payments.bulkDelete(cobros.map(p => p.id));
    await localDb.inventoryMovements.bulkDelete(movimientos.map(m => m.id));
    await localDb.attachments.bulkDelete(adjuntos.map(a => a.id));
    await localDb.outbox.bulkDelete(operaciones.map(op => op.id));
    await localDb.cache.bulkDelete(enCache.map(fila => fila.id));

    return {
      pacientes: fichas.length, consultas: consultasLocales.length, ventas: ventasLocales.length,
      items: items.length, cobros: cobros.length, movimientos: movimientos.length,
      adjuntos: adjuntos.length, operaciones: operaciones.length, cache: enCache.length
    };
  });
};

// --- Borrado definitivo ------------------------------------------------------

export const eliminarPacienteDefinitivo = async (cedula, { descargarCopia = false } = {}) => {
  const limpia = String(cedula ?? '').trim();
  if (!limpia) throw new Error('La cédula es obligatoria.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Sin conexión a internet. No se borró nada. El borrado definitivo solo se puede hacer con conexión.');
  }

  // La copia va ANTES: si falla, no se borra nada.
  if (descargarCopia) await descargarCopiaPaciente(limpia);

  const supabase = await obtenerCliente();
  const { data, error } = await supabase.rpc('eliminar_paciente_definitivo', { p_cedula: limpia });
  if (error) throw new Error(traducirErrorEliminacion(error));
  const resultado = data || {};

  // Primero se limpia ESTE equipo (incluidas las operaciones pendientes): si una sincronizacion
  // automatica corriera ahora, no debe volver a subir datos del paciente recien borrado.
  const local = await purgarPacienteLocal({
    pacienteIds: resultado.paciente_ids || [],
    consultaIds: resultado.consulta_ids || [],
    pedidoIds: resultado.pedido_ids || [],
    cedula: limpia
  });

  // Archivos de comprobantes. El servidor ya borro los datos; si esto falla no se
  // deshace nada, se avisa para que no queden archivos sueltos sin que se sepa.
  const rutas = [...new Set((resultado.archivos || [])
    .map(valor => extraerRutaArchivo(valor, BUCKET_COMPROBANTES)).filter(Boolean))];
  let archivosPendientes = [];
  if (rutas.length > 0) {
    try {
      const { data: borrados, error: errorArchivos } = await supabase.storage.from(BUCKET_COMPROBANTES).remove(rutas);
      if (errorArchivos) {
        archivosPendientes = rutas;
      } else if (Array.isArray(borrados)) {
        // Storage no da error cuando un permiso impide borrar: solo devuelve menos archivos.
        const hechos = new Set(borrados.map(archivo => archivo?.name));
        archivosPendientes = rutas.filter(ruta => !hechos.has(ruta));
      }
    } catch {
      archivosPendientes = rutas;
    }
  }

  return {
    encontrado: resultado.encontrado !== false,
    consultas: Number(resultado.consultas) || 0,
    ventas: Number(resultado.ventas) || 0,
    cobros: Number(resultado.cobros) || 0,
    archivosBorrados: rutas.length - archivosPendientes.length,
    archivosPendientes,
    local
  };
};

// --- Borrados hechos desde otros dispositivos --------------------------------

const PAGINA_BITACORA = 1000;
const MAX_PAGINAS_BITACORA = 10;

/**
 * Lee TODA la bitacora de borrados definitivos y limpia de este equipo lo que se borro
 * desde cualquier dispositivo. Se lee completa en cada sincronizacion (es una tabla
 * pequena) para que una copia restaurada o datos que reaparezcan se limpien de nuevo.
 * Debe llamarse ANTES de subir operaciones pendientes. Es seguro repetirla. Si falla
 * (sin conexion, sin la migracion 018), no interrumpe la sincronizacion.
 */
export const aplicarEliminacionesRemotas = async () => {
  try {
    const supabase = await obtenerCliente();
    const filas = [];
    for (let pagina = 0; pagina < MAX_PAGINAS_BITACORA; pagina += 1) {
      const desde = pagina * PAGINA_BITACORA;
      const { data, error } = await supabase
        .from('registros_eliminados')
        .select('paciente_ids, consulta_ids, pedido_ids')
        .order('eliminado_en', { ascending: true })
        .range(desde, desde + PAGINA_BITACORA - 1);
      if (error) throw error;
      filas.push(...(data || []));
      if (!data || data.length < PAGINA_BITACORA) break;
    }
    if (filas.length === 0) return 0;

    await purgarPacienteLocal({
      pacienteIds: filas.flatMap(fila => fila.paciente_ids || []),
      consultaIds: filas.flatMap(fila => fila.consulta_ids || []),
      pedidoIds: filas.flatMap(fila => fila.pedido_ids || [])
    });
    return filas.length;
  } catch (error) {
    console.warn('No se pudieron aplicar los borrados de otros dispositivos:', error?.message || error);
    return 0;
  }
};

// --- Reconciliacion con el servidor -------------------------------------------

/**
 * El servidor es la verdad para lo que ya esta sincronizado. Despues de una descarga
 * COMPLETA del historial, se borra de este equipo toda consulta, venta, cobro, movimiento,
 * dato de cache y ficha marcados como 'synced' que el servidor ya no tiene. Asi, aunque algo
 * se haya borrado desde otro equipo, por una funcion antigua o por una copia restaurada,
 * deja de aparecer. Nunca toca lo pendiente de subir (syncStatus distinto de 'synced').
 *
 * filas: el historial completo descargado (vista_pacientes).
 * permitirVacio: solo si hay otra senal de que la sesion funciona; una lista vacia se trata
 * como error de lectura y no se borra nada.
 */
export const reconciliarConServidor = async (filas, { permitirVacio = false } = {}) => {
  if (!Array.isArray(filas)) return null;
  if (filas.length === 0 && !permitirVacio) return null;

  const idsConsulta = new Set();
  const idsPedido = new Set();
  const idsPaciente = new Set();
  for (const fila of filas) {
    if (fila?.id !== undefined && fila?.id !== null) idsConsulta.add(String(fila.id));
    if (fila?.pedido_id) idsPedido.add(String(fila.pedido_id));
    const paciente = fila?.paciente_id || fila?.patient_id;
    if (paciente) idsPaciente.add(String(paciente));
  }

  const tablas = [
    localDb.patients, localDb.consultations, localDb.sales, localDb.saleItems,
    localDb.payments, localDb.inventoryMovements, localDb.cache
  ];
  return localDb.transaction('rw', tablas, async () => {
    const consultasFantasma = await localDb.consultations
      .filter(c => c.syncStatus === 'synced' && !idsConsulta.has(String(c.id))).toArray();
    const ventasFantasma = await localDb.sales
      .filter(v => v.syncStatus === 'synced' && !idsPedido.has(String(v.id))).toArray();
    const ventaIds = new Set(ventasFantasma.map(v => String(v.id)));

    const items = await localDb.saleItems.filter(i => ventaIds.has(String(i.saleId))).toArray();
    const cobros = await localDb.payments
      .filter(p => ventaIds.has(String(p.saleId)) && p.syncStatus !== 'pending').toArray();
    const movimientos = await localDb.inventoryMovements
      .filter(m => ventaIds.has(String(m.saleId)) && m.syncStatus !== 'pending').toArray();
    const enCache = await localDb.cache.filter(fila => (
      fila.kind === 'historial' && String(fila.id ?? '').startsWith('remote:')
      && !idsConsulta.has(String(fila.id).replace(/^remote:/, ''))
    )).toArray();

    await localDb.consultations.bulkDelete(consultasFantasma.map(c => c.id));
    await localDb.sales.bulkDelete(ventasFantasma.map(v => v.id));
    await localDb.saleItems.bulkDelete(items.map(i => i.id));
    await localDb.payments.bulkDelete(cobros.map(p => p.id));
    await localDb.inventoryMovements.bulkDelete(movimientos.map(m => m.id));
    await localDb.cache.bulkDelete(enCache.map(fila => fila.id));

    // Una ficha sincronizada que el servidor ya no tiene y que ninguna consulta ni venta local usa.
    const consultasQuedan = await localDb.consultations.toArray();
    const ventasQuedan = await localDb.sales.toArray();
    const enUso = new Set([...consultasQuedan.map(c => String(c.patientId)), ...ventasQuedan.map(v => String(v.patientId))]);
    const fichasFantasma = await localDb.patients
      .filter(p => p.syncStatus === 'synced' && !idsPaciente.has(String(p.id)) && !enUso.has(String(p.id))).toArray();
    await localDb.patients.bulkDelete(fichasFantasma.map(p => p.id));

    return {
      consultas: consultasFantasma.length, ventas: ventasFantasma.length, items: items.length,
      cobros: cobros.length, movimientos: movimientos.length, cache: enCache.length,
      fichas: fichasFantasma.length
    };
  });
};
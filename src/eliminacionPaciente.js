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
import { localDb, getMeta, setMeta } from './localDb.js';
import { extraerRutaArchivo } from './rutaImagen.js';

// El cliente de Supabase se carga solo cuando hace falta. Asi este modulo se puede
// probar con node --test (supabaseClient usa import.meta.env, que solo existe en Vite).
let clienteDePrueba = null;
export const usarClienteDePrueba = cliente => { clienteDePrueba = cliente; };
const obtenerCliente = async () => clienteDePrueba || (await import('./supabaseClient.js')).supabase;

const BUCKET_COMPROBANTES = 'comprobantes_pagos';
const META_ELIMINACIONES = 'eliminaciones_aplicadas_hasta';

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
  return {
    formato: 'verplus-copia-paciente',
    version: 1,
    generadoEn: new Date().toISOString(),
    aviso: 'Contiene datos personales y clínicos. Guárdalo en un lugar privado.',
    pacientes: fichas, consultas, ventas, items, cobros, movimientos
  };
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

/**
 * Lee la bitacora de borrados definitivos y limpia la copia local de lo que se borro
 * desde otro dispositivo. Es seguro repetirla. Si falla (por ejemplo, sin conexion o
 * sin la migracion 018), no interrumpe la sincronizacion.
 */
export const aplicarEliminacionesRemotas = async () => {
  try {
    const supabase = await obtenerCliente();
    const desde = await getMeta(META_ELIMINACIONES, null);
    let consulta = supabase
      .from('registros_eliminados')
      .select('paciente_ids, consulta_ids, pedido_ids, eliminado_en')
      .order('eliminado_en', { ascending: true })
      .limit(500);
    if (desde) consulta = consulta.gte('eliminado_en', desde);
    const { data, error } = await consulta;
    if (error) throw error;

    let aplicadas = 0;
    let ultima = desde;
    for (const fila of data || []) {
      await purgarPacienteLocal({
        pacienteIds: fila.paciente_ids || [],
        consultaIds: fila.consulta_ids || [],
        pedidoIds: fila.pedido_ids || []
      });
      aplicadas += 1;
      if (!ultima || fila.eliminado_en > ultima) ultima = fila.eliminado_en;
    }
    if (ultima && ultima !== desde) await setMeta(META_ELIMINACIONES, ultima);
    return aplicadas;
  } catch (error) {
    console.warn('No se pudieron aplicar los borrados de otros dispositivos:', error?.message || error);
    return 0;
  }
};
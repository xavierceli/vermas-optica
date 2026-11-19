// ---------------------------------------------------------------------------
// REGISTRO LOCAL DE CONFLICTOS
// ---------------------------------------------------------------------------
// Guarda cada conflicto que detecta el motor de sincronizacion con tres datos
// que antes se perdian: su categoria (version clinica, stock, etc.), el equipo
// que lo sufrio y el usuario que tenia la sesion.
//
// El registro vive en `meta` (no en una tabla nueva) para no migrar IndexedDB:
// son pocos eventos, se limitan a los ultimos 200 y se conservan 90 dias.
// El panel los resume; no se envia nada al servidor.
// ---------------------------------------------------------------------------
import { createUuid, getMeta, localDb, nowIso, setMeta } from './localDb.js';
import {
  categoriaDeConflicto, etiquetaDeNavegador, resumirConflictos
} from './conflictos.js';

const CLAVE_EVENTOS = 'conflictosRegistrados';
const CLAVE_EQUIPO = 'equipoId';
const CLAVE_ETIQUETA = 'equipoEtiqueta';
const CLAVE_USUARIO = 'usuarioEmail';
const MAX_EVENTOS = 200;
const RETENCION_MS = 90 * 24 * 60 * 60 * 1000;

const userAgentActual = () =>
  (typeof navigator === 'undefined' ? '' : navigator.userAgent || '');

const asegurarEquipo = async () => {
  let equipoId = await getMeta(CLAVE_EQUIPO, null);
  if (!equipoId) {
    equipoId = createUuid();
    await setMeta(CLAVE_EQUIPO, equipoId);
  }

  let etiqueta = await getMeta(CLAVE_ETIQUETA, null);
  if (!etiqueta) {
    etiqueta = etiquetaDeNavegador(userAgentActual());
    await setMeta(CLAVE_ETIQUETA, etiqueta);
  }

  return { equipoId, etiqueta };
};

/** Identidad estable de este equipo, para etiquetar los eventos. */
export const obtenerIdentidadEquipo = async () => {
  const { equipoId, etiqueta } = await asegurarEquipo();
  return {
    id: equipoId,
    etiqueta,
    usuario: await getMeta(CLAVE_USUARIO, null)
  };
};

const leerEventos = async () => {
  const guardados = await getMeta(CLAVE_EVENTOS, []);
  if (!Array.isArray(guardados)) return [];
  const limite = Date.now() - RETENCION_MS;
  return guardados.filter(fila => {
    if (!fila || typeof fila !== 'object') return false;
    const fecha = Date.parse(fila.creadoEn);
    return !Number.isFinite(fecha) || fecha >= limite;
  });
};

/**
 * Anota un conflicto. Nunca lanza: si el registro falla, la sincronizacion
 * sigue igual y el conflicto ya esta en el outbox.
 *
 * @param {object} opciones
 * @param {object} opciones.operation Operacion del outbox que choco.
 * @param {string} opciones.motivo Texto devuelto por el servidor.
 * @param {string} [opciones.usuario] Correo de la sesion, si se conoce.
 * @returns {Promise<object|null>} El evento guardado o null si no se pudo.
 */
export const registrarConflicto = async ({ operation, motivo, usuario } = {}) => {
  try {
    const identidad = await obtenerIdentidadEquipo();
    const evento = {
      id: createUuid(),
      operacionId: operation?.id || null,
      creadoEn: nowIso(),
      categoria: categoriaDeConflicto(motivo, operation?.type),
      tipoOperacion: operation?.type || '',
      entidad: operation?.entityId ?? null,
      motivo: String(motivo || '').slice(0, 500),
      equipoId: identidad.id,
      equipo: identidad.etiqueta,
      usuario: usuario || identidad.usuario || null
    };

    const anteriores = await leerEventos();

    await setMeta(CLAVE_EVENTOS, [...anteriores, evento].slice(-MAX_EVENTOS));
    return evento;
  } catch (error) {
    console.warn('[conflictos] no se pudo registrar el conflicto:', error?.message || error);
    return null;
  }
};

/**
 * Resumen para el panel: historico registrado + conflictos que siguen activos
 * en la cola (aunque se detectaran antes de existir este registro).
 */
export const obtenerResumenConflictos = async () => {
  try {
    const [eventos, identidad] = await Promise.all([
      leerEventos(),
      obtenerIdentidadEquipo()
    ]);

    let activos = [];
    try {
      activos = await localDb.outbox.where('status').equals('conflict').toArray();
    } catch {
      activos = [];
    }

    const yaRegistrados = new Set(eventos.map(evento => evento?.operacionId).filter(Boolean));
    const sinEvento = activos
      .filter(operacion => !yaRegistrados.has(operacion.id))
      .map(operacion => ({
        operacionId: operacion.id,
        creadoEn: operacion.updatedAt || operacion.createdAt || nowIso(),
        categoria: categoriaDeConflicto(operacion.lastError, operacion.type),
        tipoOperacion: operacion.type,
        entidad: operacion.entityId ?? null,
        motivo: operacion.lastError || 'Conflicto de datos',
        equipoId: identidad.id,
        equipo: identidad.etiqueta,
        usuario: identidad.usuario
      }));

    return {
      ...resumirConflictos([...eventos, ...sinEvento]),
      activos: activos.length,
      equipo: identidad
    };
  } catch (error) {
    console.warn('[conflictos] no se pudo leer el resumen:', error?.message || error);
    return {
      ...resumirConflictos([]),
      activos: 0,
      equipo: null
    };
  }
};

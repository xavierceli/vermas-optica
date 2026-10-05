// ---------------------------------------------------------------------------
// REPOSITORIO LOCAL: FACHADA PUBLICA
// ---------------------------------------------------------------------------
// Este archivo ya NO contiene la logica. Solo ofrece dos cosas:
//
//  1. La COLA DE ESCRITURA: toda operacion pasa por `enColaEscritura`, que las
//     serializa una a una. Sin ella, dos escrituras simultaneas sobre el mismo
//     producto de inventario podrian leer el mismo stock viejo y escribir dos
//     veces, descuandolo de mas. Es la garantia de integridad mas importante del
//     lado del dispositivo.
//
//  2. La API PUBLICA: los mismos nombres de siempre, cada uno envolviendo su
//     implementacion en la cola. El resto de la app sigue importando desde aqui
//     y no se entero del reparto en modulos.
//
// El codigo se movio a src/repositorio/ sin cambiar una linea de logica:
//   base.js      utilidades compartidas
//   ventas.js    ventas, cobros, reembolsos y ajustes de stock
//   consultas.js consultas clinicas y archivado
//   catalogos.js inventario y tarifario
//   lectura.js   snapshot local, cache del servidor y migracion
//   adjuntos.js  comprobantes y fotos
//   marcado.js   pasar operaciones locales a 'synced'
// ---------------------------------------------------------------------------
import {
  guardarVentaLocalImpl, registrarPagoLocalImpl, registrarReembolsoLocalImpl,
  anularVentaConReembolsoImpl, cambiarEstadoVentaLocalImpl, anularVentaLocalImpl,
  obtenerContadorEscaneosInventario
} from './repositorio/ventas.js';
import {
  guardarConsultaLocalImpl, archivarConsultaLocalImpl, archivarConsultaIndividualLocalImpl
} from './repositorio/consultas.js';
import {
  guardarInventarioLocalImpl, eliminarInventarioLocalImpl,
  guardarPrecioLocalImpl, eliminarPrecioLocalImpl
} from './repositorio/catalogos.js';
import {
  cacheServerHistorialImpl, cacheServerCatalogImpl, importLegacyCacheImpl, obtenerSnapshotLocal
} from './repositorio/lectura.js';
import {
  guardarAdjuntoLocalImpl, leerAdjuntoLocalImpl,
  obtenerAdjuntosDeRefImpl, contarAdjuntosPendientesImpl
} from './repositorio/adjuntos.js';
import { markLocalOperationSyncedImpl } from './repositorio/marcado.js';
import { normalizeCedula } from './repositorio/base.js';

// ---------------------------------------------------------------------------
// COLA DE ESCRITURA LOCAL CON PRIORIDAD
// ---------------------------------------------------------------------------
const colaEscrituras = [];
let procesandoCola = false;
let tokenCola = 0;
const LIBERAR_HUECO_MS = 15000;

const drenarCola = () => {
  if (procesandoCola || colaEscrituras.length === 0) return;
  let indice = 0;
  for (let i = 1; i < colaEscrituras.length; i += 1) {
    if (colaEscrituras[i].prioridad > colaEscrituras[indice].prioridad) indice = i;
  }
  const [elemento] = colaEscrituras.splice(indice, 1);
  procesandoCola = true;
  const nombre = elemento.nombre || 'tarea';
  const inicio = Date.now();
  const token = ++tokenCola;
  let liberado = false;

  const liberar = () => {
    if (liberado) return;
    liberado = true;
    clearTimeout(vigilante);
    if (token !== tokenCola) return;
    procesandoCola = false;
    drenarCola();
  };

  const vigilante = setTimeout(() => {
    console.error(`[cola] "${nombre}" no ha terminado en ${LIBERAR_HUECO_MS / 1000}s. Se libera el hueco.`);
    liberar();
  }, LIBERAR_HUECO_MS);

  Promise.resolve()
    .then(() => {
      console.debug(`[cola] inicia ${nombre} (en espera: ${colaEscrituras.length})`);
      return elemento.tarea();
    })
    .then(resultado => {
      console.debug(`[cola] ok ${nombre} en ${Date.now() - inicio} ms`);
      elemento.resolver(resultado);
    }, error => {
      console.error(`[cola] fallo ${nombre} tras ${Date.now() - inicio} ms:`, error);
      elemento.rechazar(error);
    })
    .finally(() => liberar());
};

export const enColaEscritura = (tarea, prioridad = 'alta', nombre = 'tarea') => new Promise((resolver, rechazar) => {
  colaEscrituras.push({ tarea, prioridad: prioridad === 'alta' ? 1 : 0, resolver, rechazar, nombre });
  drenarCola();
});

// ---------------------------------------------------------------------------
// API PUBLICA (cada operacion pasa por la cola)
// ---------------------------------------------------------------------------
export { normalizeCedula, obtenerContadorEscaneosInventario, obtenerSnapshotLocal };

export const guardarVentaLocal = args => enColaEscritura(() => guardarVentaLocalImpl(args), 'alta', 'guardarVentaLocal');
export const cacheServerHistorial = rows => enColaEscritura(() => cacheServerHistorialImpl(rows), 'bajo', 'cacheServerHistorial');
export const cacheServerCatalog = datos => enColaEscritura(() => cacheServerCatalogImpl(datos), 'bajo', 'cacheServerCatalog');
export const importLegacyCache = () => enColaEscritura(() => importLegacyCacheImpl(), 'bajo', 'importLegacyCache');
export const guardarConsultaLocal = args => enColaEscritura(() => guardarConsultaLocalImpl(args), 'alta', 'guardarConsultaLocal');
export const registrarPagoLocal = args => enColaEscritura(() => registrarPagoLocalImpl(args), 'alta', 'registrarPagoLocal');
export const registrarReembolsoLocal = args => enColaEscritura(() => registrarReembolsoLocalImpl(args), 'alta', 'registrarReembolso');
export const anularVentaConReembolso = args => enColaEscritura(() => anularVentaConReembolsoImpl(args), 'alta', 'anularVentaConReembolso');
export const cambiarEstadoVentaLocal = args => enColaEscritura(() => cambiarEstadoVentaLocalImpl(args), 'alta', 'cambiarEstadoVentaLocal');
export const anularVentaLocal = id => enColaEscritura(() => anularVentaLocalImpl(id), 'alta', 'anularVentaLocal');
export const guardarInventarioLocal = args => enColaEscritura(() => guardarInventarioLocalImpl(args), 'alta', 'guardarInventarioLocal');
export const eliminarInventarioLocal = id => enColaEscritura(() => eliminarInventarioLocalImpl(id), 'alta', 'eliminarInventarioLocal');
export const guardarPrecioLocal = args => enColaEscritura(() => guardarPrecioLocalImpl(args), 'alta', 'guardarPrecioLocal');
export const eliminarPrecioLocal = id => enColaEscritura(() => eliminarPrecioLocalImpl(id), 'alta', 'eliminarPrecioLocal');
export const archivarConsultaLocal = id => enColaEscritura(() => archivarConsultaLocalImpl(id), 'alta', 'archivarConsultaLocal');
export const archivarConsultaIndividualLocal = id => enColaEscritura(() => archivarConsultaIndividualLocalImpl(id), 'alta', 'archivarConsultaIndividualLocal');
export const markLocalOperationSynced = op => enColaEscritura(() => markLocalOperationSyncedImpl(op), 'alta', 'markSync');
export const guardarAdjuntoLocal = args => enColaEscritura(() => guardarAdjuntoLocalImpl(args), 'alta', 'guardarAdjunto');
export const leerAdjuntoLocal = id => enColaEscritura(() => leerAdjuntoLocalImpl(id), 'alta', 'leerAdjunto');
export const obtenerAdjuntosDeRef = id => enColaEscritura(() => obtenerAdjuntosDeRefImpl(id), 'alta', 'leerAdjuntos');
export const contarAdjuntosPendientes = () => enColaEscritura(() => contarAdjuntosPendientesImpl(), 'bajo', 'contarAdjuntos');

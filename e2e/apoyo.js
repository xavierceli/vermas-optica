// ---------------------------------------------------------------------------
// APOYO DE LAS PRUEBAS E2E DE DOS EQUIPOS
// ---------------------------------------------------------------------------
// Un "equipo" es un contexto de navegador aislado: su propio localStorage,
// IndexedDB y service worker. Los dos contextos apuntan al MISMO servidor falso
// (el objeto que devuelve crearServidorFalso), que vive en el proceso de Node.
//
// Para no depender de la pantalla de login en cada prueba, se inyecta una
// sesion valida en el formato que guarda supabase-js. Todo lo demas es la app
// de verdad: su Dexie, su motor de sync, su cola de escrituras.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearSesion } from '../src/pruebas/servidorFalso.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FUENTE_CLIENTE = readFileSync(join(RAIZ, 'src', 'supabaseClient.js'), 'utf8');
const REFERENCIA = (FUENTE_CLIENTE.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || 'local';

export const CLAVE_SESION = `sb-${REFERENCIA}-auth-token`;

// Identificadores fijos de la semilla del servidor falso.
export const PACIENTE = '11111111-1111-4111-8111-111111111111';
export const CEDULA = '1712345678';
export const CONSULTA = '22222222-2222-4222-8222-222222222222';

const DATOS_PACIENTE = { id: PACIENTE, cedula: CEDULA, nombre: 'Paciente Demo' };

export const pacienteDemo = () => ({ ...DATOS_PACIENTE });

/**
 * Abre un equipo (contexto aislado) con sesion iniciada y los datos ya bajados.
 */
export const abrirEquipo = async (browser, servidor, { email = 'admin@vermas.test' } = {}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.addInitScript(
    ([clave, sesion]) => {
      window.localStorage.setItem(clave, JSON.stringify(sesion));
    },
    [CLAVE_SESION, crearSesion(email)]
  );

  // Todas las llamadas a Supabase las contesta el servidor falso compartido.
  await page.route(/supabase\.co\//, ruta => servidor.manejarRuta(ruta));

  // Realtime no aporta nada a estas pruebas y, sin servidor, dejaria el canal
  // reintentando en segundo plano. Se cierra en cuanto se abre.
  if (typeof context.routeWebSocket === 'function') {
    await context.routeWebSocket(/supabase\.co/, socket => {
      try { socket.close(); } catch { /* ya estaba cerrado */ }
    });
  }

  await page.goto('/');
  await page.waitForSelector('nav[aria-label="Secciones principales"]', { timeout: 30000 });

  // Deja el equipo con el historial y el catalogo del servidor.
  await sincronizar(page, true);

  return { context, page, cerrar: () => context.close() };
};

// --- Acciones contra el repositorio real de la app -------------------------

export const guardarConsulta = (page, datos) => page.evaluate(async datos => {
  const repositorio = await import('/src/localRepository.js');
  return repositorio.guardarConsultaLocal(datos);
}, datos);

export const guardarVenta = (page, datos) => page.evaluate(async datos => {
  const repositorio = await import('/src/localRepository.js');
  return repositorio.guardarVentaLocal(datos);
}, datos);

export const sincronizar = (page, pull = true) => page.evaluate(async pull => {
  const motor = await import('/src/syncEngine.js');
  return motor.sincronizarAhora({ pull });
}, pull);

// --- Lecturas del estado local --------------------------------------------

export const leerOutbox = page => page.evaluate(async () => {
  const { localDb } = await import('/src/localDb.js');
  const filas = await localDb.outbox.toArray();
  return filas.map(({ id, type, entityId, status, lastError, attempts, payload }) => ({
    id, type, entityId, status, lastError, attempts, payload
  }));
});

export const leerConsulta = (page, id) => page.evaluate(async id => {
  const { localDb } = await import('/src/localDb.js');
  return (await localDb.consultations.get(id)) || null;
}, id);

export const leerInventario = (page, id) => page.evaluate(async id => {
  const { localDb } = await import('/src/localDb.js');
  return (await localDb.inventory.get(id)) || null;
}, id);

export const leerVenta = (page, id) => page.evaluate(async id => {
  const { localDb } = await import('/src/localDb.js');
  return (await localDb.sales.get(id)) || null;
}, id);

/**
 * Espera a que el outbox no tenga operaciones de un tipo dado.
 */
export const esperarOutboxLimpio = async (page, tipo, timeout = 15000) => {
  const limite = Date.now() + timeout;
  while (Date.now() < limite) {
    const filas = await leerOutbox(page);
    if (!filas.some(fila => fila.type === tipo)) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
};

export const consultaClinica = (extra = {}) => ({
  id: CONSULTA,
  fecha: '2026-01-15 10:00',
  k1_d_od: '42',
  k2_d_od: '43',
  ...extra
});

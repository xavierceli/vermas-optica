import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// TIEMPO REAL: CONTRATO DEL MODULO
// ---------------------------------------------------------------------------
// Realtime necesita navegador y Supabase, asi que no se puede montar en
// node --test. Se vigila el contrato leyendo el codigo, igual que ya hacen
// syncEngine.test.js y rls.test.js: que tablas escucha, que no pisa trabajo
// local, que cierra el canal y que Realtime nunca es obligatorio.
// ---------------------------------------------------------------------------
const SRC = dirname(fileURLToPath(import.meta.url));
const fuente = readFileSync(join(SRC, 'tiempoReal.js'), 'utf8');
const hook = readFileSync(join(SRC, 'hooks', 'useSincronizacion.js'), 'utf8');

test('escucha las tablas que cambian durante el trabajo diario', () => {
  for (const tabla of ['inventario', 'lista_precios', 'consultas_clinicas', 'pedidos_ventas', 'pagos']) {
    assert.match(fuente, new RegExp(`'${tabla}'`), `debe escuchar ${tabla}`);
  }
  assert.match(fuente, /postgres_changes/);
});

test('no abre dos canales si se llama dos veces', () => {
  assert.match(fuente, /if \(iniciado/,
    'el arranque debe ser idempotente (StrictMode monta dos veces en desarrollo)');
});

test('agrupa rafagas de eventos', () => {
  assert.match(fuente, /ESPERA_AGRUPADO_MS/,
    'una venta emite varios eventos; no se deben hacer varias descargas');
  assert.match(fuente, /pendientes\.set/);
});

test('aplica los cambios con las funciones del repositorio, no con SQL directo', () => {
  // La regla clave: reutilizar los guards de la sincronizacion normal (no pisar
  // pending, no retroceder version). Escribir localDb.inventory.put aqui seria
  // duplicar reglas y arriesgar perdida de datos.
  assert.match(fuente, /cacheServerCatalog/);
  assert.match(fuente, /aplicarFilaHistorialRemota/);
  assert.doesNotMatch(fuente, /localDb\.(inventory|consultations|sales)\.put/,
    'no debe escribir directo en Dexie');
});

test('los DELETE no inventan borrados locales', () => {
  assert.match(fuente, /eventType === 'DELETE'/);
});

test('un fallo de tiempo real no rompe la app', () => {
  assert.match(fuente, /catch \(error\)/);
  assert.match(fuente, /el sondeo de 30 s/i);
});

test('el canal se cierra al detener', () => {
  assert.match(fuente, /removeChannel/);
  assert.match(fuente, /clearTimeout\(temporizador\)/);
});

test('aplicar un evento no puede colgarse si la cola se atasca', () => {
  assert.match(fuente, /conTimeout\(\s*aplicarEvento\(cambio\)/,
    'la aplicacion pasa por la cola de escritura y debe tener tope de tiempo');
});

test('el hook arranca y detiene el tiempo real con la sesion', () => {
  assert.match(hook, /iniciarTiempoReal/);
  assert.match(hook, /detenerTiempoReal/);
  assert.match(hook, /alCambiar/);
  assert.match(hook, /sinSesionActiva/,
    'en modo PIN local no hay token: no se debe abrir el canal');
});

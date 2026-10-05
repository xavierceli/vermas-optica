import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// El motor de sincronizacion se importa contra Dexie y Supabase, que requieren
// navegador. Estos tests verifican el CONTRATO leyendo el codigo: si alguien
// reintroduce el bucle infinito de reintentos o el conteo inflado, fallan.

const SRC = join(dirname(fileURLToPath(import.meta.url)));
const fuente = readFileSync(join(SRC, 'syncEngine.js'), 'utf8');

test('una operacion no se reintenta indefinidamente', () => {
  // El sintoma era "21 pendientes" que nunca bajaban: cada 30 s se reenviaba la
  // misma fila, el servidor la rechazaba igual, y el contador solo crecia.
  assert.match(fuente, /MAX_INTENTOS/, 'debe existir un limite de intentos');
  assert.match(fuente, /intentos >= MAX_INTENTOS/,
    'tras agotar los intentos la operacion debe pasar a "descartada"');
});

test('las descartadas quedan fuera del conteo de pendientes', () => {
  // Si no, el usuario ve un numero que no baja nunca y no tiene salida.
  const bloque = fuente.slice(fuente.indexOf('const refreshCounts'));
  const cuerpo = bloque.slice(0, bloque.indexOf('};'));
  const lineaPending = cuerpo.split('\n').find(l => l.includes('status.pending'));
  assert.ok(lineaPending, 'debe existir la linea que calcula status.pending');
  // Se comprueba SOLO esa linea: si en la misma apareciera 'descartada', la
  // operacion se contaria como pendiente aunque ya no se reintente nunca.
  assert.doesNotMatch(lineaPending, /descartada/,
    '"descartada" no es pendiente: no volvera a enviarse');
  assert.match(lineaPending, /'pending'/);
  assert.match(lineaPending, /'failed'/);
  assert.match(cuerpo, /status\.descartadas\s*=/,
    'deben contabilizarse aparte para poder mostrarlas');
});

test('los conflictos no se reintentan solos', () => {
  // Reenviar un conflicto produce el mismo conflicto: solo una persona puede
  // decidir cual version gana.
  const bloqueConflicto = fuente.slice(fuente.indexOf("result.status === 'conflict'"));
  assert.match(bloqueConflicto.slice(0, 400), /finalizarOperacion\(operation, 'conflict'/);
});

test('los reintentos esperan de forma progresiva (backoff)', () => {
  // Sin backoff, 20 operaciones que fallan golpean el servidor cada 30 s.
  assert.match(fuente, /aplicarBackoff/);
  assert.match(fuente, /TIEMPO_ESPERA_BASE_MS \* \(2 \*\*/,
    'el tiempo de espera debe crecer de forma exponencial');
});

test('la cola no crece sin limite', () => {
  assert.match(fuente, /purgarDescartadas/,
    'las descartadas se purgan tras su ventana de retencion');
  assert.match(fuente, /DIAS_RETENCION_DESCARTADAS/);
});

test('las operaciones enviadas son las unicas reintentables', () => {
  const bloque = fuente.slice(fuente.indexOf('const candidatas'));
  const cuerpo = bloque.slice(0, 500);
  assert.match(cuerpo, /pending/);
  assert.match(cuerpo, /failed/);
  assert.match(cuerpo, /aplicarBackoff/);
});

// --- Bucle infinito de migración (visto en consola) ------------------------
// Symptoms: "[cola] falla importLegacyCache" repetido sin parar, y la app
// cargando los datos una y otra vez.

test('la migración del cache antiguo se marca como hecha incluso si falla', () => {
  // El codigo vive en src/repositorio/ desde el reparto en modulos; las pruebas
  // de contrato siguen comprobando el mismo invariante, solo que alli.
  const repo = readFileSync(join(SRC, 'repositorio', 'lectura.js'), 'utf8');
  const bloque = repo.slice(repo.indexOf('const importLegacyCacheImpl'));
  const cuerpo = bloque.slice(0, bloque.indexOf('obtenerSnapshotLocal'));
  // El bucle venía de que el flag 'legacyCacheImported' solo se escribía al
  // final del éxito. Con un fallo, el flag nunca se guardaba y cada carga de
  // datos volvía a intentarlo.
  assert.match(cuerpo, /catch\s*\(error\)\s*\{[\s\S]*?setMeta\('legacyCacheImported', true\)/,
    'el flag debe escribirse también en el catch para romper el bucle');
});

test('un fallo en la migración no impide cargar los datos', () => {
  const gestor = readFileSync(join(SRC, 'useGestor.js'), 'utf8');
  const bloque = gestor.slice(gestor.indexOf('const obtenerDatos'));
  const cuerpo = bloque.slice(0, bloque.indexOf('useEffect'));
  // Si la migracion lanza sin capturar, obtenerSnapshotLocal nunca se ejecuta
  // y la pantalla queda vacia.
  assert.match(cuerpo, /try\s*\{[\s\S]*?await importLegacyCache\(\);[\s\S]*?\}\s*catch/,
    'importLegacyCache debe ir envuelto en try/catch');
  assert.match(cuerpo, /obtenerSnapshotLocal/,
    'el snapshot debe seguir leyendose pase lo que pase con la migracion');
});

// --- Payload de venta rechazado por el servidor (22023) ---------------------
// Incidente real: "Cada item necesita inventario_id o codigo." x3, que arrastraron
// a 18 operaciones dependientes ("El pedido X no existe").

test('un id no numérico no se convierte en NaN (que el JSON serializa como null)', () => {
  const repo = readFileSync(join(SRC, 'repositorio', 'base.js'), 'utf8');
  const linea = repo.split('\n').find(l => l.includes('const numericId'));
  assert.ok(linea, 'debe existir numericId');
  // La version antigua era: value => ... ? null : Number(value), que devuelve
  // NaN para "ABC". Al serializar, NaN se vuelve null y el servidor rechaza.
  assert.doesNotMatch(linea, /:\s*Number\(value\)\s*;?\s*$/,
    'numericId no debe devolver Number() a secas: eso produce NaN');
  assert.match(repo, /Number\.isFinite\(n\)\s*\?\s*n\s*:\s*null/,
    'numericId debe devolver null cuando el valor no es un numero finito');
});

test('los items sin id ni codigo no se envian al servidor', () => {
  const repo = readFileSync(join(SRC, 'repositorio', 'ventas.js'), 'utf8');
  // Se ancla en el serializado del payload, no en la primera aparicion de
  // createOutboxOperation (hay varias y la del filtro esta mas abajo).
  const bloque = repo.slice(repo.indexOf('items: resolvedItems'));
  const cuerpo = bloque.slice(0, 400);
  // El servidor exige que cada item tenga inventario_id o codigo. Un item con
  // ambos nulos hace fallar la venta entera y a todo lo que dependa de ella.
  assert.match(cuerpo, /\.filter\(item => item\.inventoryId !== null/,
    'los items sin id ni codigo deben filtrarse antes de enviarse');
  assert.match(cuerpo, /inventario_id:/);
  assert.match(cuerpo, /cantidad:/);
});

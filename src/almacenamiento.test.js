import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// CONTRATO DEL MANTENIMIENTO DE ALMACENAMIENTO
// ---------------------------------------------------------------------------
// Lo que no puede fallar:
//   - la limpieza corre sola, pero no en cada sincronizacion (cada 30 s);
//   - un fallo de limpieza no rompe la sincronizacion;
//   - el aviso de cuota es visible y no se repite en bucle;
//   - nunca se libera un adjunto que aun no esta en el servidor.
// ---------------------------------------------------------------------------
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = ruta => readFileSync(join(RAIZ, ruta), 'utf8');

const sync = leer('src/syncEngine.js');
const mantenimiento = leer('src/repositorio/mantenimiento.js');
const panel = leer('src/PanelSincronizacion.jsx');
const repo = leer('src/localRepository.js');

test('la sincronizacion dispara el mantenimiento despues del pull', () => {
  assert.match(sync, /await mantenimientoDiario\(\)/);
  const posPull = sync.indexOf('if (pull) await pullServerCache()');
  const posMantenimiento = sync.indexOf('await mantenimientoDiario()');
  assert.ok(posMantenimiento > posPull, 'debe correr tras bajar datos');
});

test('un fallo de limpieza no puede tumbar la sincronizacion', () => {
  const bloque = sync.slice(sync.indexOf('const mantenimientoDiario'));
  assert.match(bloque, /catch \(error\)/, 'todo el mantenimiento va protegido');
});

test('el aviso de cuota tiene umbral y no se repite en cada pasada', () => {
  assert.match(sync, /UMBRAL_AVISO_CUOTA\s*=\s*80/);
  assert.match(sync, /avisoCuotaUltimo/);
  assert.match(sync, /AVISO_CUOTA_CADA_MS/);
  assert.match(sync, /mostrarAviso\(/, 'el usuario tiene que enterarse');
});

test('el panel muestra el uso de almacenamiento', () => {
  assert.match(panel, /estadoSync\.almacenamiento/);
  assert.match(panel, /Almacenamiento del equipo/);
});

test('nunca se libera un adjunto pendiente o con error', () => {
  const bloque = mantenimiento.slice(
    mantenimiento.indexOf('purgarAdjuntosSubidosImpl'),
    mantenimiento.indexOf('purgarCacheRedundanteImpl')
  );
  assert.match(bloque, /where\('status'\)\.equals\('uploaded'\)/,
    'solo se miran los que ya estan en el servidor');
  assert.match(bloque, /fila\.blob &&/, 'solo filas con binario');
  assert.doesNotMatch(bloque, /pending|failed/,
    'no debe haber ninguna rama que toque pendientes o fallidos');
});

test('la cache solo se borra si el dato ya esta local y sincronizado', () => {
  const bloque = mantenimiento.slice(mantenimiento.indexOf('purgarCacheRedundanteImpl'));
  assert.match(bloque, /syncStatus === 'synced'/);
  assert.match(bloque, /sincronizadas\.has/);
});

test('el mantenimiento pasa por la cola de escritura', () => {
  assert.match(repo, /ejecutarMantenimiento = opciones =>\s*\n?\s*enColaEscritura/);
});

test('el mantenimiento no puede colgar el ciclo de sincronizacion', () => {
  assert.match(sync, /conTimeout\(ejecutarMantenimiento\(\)/,
    'la cola de escritura puede pausarse; hay que poner un tope');
  assert.match(sync, /conTimeout\(revisarEspacio\(\)/);
});

test('la limpieza es diaria, no en cada ciclo de 30 s', () => {
  assert.match(mantenimiento, /INTERVALO_MANTENIMIENTO_MS\s*=\s*DIA_MS/);
  assert.match(mantenimiento, /if \(!forzar && ahora - ultimo < INTERVALO_MANTENIMIENTO_MS\)/);
});

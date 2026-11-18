import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// PRESUPUESTO DE RENDIMIENTO
// ---------------------------------------------------------------------------
// La app debe seguir abriendo rapido aunque se le anadan funciones. Estas
// pruebas fijan las dos decisiones que lo sostienen:
//   1. Las vistas se cargan por demanda (React.lazy + Suspense).
//   2. El build tiene un presupuesto de tamano que corre en la CI.
//
// El offline no se rompe: Workbox precachea TODOS los chunks del build, asi
// que quedan guardados al instalar la PWA aunque no se hayan abierto.
// ---------------------------------------------------------------------------
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = ruta => readFileSync(join(RAIZ, ruta), 'utf8');

const app = leer('src/App.jsx');
const vite = leer('vite.config.js');
const pkg = JSON.parse(leer('package.json'));
const ci = leer('.github/workflows/ci.yml');

const VISTAS = [
  'Historial', 'Clinica', 'Inventario', 'Tarifario', 'Dashboard', 'PedidosLista', 'PedidosForm'
];

test('las vistas se cargan por demanda', () => {
  for (const vista of VISTAS) {
    assert.match(
      app,
      new RegExp(`lazy\\(\\(\\) => import\\('\\./${vista}\\.jsx'\\)\\)`),
      `${vista} debe cargarse con lazy()`
    );
    assert.doesNotMatch(
      app,
      new RegExp(`import ${vista} from '\\./${vista}\\.jsx'`),
      `${vista} no debe volver a importarse de forma estatica`
    );
  }
});

test('las vistas estan dentro de un Suspense con aviso visible', () => {
  assert.match(app, /<Suspense fallback=\{<CargandoVista \/>\}>/);
  assert.match(app, /role="status"/, 'mientras carga debe anunciarse');
});

test('la impresion no viaja en el bundle inicial', () => {
  // 620 lineas de plantillas HTML que solo se usan al pulsar "Imprimir".
  assert.doesNotMatch(app, /import \{[^}]*imprimir[^}]*\} from '\.\/impresiones'/);
  assert.match(app, /import\('\.\/impresiones'\)/);
});

test('Workbox precachea todos los chunks (offline compatible con lazy)', () => {
  assert.match(vite, /globPatterns:\s*\['\*\*\/\*\.\{js,css,html,ico,svg\}'\]/,
    'si los chunks no se precachean, una vista lazy fallaria sin internet');
});

test('el presupuesto de tamano existe y corre en la CI', () => {
  assert.equal(pkg.scripts['verificar:tamano'], 'node scripts/verificar-tamano.mjs');
  assert.ok(existsSync(join(RAIZ, 'scripts', 'verificar-tamano.mjs')),
    'falta el script de presupuesto');

  const bloqueBuild = ci.slice(ci.indexOf('name: Build'));
  assert.match(bloqueBuild, /verificar:tamano/,
    'la CI debe comprobar el tamano despues del build');
});

test('el script falla si se pasa del presupuesto', () => {
  const script = leer('scripts/verificar-tamano.mjs');
  assert.match(script, /process\.exit\(1\)/);
  assert.match(script, /LIMITE_INICIAL_KB/);
  assert.match(script, /LIMITE_TOTAL_KB/);
});

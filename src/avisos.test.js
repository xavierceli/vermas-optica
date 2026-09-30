import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  avisarAviso, avisarError, cerrarAviso, leerAviso, mostrarAviso, suscribirAvisos
} from './avisos.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)));
const leer = nombre => readFileSync(join(SRC, nombre), 'utf8');

// ---------------------------------------------------------------------------
// EL AVISO
// ---------------------------------------------------------------------------
test('mostrar un aviso lo entrega a quien esta suscrito', () => {
  let recibido = null;
  const baja = suscribirAvisos(v => { recibido = v; });
  mostrarAviso('Consulta guardada', 'success');
  assert.equal(recibido.mensaje, 'Consulta guardada');
  assert.equal(recibido.tipo, 'success');
  cerrarAviso();
  baja();
});

test('el aviso desaparece solo pasado el tiempo', async () => {
  mostrarAviso('Se va solo', 'success', 20);
  assert.ok(leerAviso());
  await new Promise(r => setTimeout(r, 40));
  assert.equal(leerAviso(), null, 'el toast no puede quedarse pegado para siempre');
  cerrarAviso();
});

test('un aviso nuevo sustituye al anterior en vez de apilarse', () => {
  mostrarAviso('Primero', 'success', 0);
  mostrarAviso('Segundo', 'error', 0);
  assert.equal(leerAviso().mensaje, 'Segundo');
  assert.equal(leerAviso().tipo, 'error');
  cerrarAviso();
  assert.equal(leerAviso(), null);
});

test('un mensaje vacio no crea un aviso en blanco', () => {
  assert.equal(mostrarAviso(''), null);
  assert.equal(mostrarAviso(null), null);
  assert.equal(leerAviso(), null);
});

test('cerrar a mano limpia el aviso y avisa a los suscriptores', () => {
  let ultimo = 'sin valor';
  const baja = suscribirAvisos(v => { ultimo = v; });
  mostrarAviso('Algo', 'warning', 0);
  cerrarAviso();
  assert.equal(ultimo, null);
  baja();
});

test('el atajo de error joins el detalle al mensaje', () => {
  avisarError('No se pudo guardar', 'disco lleno');
  assert.match(leerAviso().mensaje, /No se pudo guardar: disco lleno/);
  assert.equal(leerAviso().tipo, 'error');
  cerrarAviso();
  avisarAviso('Revisa el monto');
  assert.equal(leerAviso().tipo, 'warning');
  cerrarAviso();
});

test('un suscriptor que se rompe no impide que el aviso llegue a los demas', () => {
  let bueno = null;
  const baja1 = suscribirAvisos(() => { throw new Error('este suscriptor esta roto'); });
  const baja2 = suscribirAvisos(v => { bueno = v; });
  mostrarAviso('Aun asi debe verse', 'success', 0);
  assert.equal(bueno.mensaje, 'Aun asi debe verse');
  baja1(); baja2(); cerrarAviso();
});

// --- Cabeceras de seguridad y honestidad del sincronizador --------------
test('la app declara las cabeceras de seguridad que necesita', () => {
  const raiz = join(SRC, '..');
  const conf = JSON.parse(readFileSync(join(raiz, 'vercel.json'), 'utf8'));
  const todas = (conf.headers || []).flatMap(regla => (regla.headers || []).map(h => `${h.key}: ${h.value}`));
  for (const clave of [
    'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy',
    'Permissions-Policy', 'Strict-Transport-Security', 'Content-Security-Policy'
  ]) {
    assert.ok(todas.some(cabecera => cabecera.startsWith(clave + ':')), 'falta la cabecera ' + clave);
  }
  const csp = todas.find(c => c.startsWith('Content-Security-Policy:'));
  assert.match(csp, /script-src 'self'/, 'la CSP debe permitir los scripts propios');
  // 'unsafe-inline' en script-src anula la CSP por completo: cualquier texto que
  // se cuele en el DOM se ejecuta. Solo lo justificaba el <script> en linea de
  // las plantillas de impresion, que ya no existe (impresion.js usa alCargar).
  const scriptSrc = csp.split(';').map(d => d.trim()).find(d => d.startsWith('script-src'));
  assert.ok(
    !/unsafe-inline|unsafe-eval/.test(scriptSrc),
    `script-src no debe permitir ejecucion en linea: ${scriptSrc}`
  );
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  // El service worker cacheado es lo que hacia que el aviso de version nueva se
  // repitiera sin converger nunca.
  const sw = (conf.headers || []).find(regla => regla.source === '/sw.js');
  assert.ok(sw, 'falta la regla de /sw.js');
  assert.match(sw.headers.find(h => h.key === 'Cache-Control').value, /no-cache/);
});

test('el sincronizador avisa cuando el historial le queda incompleto', () => {
  const fuente = leer('syncEngine.js');
  assert.match(fuente, /historialParcial/, 'el estado debe llevar si el historial esta completo');
  // Un aviso que solo sale por consola no es un aviso: el optometria no la abre.
  assert.match(fuente, /status\.historialParcial = descargado\.paginasDescargadas >= MAX_PAGINAS_HISTORIAL/);
  assert.match(leer('App.jsx'), /Historial parcial/, 'la interfaz debe decirlo, no solo la consola');
});

// --- La cola de escritura del motor de sincronizacion ---------------------
test('el motor de sincronizacion no envuelve lo que YA pasa por la cola', () => {
  // markLocalOperationSynced y cacheServerHistorial ya se encolan dentro de
  // localRepository. Envolverlos aqui otra vez haria que la cola esperase a si
  // misma: TODO se quedaria colgado sin ningun error visible. Es la trampa mas
  // peligrosa de este archivo, asi que queda vigilada por test.
  const fuente = leer('syncEngine.js');
  const bloques = [...fuente.matchAll(/enColaEscritura\([\s\S]{0,400}?\)\s*[,;]/g)].map(m => m[0]);
  assert.ok(bloques.length > 0, 'deberia haber bloques encolados: si no hay ninguno, la guarda no comprueba nada');
  for (const bloque of bloques) {
    for (const yaEncolado of ['markLocalOperationSynced', 'cacheServerHistorial', 'cacheServerCatalog']) {
      assert.ok(
        !bloque.includes(yaEncolado),
        `enColaEscritura envuelve a ${yaEncolado}, que ya pasa por la cola: interbloqueo garantizado`
      );
    }
  }
});

test('el stock que reconcilia el servidor pasa por la cola', () => {
  // Lee, MODIFICA y escribe. Sin la cola, un cambio de precio o de stock hecho
  // por el optometria en ese instante se pierde con el valor viejo del servidor.
  const fuente = leer('syncEngine.js');
  const i = fuente.indexOf('const reconciliarStockVenta');
  assert.ok(i >= 0, 'no se encuentra reconciliarStockVenta');
  assert.ok(
    fuente.slice(i, i + 900).includes('enColaEscritura'),
    'la reconciliacion de stock debe ir por la cola de escritura'
  );
});

// --- Las plantillas de impresion y la CSP ---------------------------------
// Los comentarios hablan de <script> y de CDN, y no ejecutan nada: lo que se
// analiza es el codigo de verdad.
const codigo = nombre => leer(nombre)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('ninguna plantilla de impresion lleva un <script> en linea', () => {
  // Cada plantilla se escribe con document.write dentro de una ventana nueva. Un
  // <script> ahi es la unica excepcion que hacia falta en script-src, y con el
  // desaparecio la CSP puede cerrarse de verdad.
  const enLinea = [...codigo('impresiones.js').matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)].map(m => m[0]);
  assert.deepEqual(enLinea, [], `script en linea en una plantilla: ${enLinea.join(', ')}`);
});

test('las plantillas de impresion no cargan nada de un CDN', () => {
  // El codigo de barras venía de un CDN externo. Sin internet la etiqueta se
  // imprimia con el hueco del codigo y sin avisar: el try/catch se lo tragaba.
  // Ni el dominio ni ninguna URL externa, ni en codigo ni en los comentarios
  // HTML de la plantilla: si vuelve a aparecer, el test lo para.
  const fuente = codigo('impresiones.js');
  assert.ok(
    !/cdn\.jsdelivr\.net|unpkg\.com|cdnjs|googleapis/.test(fuente),
    'el generador de codigo de barras debe servirse desde /vendor, no desde un CDN'
  );
  const externos = [...fuente.matchAll(/https?:\/\/[^\s"')]+/g)]
    .map(m => m[0]).filter(u => !u.includes('w3.org'));
  assert.deepEqual(externos, [], `origen externo en una plantilla: ${externos.join(', ')}`);
});

test('el generador de codigo de barras esta en public/vendor', () => {
  // Si se borra o no se copia, la etiqueta se imprime sin barras: el fallo es
  // silencioso porque el SVG vacio es un documento valido.
  const vendor = join(SRC, '..', 'public', 'vendor', 'JsBarcode.all.min.js');
  assert.ok(existsSync(vendor), 'falta public/vendor/JsBarcode.all.min.js');
  assert.ok(statSync(vendor).size > 1000, 'el fichero de vendor parece vacio o truncado');
});

test('al cargar la ventana se imprime, y con un codigo de barras valido', () => {
  const fuente = leer('impresiones.js');
  assert.match(fuente, /const alCargar = \(win, fn\)/, 'falta el helper alCargar');
  // Cada plantilla debe imprimir al cargar; si no, el documento sale en blanco.
  const cierres = (fuente.match(/win\.document\.close\(\);/g) || []).length;
  const esperas = (fuente.match(/alCargar\(win, \(\) =>/g) || []).length;
  assert.equal(esperas, cierres, 'cada plantilla debe imprimir con alCargar tras cerrar el documento');
  assert.match(fuente, /win\.JsBarcode\('#barcode', codigoPlano/, 'el codigo se pasa por la API, no por un literal JS');
});

// --- El esquema de vercel.json, que es donde se rompio el despliegue --------
// ESTO NO ES COSA DEL AVISO, pero vive aqui porque vigila las mismas cabeceras.
//
// Vercel valida vercel.json contra un esquema ESTRICTO antes de construir nada.
// Cualquier clave que no exista ahi hace fallar el despliegue entero. Lo que
// paso: para dejar el porque de cada cabecera, se metio una clave "//" con un
// comentario. Build en verde, lint en verde, 238 tests en verde... y Vercel
// rechazando el fichero: "should NOT have additional property '//'". La app
// llego a publicarse con las cabeceras de hace semanas, sin que nadie lo viera.
//
// El porque de la CSP, entonces, vive aqui (JSON no admite comentarios):
//   - script-src 'self' y SIN unsafe-inline. Antes lo llevaba porque cada
//     plantilla de impresion llevaba su <script> en linea. Ese script era el
//     unico agujero de verdad: permitia ejecutar arbitrario dentro de un
//     documento impreso con datos reales de pacientes. AlCargar lo sustituyo.
//   - style-src SI lleva 'unsafe-inline', y es a proposito: las plantillas
//     imprimen con <style> dentro del documento y React pone estilos en linea.
//     Sin ahi no se imprime nada, y un <style> no ejecuta codigo.
//   - /sw.js nunca se cachea: si se sirve una copia vieja, la app no se
//     actualiza nunca y el aviso de version nueva se repite sin converger.
const CLAVES_VERCEL = new Set([
  '$schema', 'buildCommand', 'outputDirectory', 'installCommand', 'devCommand',
  'framework', 'ignoreCommand', 'public', 'regions', 'functions', 'headers',
  'redirects', 'rewrites', 'cleanUrls', 'trailingSlash', 'git', 'github',
  'gitlab', 'bitbucket'
]);
const CLAVES_REGLA = new Set(['source', 'headers', 'has', 'missing', 'continue']);
const CLAVES_CABECERA = new Set(['key', 'value']);

test('vercel.json solo usa claves que Vercel acepta', () => {
  const conf = JSON.parse(leer('../vercel.json'));
  const comprobarClaves = (obj, permitidas, donde) => {
    for (const clave of Object.keys(obj || {})) {
      assert.ok(
        permitidas.has(clave),
        `vercel.json${donde} tiene la clave "${clave}", que Vercel no admite: ` +
        'rechaza el despliegue ENTERO antes de construir. Sin build, sin lint y sin tests.'
      );
    }
  };
  comprobarClaves(conf, CLAVES_VERCEL, '');
  for (const [i, regla] of (conf.headers || []).entries()) {
    comprobarClaves(regla, CLAVES_REGLA, ` > headers[${i}]`);
    for (const [j, cabecera] of (regla.headers || []).entries()) {
      comprobarClaves(cabecera, CLAVES_CABECERA, ` > headers[${i}].headers[${j}]`);
    }
  }
});

test('vercel.json no esconde comentarios en claves "//"', () => {
  // El intento de documentar el fichero con una clave "//" es justo lo que
  // tumbaba el despliegue. Si alguien lo vuelve a intentar, que lo sepa aqui y
  // no en el panel de Vercel.
  const conf = JSON.parse(leer('../vercel.json'));
  assert.ok(
    !JSON.stringify(conf).includes('"//"'),
    'vercel.json no admite comentarios: pon la explicacion en avisos.test.js'
  );
});

// ---------------------------------------------------------------------------
// Y QUE NO VUELVAN LOS ALERT DEL NAVEGADOR
// ---------------------------------------------------------------------------
test('ninguna pantalla vuelve a usar alert() ni window.confirm()', () => {
  // Es la regla que sostiene todo lo demas: alert() bloquea la pagina, no tiene
  // estilo y el confirm() corta el flujo. Para volver a usarlos hay que quitar
  // este test, y se veria en la revision.
  const culpables = [];
  for (const archivo of readdirSync(SRC).filter(f => /\.(js|jsx)$/.test(f))) {
    const fuente = leer(archivo);
    fuente.split('\n').forEach((linea, i) => {
      // Se ignoran los .test.js (comprueban el patron) y las lineas de comentario.
      if (archivo.endsWith('.test.js') || linea.trim().startsWith('//')) return;
      if (/(^|[^.\w])alert\s*\(/.test(linea) || /window\.confirm\s*\(/.test(linea)) {
        culpables.push(`${archivo}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(culpables, [], 'usa mostrarAviso()/avisarError(), no el alert del navegador: ' + culpables.join(', '));
});
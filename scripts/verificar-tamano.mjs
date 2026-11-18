// ---------------------------------------------------------------------------
// PRESUPUESTO DE TAMANO DEL BUNDLE
// ---------------------------------------------------------------------------
// La app crece por features, no por infraestructura: si nadie vigila, el
// arranque en tablets modestas se degrada poco a poco y nadie se da cuenta
// hasta que ya es lento.
//
// Este script distingue dos numeros:
//   - INICIAL: lo que el navegador descarga antes de pintar la primera vista
//     (el entry de index.html + sus modulepreload). Es lo que define la
//     velocidad de arranque.
//   - TOTAL: todos los chunks JS, incluidos los que solo se cargan al abrir
//     una vista (Historial, Clinica, Pedidos...) o al imprimir.
//
// Se ejecuta DESPUES de `npm run build`. Si se pasa del presupuesto, falla
// (exit 1) y la CI se pone en rojo.
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const CARPETA = 'dist/assets';
const HTML = 'dist/index.html';

// Presupuesto en kB gzip. Deja margen para crecer sin dispararse.
const LIMITE_INICIAL_KB = 220;
const LIMITE_TOTAL_KB = 400;

if (!existsSync(CARPETA) || !existsSync(HTML)) {
  console.error('No existe dist/. Ejecuta primero: npm run build');
  process.exit(1);
}

const kb = bytes => bytes / 1024;

const gzipDe = archivo => gzipSync(readFileSync(join(CARPETA, archivo)), { level: 9 }).length;

const js = readdirSync(CARPETA)
  .filter(nombre => nombre.endsWith('.js'))
  .map(nombre => ({ nombre, gzip: gzipDe(nombre) }))
  .sort((a, b) => b.gzip - a.gzip);

const html = readFileSync(HTML, 'utf8');

// Entry + modulepreload: lo que se descarga para el primer render.
const iniciales = new Set();
const entrada = html.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/);
if (entrada) iniciales.add(entrada[1]);
for (const match of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g)) {
  iniciales.add(match[1]);
}

if (iniciales.size === 0) {
  console.error('No se pudo detectar el JS inicial en dist/index.html.');
  process.exit(1);
}

let gzipInicial = 0;
for (const nombre of iniciales) {
  const encontrado = js.find(fila => fila.nombre === nombre);
  if (!encontrado) {
    console.error(`index.html referencia un chunk que no existe: ${nombre}`);
    process.exit(1);
  }
  gzipInicial += encontrado.gzip;
}

const gzipTotal = js.reduce((suma, fila) => suma + fila.gzip, 0);

console.log('Archivos JS (gzip):');
for (const fila of js) {
  const marca = iniciales.has(fila.nombre) ? ' [inicial]' : '';
  console.log(`  ${kb(fila.gzip).toFixed(1).padStart(7)} kB  ${fila.nombre}${marca}`);
}
console.log('');
console.log(`Inicial : ${kb(gzipInicial).toFixed(1)} kB  (limite ${LIMITE_INICIAL_KB} kB)`);
console.log(`Total   : ${kb(gzipTotal).toFixed(1)} kB  (limite ${LIMITE_TOTAL_KB} kB)`);

const errores = [];
if (kb(gzipInicial) > LIMITE_INICIAL_KB) {
  errores.push(
    `El arranque pasa de ${LIMITE_INICIAL_KB} kB gzip. Mueve vistas pesadas a lazy() o saca codigo del entry.`
  );
}
if (kb(gzipTotal) > LIMITE_TOTAL_KB) {
  errores.push(
    `El total pasa de ${LIMITE_TOTAL_KB} kB gzip. Revisa dependencias nuevas o duplicadas.`
  );
}

if (errores.length > 0) {
  console.error('');
  for (const error of errores) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log('\nOK: el bundle esta dentro del presupuesto.');

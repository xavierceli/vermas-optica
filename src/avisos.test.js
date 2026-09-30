import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
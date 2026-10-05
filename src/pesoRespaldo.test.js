import test from 'node:test';
import assert from 'node:assert/strict';
import { estimarPesoRespaldo, formatearPeso, nivelDePeso, mensajeDePeso } from './pesoRespaldo.js';

// PROBLEMA REAL MEDIDO: 200 fotos de 25 KB (5 MB en el dispositivo) producían un
// .json de 6,6 MB, porque base64 pesa un 33% mas. El botón decía "Preparando..."
// sin decir cuanto iba a pesar ni a tardar, y si el navegador se queda sin
// memoria la descarga falla AL FINAL: el usuario ya espera un archivo que no
// llega y no sabe por qué.

// --- Peso real medido en el proyecto ------------------------------------------

test('el peso estimado coincide con el real (200 fotos de 25 KB)', () => {
  // Medido de verdad: 5 MB de fotos -> 6,6 MB de .json
  const fotos = 200 * 25 * 1024;
  const real = 6.6 * 1024 * 1024;
  const estimado = estimarPesoRespaldo({ attachments: 200 }, fotos);
  const diferencia = Math.abs(estimado - real) / real;
  assert.ok(diferencia < 0.1, `la estimacion se desvía ${(diferencia * 100).toFixed(1)}% del peso real`);
});

// --- Estimacion --------------------------------------------------------------

test('sin fotos ni datos el respaldo es practicamente vacio', () => {
  assert.ok(estimarPesoRespaldo({}, 0) < 1024);
});

test('las fotos aportan mas peso que los datos', () => {
  const soloDatos = estimarPesoRespaldo({ patients: 500, consultations: 2000 }, 0);
  const conFotos = estimarPesoRespaldo({ patients: 500, consultations: 2000 }, 10 * 1024 * 1024);
  assert.ok(conFotos > soloDatos * 2, '10 MB de fotos deben pesar mas que toda la base de datos');
});

test('los conteos ausentes o raros no rompen la estimacion', () => {
  assert.doesNotThrow(() => estimarPesoRespaldo());
  assert.doesNotThrow(() => estimarPesoRespaldo(null, null));
  // Un conteo que no es un numero se ignora en vez de contaminar el total:
  // preferimos un peso aproximado a un Infinity o un NaN en pantalla.
  assert.equal(estimarPesoRespaldo({ patients: 'muchos' }, 0), 0);
  assert.ok(Number.isFinite(estimarPesoRespaldo({ patients: null }, NaN)));
});

test('las fotos NO se cuentan dos veces como filas', () => {
  // attachments es una tabla mas, pero sus bytes ya van en el parametro de fotos:
  // sumarlos como filas seria contar el mismo archivo dos veces.
  const a = estimarPesoRespaldo({ attachments: 0 }, 5 * 1024 * 1024);
  const b = estimarPesoRespaldo({ attachments: 5000 }, 5 * 1024 * 1024);
  assert.equal(a, b, 'las filas de attachments no deben sumar peso extra');
});

// --- Formato -----------------------------------------------------------------

test('el peso se escribe en palabras que entiende cualquiera', () => {
  assert.equal(formatearPeso(0), 'casi nada');
  assert.equal(formatearPeso(512), '512 B');
  assert.equal(formatearPeso(25 * 1024), '25 KB');
  assert.equal(formatearPeso(6.6 * 1024 * 1024), '6.6 MB');
  assert.equal(formatearPeso(450 * 1024 * 1024), '450 MB');
});

test('un peso nulo o raro no rompe el formato', () => {
  assert.equal(formatearPeso(null), 'casi nada');
  assert.equal(formatearPeso(undefined), 'casi nada');
  assert.equal(typeof formatearPeso('abc'), 'string');
});

// --- Niveles y avisos --------------------------------------------------------

test('un peso normal no avisa de nada', () => {
  assert.equal(nivelDePeso(5 * 1024 * 1024), 'ok');
});

test('un peso alto avisa antes de empezar', () => {
  assert.equal(nivelDePeso(50 * 1024 * 1024), 'aviso');
  assert.equal(nivelDePeso(500 * 1024 * 1024), 'peligro');
});

test('el aviso de peso dice cuanto va a pesar', () => {
  const mensaje = mensajeDePeso(50 * 1024 * 1024);
  assert.match(mensaje.texto, /50(\.0)? MB/);
  assert.equal(mensaje.tipo, 'aviso');
});

test('un peso peligroso sugiere el respaldo sin fotos', () => {
  const mensaje = mensajeDePeso(500 * 1024 * 1024);
  assert.match(mensaje.texto, /sin fotos/i, 'debe ofrecer la alternativa ligera');
});

test('avisa si no hay espacio libre suficiente', () => {
  // Respaldo de 6 MB pero solo 2 MB libres: la descarga fallara.
  const mensaje = mensajeDePeso(6 * 1024 * 1024, 2 * 1024 * 1024);
  assert.match(mensaje.texto, /2(\.0)? MB/, 'debe decir cuanto espacio libre queda');
  assert.match(mensaje.texto, /6(\.0)? MB/, 'debe decir cuanto pesara el respaldo');
  assert.match(mensaje.texto, /fall/, 'debe advertir que la descarga puede fallar');
});

test('con espacio de sobra no avisa', () => {
  const mensaje = mensajeDePeso(6 * 1024 * 1024, 500 * 1024 * 1024);
  assert.equal(mensaje.tipo, 'ok');
});

test('sin dato de espacio el mensaje sigue siendo util', () => {
  // espacioEnDisco puede fallar (navegador raro): la app no debe romperse ni
  // quedarse muda, asi que el peso se dice igual y el aviso simplemente no aparece.
  const mensaje = mensajeDePeso(6 * 1024 * 1024, null);
  assert.match(mensaje.texto, /6(\.0)? MB/, 'debe decir el peso aunque no sepa el espacio libre');
  assert.doesNotThrow(() => mensajeDePeso(6 * 1024 * 1024, undefined));
});
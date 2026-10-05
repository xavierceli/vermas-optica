import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularEdad, parsearFechaLocal, nombreDelMes, nombreCortoDelMes } from './fechas.js';

// BUG REAL Y MEDIDO: `new Date('1990-05-15')` no es medianoche local, es
// MEDIANOCHE UTC. En Ecuador (UTC-5) eso es el dia 14 a las 19:00, y la edad se
// adelantaba un dia: el 14 de mayo la app decia "36 años" cuando el paciente
// cumplia 35. La edad va en la receta y en el informe: es dato de salud.
//
// Estos tests pasan una fecha fija como "hoy", asi que no dependen de cuando se
// ejecuten ni de la zona horaria de la maquina.

// 15 de mayo de 2026 es el dia del cumpleanos; el 14, el dia anterior.
const HOY_CUMPLE = new Date(2026, 4, 15);
const HOY_ANTES = new Date(2026, 4, 14);
const HOY_DESPUES = new Date(2026, 4, 16);

test('el dia ANTERIOR al cumpleanos todavia no cumple anos', () => {
  assert.equal(calcularEdad('1990-05-15', HOY_ANTES), 35, 'el 14 de mayo tiene 35, no 36');
});

test('el dia del cumpleanos ya suma un ano', () => {
  assert.equal(calcularEdad('1990-05-15', HOY_CUMPLE), 36);
});

test('un dia despues tambien, y no mas', () => {
  assert.equal(calcularEdad('1990-05-15', HOY_DESPUES), 36);
});

test('la edad no depende de la zona horaria de la maquina', () => {
  // Con el parseo por UTC, ejecutar el mismo test en otra zona horaria cambia la
  // respuesta. Aqui la fecha se construye con sus piezas, a hora local.
  assert.equal(calcularEdad('2000-01-01', new Date(2026, 0, 1)), 26, 'cumple justo hoy');
  assert.equal(calcularEdad('2000-01-10', new Date(2026, 0, 2)), 25, 'aun no ha cumplido');
  assert.equal(calcularEdad('2000-01-10', new Date(2026, 0, 10)), 26, 'hoy si');
});

test('una fecha desbordada se rechaza en vez de convertirse sola', () => {
  // new Date(1990, 12, 45) no falla: se convierte en enero de 1991. Un dato
  // imposible debe verse como 'sin dato', no como una edad inventada.
  assert.equal(calcularEdad('1990-13-45', new Date(2026, 4, 15)), '');
  assert.equal(calcularEdad('2026-02-30', new Date(2026, 4, 15)), '', 'el 30 de febrero no existe');
});

test('una fecha de nacimiento ilegible no rompe nada', () => {
  assert.equal(calcularEdad('', HOY_CUMPLE), '');
  assert.equal(calcularEdad(null, HOY_CUMPLE), '');
  assert.equal(calcularEdad('no es una fecha', HOY_CUMPLE), '');
  assert.equal(calcularEdad('1990-13-45', HOY_CUMPLE), '');
});

test('parsearFechaLocal devuelve la hora local, no la de UTC', () => {
  const d = parsearFechaLocal('1990-05-15');
  assert.equal(d.getDate(), 15, 'el dia debe ser el 15, no el 14');
  assert.equal(d.getMonth(), 4);
  assert.equal(d.getFullYear(), 1990);
  assert.equal(d.getHours(), 0, 'medianoche local');
});

// BUG REAL: el panel de estadisticas rotulaba "Octubre 2026" escrito a mano en el
// codigo. Los numeros si cambiaban solos, asi que en noviembre el panel decia
// "octubre" encima de cifras de noviembre: una etiqueta falsa sobre datos reales.
// Estos tests comprueban los 12 meses y el cambio de anio con fechas fijas.

test('el nombre del mes sale de la fecha, no de un texto fijo', () => {
  assert.equal(nombreDelMes(new Date(2026, 9, 4)), 'Octubre 2026');
  assert.equal(nombreDelMes(new Date(2026, 10, 1)), 'Noviembre 2026');
  assert.equal(nombreDelMes(new Date(2026, 0, 15)), 'Enero 2026');
  assert.equal(nombreDelMes(new Date(2026, 11, 31)), 'Diciembre 2026');
});

test('los doce meses tienen nombre y ningun mes se repite', () => {
  const nombres = Array.from({ length: 12 }, (_, m) => nombreDelMes(new Date(2026, m, 1)));
  assert.equal(nombres.length, 12);
  assert.equal(new Set(nombres).size, 12, 'ningun mes debe repetir nombre');
  assert.deepEqual(nombres, [
    'Enero 2026', 'Febrero 2026', 'Marzo 2026', 'Abril 2026', 'Mayo 2026', 'Junio 2026',
    'Julio 2026', 'Agosto 2026', 'Septiembre 2026', 'Octubre 2026', 'Noviembre 2026', 'Diciembre 2026'
  ]);
});

test('el anio tambien cambia solo', () => {
  assert.equal(nombreDelMes(new Date(2027, 0, 1)), 'Enero 2027');
  assert.equal(nombreDelMes(new Date(2028, 9, 1)), 'Octubre 2028');
});

test('el nombre corto son las tres primeras letras', () => {
  assert.equal(nombreCortoDelMes(new Date(2026, 9, 4)), 'Oct');
  assert.equal(nombreCortoDelMes(new Date(2026, 10, 1)), 'Nov');
});

test('una fecha invalida no rompe el rotulo del panel', () => {
  assert.equal(typeof nombreDelMes(new Date('no es una fecha')), 'string');
  assert.match(nombreDelMes(new Date('no es una fecha')), /\w+ \d{4}/);
  assert.equal(nombreDelMes(), nombreDelMes(new Date()), 'sin argumento usa la fecha de hoy');
});

test('parsearFechaLocal acepta tambien una fecha con hora', () => {
  const d = parsearFechaLocal('2026-09-28T15:30:00Z');
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString(), '2026-09-28T15:30:00.000Z');
});

test('un bebe recien nacido tiene 0 anos, no -1', () => {
  assert.equal(calcularEdad('2026-05-14', HOY_CUMPLE), 0);
});

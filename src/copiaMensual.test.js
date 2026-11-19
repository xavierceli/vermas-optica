import test from 'node:test';
import assert from 'node:assert/strict';
import { DIAS_ENTRE_COPIAS, estadoCopiaMensual } from './copiaMensual.js';

const dia = (anio, mes, diaMes, hora = 12, minuto = 0) =>
  new Date(anio, mes - 1, diaMes, hora, minuto);

test('sin registro avisa que la copia nunca se hizo', () => {
  const estado = estadoCopiaMensual({ hoy: dia(2026, 11, 20) });
  assert.equal(estado.nivel, 'aviso');
  assert.equal(estado.dias, null);
  assert.equal(estado.ultimo, null);
  assert.match(estado.mensaje, /Nunca se registró la copia mensual/);
});

test('una copia reciente se muestra al día', () => {
  const estado = estadoCopiaMensual({ ultimo: dia(2026, 11, 10), hoy: dia(2026, 11, 20) });
  assert.equal(estado.nivel, 'ok');
  assert.equal(estado.dias, 10);
  assert.match(estado.mensaje, /hace 10 días/);
  assert.match(estado.mensaje, /Última copia/);
});

test('a los 31 días exactos vuelve el aviso', () => {
  const estado = estadoCopiaMensual({ ultimo: dia(2026, 10, 20), hoy: dia(2026, 11, 20) });
  assert.equal(estado.dias, DIAS_ENTRE_COPIAS);
  assert.equal(estado.nivel, 'aviso');
  assert.match(estado.mensaje, /está pendiente/);
});

test('un mes largo sigue avisando aunque pase de 31 días', () => {
  const estado = estadoCopiaMensual({ ultimo: dia(2026, 10, 6), hoy: dia(2026, 11, 20) });
  assert.equal(estado.dias, 45);
  assert.equal(estado.nivel, 'aviso');
  assert.match(estado.mensaje, /45 días/);
});

test('una fecha inválida cuenta como nunca registrada', () => {
  const estado = estadoCopiaMensual({ ultimo: 'no es una fecha', hoy: dia(2026, 11, 20) });
  assert.equal(estado.nivel, 'aviso');
  assert.match(estado.mensaje, /Nunca se registró/);
});

test('un reloj adelantado no produce días negativos', () => {
  const estado = estadoCopiaMensual({ ultimo: dia(2026, 11, 25), hoy: dia(2026, 11, 20) });
  assert.equal(estado.dias, 0);
  assert.equal(estado.nivel, 'ok');
  assert.match(estado.mensaje, /hoy/);
});

test('una copia de anoche sigue contando como de ayer', () => {
  const estado = estadoCopiaMensual({
    ultimo: dia(2026, 11, 1, 23, 30),
    hoy: dia(2026, 11, 2, 1, 0)
  });
  assert.equal(estado.dias, 1);
  assert.equal(estado.nivel, 'ok');
  assert.match(estado.mensaje, /hace 1 día/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { resumenTiempoReal, UMBRAL_AVISO_TIEMPO_REAL_MS } from './tiempoRealResumen.js';

// ---------------------------------------------------------------------------
// El aviso de Realtime no debe alarmar: el sondeo de 30 s sigue funcionando.
// Estos casos fijan cuando se muestra cada mensaje.
// ---------------------------------------------------------------------------

test('con el canal apagado (modo PIN o sin sesion) no se muestra nada', () => {
  assert.deepEqual(resumenTiempoReal({ estado: 'apagado' }), { nivel: 'oculto', mensaje: '' });
});

test('conectado se muestra en verde', () => {
  const aviso = resumenTiempoReal({ estado: 'SUBSCRIBED' });
  assert.equal(aviso.nivel, 'ok');
  assert.match(aviso.mensaje, /al instante/);
});

test('sin internet no se duplica el aviso de conexion', () => {
  const aviso = resumenTiempoReal({ estado: 'CHANNEL_ERROR', caidoMs: 60000, online: false });
  assert.equal(aviso.nivel, 'oculto');
});

test('un parpadeo corto solo dice reconectando', () => {
  const aviso = resumenTiempoReal({ estado: 'CHANNEL_ERROR', caidoMs: 30000 });
  assert.equal(aviso.nivel, 'espera');
  assert.match(aviso.mensaje, /reconectando/i);
});

test('justo en el umbral ya avisa con minutos', () => {
  const aviso = resumenTiempoReal({ estado: 'TIMED_OUT', caidoMs: UMBRAL_AVISO_TIEMPO_REAL_MS });
  assert.equal(aviso.nivel, 'aviso');
  assert.match(aviso.mensaje, /5 min/);
  assert.match(aviso.mensaje, /cada 30 s/);
});

test('a los 12 minutos el mensaje lo dice', () => {
  const aviso = resumenTiempoReal({ estado: 'CHANNEL_ERROR', caidoMs: 12 * 60 * 1000 });
  assert.equal(aviso.nivel, 'aviso');
  assert.match(aviso.mensaje, /12 min/);
});

test('un caidoMs invalido no rompe el resumen', () => {
  const aviso = resumenTiempoReal({ estado: 'CLOSED', caidoMs: null });
  assert.equal(aviso.nivel, 'espera');
});

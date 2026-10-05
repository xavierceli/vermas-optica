import test from 'node:test';
import assert from 'node:assert/strict';
import { esSoloLocal, estadoDeSincronizacion, contarSoloLocales } from './estadoSincronizacion.js';

// BUG REAL: una venta guardada sin internet, o rechazada por el servidor, se
// quedaba visible en la lista de pedidos con el mismo aspecto que una venta ya
// subida. El usuario no tenia ningun aviso de que esos datos existian SOLO en
// ese equipo, y podia cerrarlo creyendo que estaban respaldados.

test('una venta pendiente NO es invisible: se marca como solo local', () => {
  assert.equal(esSoloLocal({ syncStatus: 'pending' }), true);
});

test('una venta sincronizada no se marca', () => {
  assert.equal(esSoloLocal({ syncStatus: 'synced' }), false);
});

test('un registro sin syncStatus no se marca (viene del servidor)', () => {
  assert.equal(esSoloLocal({ id: 1, nombre: 'JUAN' }), false);
  assert.equal(esSoloLocal({ syncStatus: null }), false);
  assert.equal(esSoloLocal({ syncStatus: '' }), false);
  assert.equal(esSoloLocal({ syncStatus: '  synced  ' }), false, 'espacios no cuentan');
});

test('el estado nunca rompe con datos raros', () => {
  assert.equal(esSoloLocal(null), false);
  assert.equal(esSoloLocal(undefined), false);
  assert.doesNotThrow(() => estadoDeSincronizacion(null));
  assert.doesNotThrow(() => estadoDeSincronizacion({}));
});

test('la etiqueta de pendiente explica donde esta el dato', () => {
  const e = estadoDeSincronizacion({ syncStatus: 'pending' });
  assert.equal(e.estado, 'pendiente');
  assert.equal(e.texto, 'Solo en este equipo');
  assert.ok(e.detalle.length > 0, 'debe explicar que se subira sola');
});

test('una venta sincronizada no muestra etiqueta', () => {
  const e = estadoDeSincronizacion({ syncStatus: 'synced' });
  assert.equal(e.estado, 'sincronizada');
  assert.equal(e.texto, '');
});

test('cuenta cuantas ventas quedan solo en el equipo', () => {
  const lista = [
    { syncStatus: 'pending' },
    { syncStatus: 'synced' },
    { syncStatus: 'pending' },
    { syncStatus: 'failed' },
    { }
  ];
  assert.equal(contarSoloLocales(lista).total, 3, 'cuenta pending y failed, no las sincronizadas');
});

test('una lista vacia o nula no rompe el conteo', () => {
  assert.equal(contarSoloLocales([]).total, 0);
  assert.equal(contarSoloLocales().total, 0);
  assert.equal(contarSoloLocales(null).total, 0);
});
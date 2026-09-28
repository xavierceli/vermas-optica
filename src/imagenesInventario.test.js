import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraerRutaImagen } from './rutaImagen.js';

// El bucket `inventario_imagenes` es PRIVADO (migraciones 006 y 008). La app
// usaba getPublicUrl para construir la URL, pero en un bucket privado responde 400 y
// deja la foto rota. Lo correcto es guardar la RUTA y firmarla al mostrarla.
//
// Estos tests fijan el contrato de `extraerRutaImagen`, que es la pieza que
// decide si la foto se resuelve o se pierde.

test('extrae la ruta de una URL publica antigua', () => {
  const url = 'https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/producto_123.jpg';
  assert.equal(extraerRutaImagen(url), 'inventario_imagenes/producto_123.jpg');
});

test('devuelve tal cual una ruta ya relativa', () => {
  assert.equal(extraerRutaImagen('producto_123.jpg'), 'producto_123.jpg');
  assert.equal(extraerRutaImagen('carpeta/producto_123.jpg'), 'carpeta/producto_123.jpg');
});

test('acepta una ruta con prefijo de almacenamiento sobrante', () => {
  assert.equal(
    extraerRutaImagen('/storage/v1/object/public/inventario_imagenes/foto.jpg'),
    'inventario_imagenes/foto.jpg'
  );
});

test('devuelve null para valores vacios o ausentes', () => {
  assert.equal(extraerRutaImagen(null), null);
  assert.equal(extraerRutaImagen(undefined), null);
  assert.equal(extraerRutaImagen(''), null);
  assert.equal(extraerRutaImagen('   '), null);
});

test('devuelve null ante una URL malformada en vez de lanzar', () => {
  // Una URL rota no debe tumbar el listado de inventario.
  assert.doesNotThrow(() => extraerRutaImagen('http://'));
});

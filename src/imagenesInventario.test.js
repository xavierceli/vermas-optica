import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraerRutaImagen, extraerRutaArchivo } from './rutaImagen.js';

// El bucket `inventario_imagenes` es PRIVADO (migraciones 006 y 008). La app
// usaba getPublicUrl para construir la URL, pero en un bucket privado responde 400 y
// deja la foto rota. Lo correcto es guardar la RUTA y firmarla al mostrarla.
//
// Estos tests fijan el contrato de `extraerRutaImagen`, que es la pieza que
// decide si la foto se resuelve o se pierde.
//
// LA REGLA QUE ESTOS TESTS PROTEGEN: createSignedUrl() recibe el bucket por
// separado (.from('inventario_imagenes')), asi que la ruta NUNCA puede empezar
// por el nombre del bucket. Antes esta funcion devolvia
// "inventario_imagenes/1788_x.png" y Storage buscaba
// "inventario_imagenes/inventario_imagenes/1788_x.png": HTTP 400 y foto rota.

const GEMINI = '1788277291740_GeminiGeneratedImage1ml3ibrni3br1ml.png';
const URL_PUBLICA_ANTIGUA =
  'https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/' + GEMINI;

test('extrae la ruta de una URL publica antigua (caso real del inventario)', () => {
  assert.equal(extraerRutaImagen(URL_PUBLICA_ANTIGUA), GEMINI);
});

test('extrae la ruta de una URL firmada antigua con token', () => {
  assert.equal(
    extraerRutaImagen(
      'https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/sign/inventario_imagenes/foto_1.jpg?token=abc.def'
    ),
    'foto_1.jpg'
  );
});

test('extrae la ruta de una URL de renderizacion con sesion', () => {
  assert.equal(
    extraerRutaImagen(
      'https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/render/image/authenticated/inventario_imagenes/foto_2.jpg'
    ),
    'foto_2.jpg'
  );
});

test('devuelve tal cual una ruta ya relativa', () => {
  assert.equal(extraerRutaImagen('producto_123.jpg'), 'producto_123.jpg');
  assert.equal(extraerRutaImagen('carpeta/producto_123.jpg'), 'carpeta/producto_123.jpg');
});

test('acepta una ruta con prefijo de almacenamiento sobrante', () => {
  assert.equal(
    extraerRutaImagen('/storage/v1/object/public/inventario_imagenes/foto.jpg'),
    'foto.jpg'
  );
});

test('recorta el nombre del bucket si viene pegado a la ruta', () => {
  assert.equal(extraerRutaImagen('inventario_imagenes/producto_123.jpg'), 'producto_123.jpg');
});

test('recorta el bucket repetido, que es el bug que rompia las fotos', () => {
  assert.equal(
    extraerRutaImagen('inventario_imagenes/inventario_imagenes/producto_123.jpg'),
    'producto_123.jpg'
  );
});

test('decodifica los nombres de archivo con espacios o acentos', () => {
  assert.equal(
    extraerRutaImagen(
      'https://x.supabase.co/storage/v1/object/public/inventario_imagenes/producto%20con%20espacio.jpg'
    ),
    'producto con espacio.jpg'
  );
});

test('descarta el token si una ruta viene con query', () => {
  assert.equal(extraerRutaImagen('foto.jpg?token=abc'), 'foto.jpg');
});

test('es idempotente: normalizar dos veces da el mismo resultado', () => {
  const entradas = [
    URL_PUBLICA_ANTIGUA,
    'inventario_imagenes/foto.jpg',
    'inventario_imagenes/inventario_imagenes/foto.jpg',
    '/storage/v1/object/public/inventario_imagenes/foto.jpg',
    'foto.jpg'
  ];
  for (const valor of entradas) {
    const una = extraerRutaImagen(valor);
    assert.equal(extraerRutaImagen(una), una, valor);
  }
});

test('JAMAS devuelve una ruta que empiece por el nombre del bucket', () => {
  // Invariante de seguridad: mientras se cumpla, no puede volver el 400 por
  // "inventario_imagenes/inventario_imagenes/...".
  const entradas = [
    URL_PUBLICA_ANTIGUA,
    'inventario_imagenes/foto.jpg',
    'inventario_imagenes/inventario_imagenes/foto.jpg',
    '/storage/v1/object/public/inventario_imagenes/foto.jpg',
    'https://x.supabase.co/storage/v1/object/sign/inventario_imagenes/sub/foto.jpg?token=t',
    'foto.jpg'
  ];
  for (const valor of entradas) {
    const ruta = extraerRutaImagen(valor);
    assert.ok(ruta, valor);
    assert.ok(
      !ruta.toLowerCase().startsWith('inventario_imagenes/'),
      'la ruta no debe llevar el bucket: ' + ruta
    );
  }
});

test('devuelve null para valores vacios o ausentes', () => {
  assert.equal(extraerRutaImagen(null), null);
  assert.equal(extraerRutaImagen(undefined), null);
  assert.equal(extraerRutaImagen(''), null);
  assert.equal(extraerRutaImagen('   '), null);
});

test('devuelve null ante una URL malformada en vez de lanzar', () => {
  assert.doesNotThrow(() => extraerRutaImagen('http://'));
});

test('rechaza rutas que intenten salir del directorio', () => {
  assert.equal(extraerRutaImagen('../secret.jpg'), null);
  assert.equal(extraerRutaImagen('carpeta/../../secret.jpg'), null);
});

// --- El mismo normalizador se usa para los comprobantes de pago -----------
// Alli estaba duplicado (comprobantes.js) y fallaba igual que el inventario.

test('recorta tambien el bucket de comprobantes, no solo el del inventario', () => {
  const ruta = valor => extraerRutaArchivo(valor, 'comprobantes_pagos');
  assert.equal(
    ruta('https://x.supabase.co/storage/v1/object/public/comprobantes_pagos/comprobante_1.jpg'),
    'comprobante_1.jpg'
  );
  assert.equal(ruta('comprobantes_pagos/comprobante_1.jpg'), 'comprobante_1.jpg');
  assert.equal(ruta('comprobante_1.jpg'), 'comprobante_1.jpg');
  // Un comprobante NO debe perder el nombre del bucket del inventario ni al reves.
  assert.equal(
    extraerRutaArchivo('comprobantes_pagos/foto.jpg', 'inventario_imagenes'),
    'comprobantes_pagos/foto.jpg'
  );
});
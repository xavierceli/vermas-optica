import test from 'node:test';
import assert from 'node:assert/strict';
import { autoCalcularPrecio, fieldsQueAfectanPrecio } from './calculoPrecio.js';

// Estas funciones no tenian pruebas: vivian dentro de useGestor.js, un archivo
// de 1.000 lineas que necesita un navegador para probarse. Al sacarlas a un
// modulo puro se prueban de verdad. Si el precio automatico falla, el optometria
// cobra de mas o de menos sin darse cuenta.

const INVENTARIO = [
  { id: 1, codigo: 'MIRA-4017', categoria: 'Armazon', precio: '45.00' },
  { id: 2, categoria: 'Accesorio', nombre_accesorio: 'Estuche', precio: '8.50' }
];

const TARIFARIO = [
  { tipo_lente: 'CALCULO', rango_medida: 'BASE', material: 'Plastico', precio_sugerido: '30.00' },
  { tipo_lente: 'CALCULO', rango_medida: 'BASE', material: 'AR Verde', precio_sugerido: '12.00' },
  { tipo_lente: 'CALCULO', rango_medida: 'BASE', material: 'Tinturado', precio_sugerido: '20.00' }
];

test('sin armazon ni accesorio el total es 0', () => {
  assert.equal(autoCalcularPrecio({}, INVENTARIO, TARIFARIO), 0);
});

test('un pedido vacio o nulo no rompe', () => {
  assert.equal(autoCalcularPrecio(null, INVENTARIO, TARIFARIO), 0);
  assert.equal(autoCalcularPrecio({}, null, null), 0);
});

test('suma el precio del armazon elegido', () => {
  assert.equal(autoCalcularPrecio({ codigo_armazon: 'MIRA-4017' }, INVENTARIO, TARIFARIO), 45);
});

test('el codigo del armazon no distingue mayusculas ni espacios', () => {
  assert.equal(autoCalcularPrecio({ codigo_armazon: '  mira-4017 ' }, INVENTARIO, TARIFARIO), 45);
});

test('un armazon que no existe en el catalogo no suma nada', () => {
  assert.equal(autoCalcularPrecio({ codigo_armazon: 'NO-EXISTE' }, INVENTARIO, TARIFARIO), 0);
});

test('suma armazon, accesorio, lentes y tratamiento', () => {
  const total = autoCalcularPrecio({
    codigo_armazon: 'MIRA-4017',   // 45
    accesorio_id: 2,               // 8.50
    material_lente: 'Plastico',    // 30
    tratam_ar: 'SI'                // 12
  }, INVENTARIO, TARIFARIO);
  assert.equal(total, 95.5);
});

test('un tratamiento en NO no suma', () => {
  const conSI = autoCalcularPrecio({ material_lente: 'Plastico', tratam_ar: 'SI' }, INVENTARIO, TARIFARIO);
  const conNO = autoCalcularPrecio({ material_lente: 'Plastico', tratam_ar: 'NO' }, INVENTARIO, TARIFARIO);
  assert.equal(conSI - conNO, 12, 'el antirreflejo debe sumar 12');
});

test('varios tratamientos se suman todos', () => {
  const total = autoCalcularPrecio({ tratam_ar: 'SI', tratam_tinturado: 'SI' }, INVENTARIO, TARIFARIO);
  assert.equal(total, 32, '12 + 20');
});

test('un material sin tarifa no inventa precio', () => {
  assert.equal(autoCalcularPrecio({ material_lente: 'Material Inventado' }, INVENTARIO, TARIFARIO), 0);
});

test('el material "Otros" no suma tarifa automatica (se teclea a mano)', () => {
  assert.equal(autoCalcularPrecio({ material_lente: 'Otros' }, INVENTARIO, TARIFARIO), 0);
});

test('el total siempre tiene dos decimales', () => {
  const total = autoCalcularPrecio({ codigo_armazon: 'MIRA-4017', tratam_ar: 'SI' }, INVENTARIO, TARIFARIO);
  assert.equal(total, 57);
  assert.equal(typeof total, 'number');
});

test('solo las filas BASE del tarifario se usan como precio automatico', () => {
  const tarifas = [
    ...TARIFARIO,
    { tipo_lente: 'CALCULO', rango_medida: 'ALTO', material: 'Plastico', precio_sugerido: '99.00' }
  ];
  assert.equal(autoCalcularPrecio({ material_lente: 'Plastico' }, INVENTARIO, tarifas), 30,
    'la fila ALTO no debe ganar sobre la BASE');
});

test('se recognize que campos obligan a recalcular', () => {
  assert.equal(fieldsQueAfectanPrecio('codigo_armazon'), true);
  assert.equal(fieldsQueAfectanPrecio('material_lente'), true);
  assert.equal(fieldsQueAfectanPrecio('tratam_ar'), true);
  assert.equal(fieldsQueAfectanPrecio('notas'), false);
  assert.equal(fieldsQueAfectanPrecio('venta'), false);
});
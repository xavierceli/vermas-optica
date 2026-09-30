import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  validarCobroSobreVenta, validarMontoCobro, validarVentaParaCambiarEstado
} from './cobros.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)));
const leer = nombre => readFileSync(join(SRC, nombre), 'utf8');

// El monto de un cobro es dinero. Estas reglas estaban duplicadas en las dos
// pantallas de cobro y ninguna probada: aceptaban 0, aceptaban tres decimales y
// se olvidaban de que sin venta no hay nada que abonar.

const VENTA = { pedido_id: 'vta-1' };

// --- El monto -------------------------------------------------------------
test('un monto de cero no es un cobro', () => {
  assert.match(validarMontoCobro(0), /mayor a 0/);
});

test('un monto negativo no es un cobro', () => {
  assert.match(validarMontoCobro(-5), /mayor a 0/);
});

test('un monto vacio o no numerico no es un cobro', () => {
  assert.match(validarMontoCobro(''), /mayor a 0/);
  assert.match(validarMontoCobro(null), /mayor a 0/);
  assert.match(validarMontoCobro('abc'), /mayor a 0/);
  assert.match(validarMontoCobro(undefined), /mayor a 0/);
});

test('con tres decimales se avisa, porque no se puede cobrar', () => {
  assert.match(validarMontoCobro(10.999), /dos decimales/);
  assert.match(validarMontoCobro(0.001), /dos decimales/);
});

test('con dos decimales se acepta', () => {
  assert.equal(validarMontoCobro(10.99), null);
  assert.equal(validarMontoCobro(10), null);
  assert.equal(validarMontoCobro('20.50'), null);
});

test('el error de coma flotante de la suma no se cuela como un tercer decimal', () => {
  // 0.1 + 0.2 = 0.30000000000000004: sin tolerancia, el cobro se rechazaria.
  assert.equal(validarMontoCobro(0.1 + 0.2), null);
});

// --- La venta -------------------------------------------------------------
test('sin venta local no hay nada a abonar', () => {
  assert.match(validarCobroSobreVenta({ item: {}, monto: 10 }), /no tiene una venta local/);
  assert.match(validarCobroSobreVenta({ item: { pedido_id: '' }, monto: 10 }), /no tiene una venta local/);
  assert.match(validarCobroSobreVenta({ item: { pedido_id: '   ' }, monto: 10 }), /no tiene una venta local/);
});

test('con venta y monto valido, todo en orden', () => {
  assert.equal(validarCobroSobreVenta({ item: VENTA, monto: 10.5 }), null);
});

test('el monto se revisa ANTES que la venta (es el orden que ve el usuario)', () => {
  // Sin esto, escribir 0 en una consulta sin venta diria "no tiene venta", que
  // no es lo que el optometria quiere arreglar primero.
  assert.match(validarCobroSobreVenta({ item: {}, monto: 0 }), /mayor a 0/);
});

test('cambiar el estado de un registro sin venta tambien se avisa', () => {
  assert.match(validarVentaParaCambiarEstado({}), /no tiene una venta local/);
  assert.equal(validarVentaParaCambiarEstado(VENTA), null);
});

// --- Y que las dos pantallas usen la MISMA regla --------------------------
test('las dos pantallas de cobro comparten el validador', () => {
  for (const archivo of ['PedidosLista.jsx', 'PedidosForm.jsx']) {
    assert.match(leer(archivo), /from '\.\/cobros'/, `${archivo} debe usar cobros.js`);
  }
});

test('ninguna pantalla vuelve a comprobar el monto por su cuenta', () => {
  for (const archivo of ['PedidosLista.jsx', 'PedidosForm.jsx']) {
    const fuente = leer(archivo);
    assert.ok(
      !/monto\s*<=\s*0/.test(fuente),
      `${archivo} comprueba el monto a mano: la regla vive en cobros.js, con tests`
    );
  }
});
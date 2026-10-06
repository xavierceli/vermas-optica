import test from 'node:test';
import assert from 'node:assert/strict';
import { clasificarFallo, mensajeDeFallo } from './clasificarFallo.js';

// BUG GRAVE QUE SE CORRIGIO AQUI:
// 'Stock insuficiente' estaba en la lista de rechazos PERMANENTES. Si dos
// equipos vendian la misma montura y el stock se agotaba, la operacion se
// marcaba 'descartada' y a los 7 dias se BORRABA de la base local.
//
// El detalle que hace el dano: en el servidor crear_venta() mete la evaluacion
// clinica y la venta en la MISMA transaccion. Si la venta falla por stock, la
// evaluacion tampoco se guarda. Al descartar en el cliente se perdian las dos
// cosas: el optometrista no podia reasignar la montura sin perder el examen.

// --- El caso grave: un rechazo de stock NUNCA descarta ------------------------

test('stock insuficiente NO descarta: pasa a conflicto', () => {
  const resultado = clasificarFallo('Stock insuficiente para producto 5');
  assert.equal(resultado, 'conflict',
    'descartar aqui perderia tambien la evaluacion clinica del paciente');
});

test('el error real de PostgreSQL tambien es conflicto, no descarte', () => {
  // 23514 es el SQLSTATE de una violacion de check; aca la dispara el stock.
  assert.equal(clasificarFallo('23514: Stock insuficiente'), 'conflict');
  assert.equal(clasificarFallo('no hay stock disponible'), 'conflict');
  assert.equal(clasificarFallo('excede el stock disponible'), 'conflict');
});

test('un conflicto de stock NUNCA se descarta, ni reintentando 99 veces', () => {
  // Aunque haya fallado muchas veces, seguir clasificado como conflicto: el
  // dato es valido, solo choca con el inventario.
  for (const intentos of [0, 1, 5, 50, 99]) {
    assert.equal(
      clasificarFallo('Stock insuficiente', { intentos, maxIntentos: 5 }),
      'conflict',
      `con ${intentos} intentos no debe descartar`
    );
  }
});

test('el mensaje de conflicto dice que no se perdio nada', () => {
  const texto = mensajeDeFallo('Stock insuficiente para producto 5', 'conflict');
  assert.match(texto, /No se perdi[oó] nada/i,
    'el optometrista tiene que saber que el examen sigue guardado');
  assert.match(texto, /evaluaci[oó]n cl[ií]nica/i);
});

// --- Lo que SI se puede descartar ---------------------------------------------

test('un dato invalido si se descarta', () => {
  assert.equal(clasificarFallo('Item de venta inválido: monto negativo'), 'descartada');
  assert.equal(clasificarFallo('duplicate key value violates unique constraint'), 'descartada');
  assert.equal(clasificarFallo('violates foreign key constraint'), 'descartada');
});

test('un conflicto de foreign key si se descarta', () => {
  // El reporte de la auditoria mezclaba esto con 'stock insuficiente'. No es lo
  // mismo: una llave foranea rota significa que el dato apunta a algo que no
  // existe, y reintentar no lo arregla.
  assert.equal(clasificarFallo('violates foreign key constraint'), 'descartada');
  assert.equal(clasificarFallo('23503'), 'descartada');
});

test('archivar una consulta que nunca subio SI se descarta', () => {
  // Caso especial: no hay nada que archivar, asi que quedarse esperando no
  // sirve de nada. Este 'no existe' si es legitimo.
  assert.equal(
    clasificarFallo('La consulta no existe', { tipo: 'ARCHIVAR_CONSULTA' }),
    'descartada'
  );
});

test('pero archivar algo que no existe NO aplica a otros tipos', () => {
  // Si es una venta y dice 'no existe', el dato puede estar mal: hay que verlo.
  assert.notEqual(
    clasificarFallo('La venta no existe', { tipo: 'CREAR_VENTA' }),
    'descartada'
  );
});

// --- Red y reintentos -------------------------------------------------------

test('un corte de internet se reintenta, no se descarta', () => {
  for (const motivo of ['Failed to fetch', 'NetworkError', 'Load failed', 'timeout', 'fetch failed']) {
    assert.equal(clasificarFallo(motivo), 'red', `"${motivo}" es un fallo de red`);
  }
});

test('un fallo de red no se descarta ni con muchos intentos', () => {
  assert.equal(clasificarFallo('Failed to fetch', { intentos: 99, maxIntentos: 5 }), 'red');
});

test('un error desconocido se reintenta hasta el tope', () => {
  assert.equal(clasificarFallo('Error interno del servidor', { intentos: 1, maxIntentos: 5 }), 'reintentable');
  assert.equal(clasificarFallo('Error interno del servidor', { intentos: 5, maxIntentos: 5 }), 'descartada',
    'agotados los intentos, se rendisce');
});

test('un motivo vacio no rompe nada', () => {
  assert.doesNotThrow(() => clasificarFallo(''));
  assert.doesNotThrow(() => clasificarFallo(null));
  assert.doesNotThrow(() => clasificarFallo(undefined));
  assert.doesNotThrow(() => mensajeDeFallo('', 'reintentable'));
});

// --- Ningun dato clinico se pierde ------------------------------------------

test('ninguna forma de error de stock termina en descarte', () => {
  // Prueba de red de seguridad: se recorren TODAS las variantes que puede
  // devolver el servidor y ninguna puede acabar en 'descartada'.
  const variantes = [
    'Stock insuficiente',
    'stock insuficiente para producto Armazón 12',
    'STOCK INSUFICIENTE',
    '23514',
    'insufficient stock',
    'no hay stock',
    'excede el stock disponible',
    'Stock insuficiente (23514)',
    'ERROR: Stock insuficiente para producto 5'
  ];
  for (const motivo of variantes) {
    assert.notEqual(
      clasificarFallo(motivo, { intentos: 3, maxIntentos: 5 }),
      'descartada',
      `"${motivo}" no debe terminar descartado`
    );
  }
});

test('el mensaje de descarte explica por que no se reintenta', () => {
  const texto = mensajeDeFallo('Item de venta inválido', 'descartada');
  assert.match(texto, /no se reintenta/i);
});
import { reset, product, patient } from './ayudaPruebas.js';

// ---------------------------------------------------------------------------
// PRUEBAS DEL REPOSITORIO LOCAL: PAYLOADS DE VENTA
// ---------------------------------------------------------------------------
// Regresiones del payload que viaja al servidor.
// Un campo mal enviado hace que el servidor rechace la venta (22023) y arrastra
// detras a todo lo que dependa de ella: cobro, estado y comprobante.
// Sale de localRepository.test.js al separar las pruebas por tema. El codigo de
// cada test no se modifico: solo cambio de archivo.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { localDb } from '../localDb.js';
import { guardarVentaLocal } from '../localRepository.js';

// ---------------------------------------------------------------------------
// BUG REAL: "Cada item necesita inventario_id o codigo." (sqlstate 22023)
// ---------------------------------------------------------------------------
// El servidor rechaza la venta cuando un item llega sin id de inventario y sin
// codigo. numericId devolvia NaN para cualquier valor no numerico ("ABC"), y al
// serializar el payload NaN se convierte en null sin avisar: el item pasaba al
// servidor con los dos campos a null y tumbaba la venta. Como el pago y los
// cambios de estado apuntan a esa venta, arrastraba 6 rechazos mas por venta.

test('una venta sin armazon ni accesorio no genera items invalidos', async () => {
  await reset();
  const sale = {
    id: '30000000-0000-4000-8000-000000000001',
    cedula: '17123456789', nombre: 'Paciente Prueba', venta: '50', descuento: '0', abono: '0'
  };
  // Sin codigo_armazon ni accesorio_id: es una venta legitima de solo lentes.
  await guardarVentaLocal({
    patient: patient(),
    consultationId: '20000000-0000-4000-8000-000000000001',
    sale
  });

  const ops = await localDb.outbox.toArray();
  const crear = ops.find(o => o.type === 'CREAR_VENTA');
  assert.ok(crear, 'debe encolarse la operacion de venta');

  const items = crear.payload.p_payload.items;
  assert.ok(Array.isArray(items), 'items debe ser un array');
  for (const item of items) {
    // Esta es exactamente la condicion que el servidor valida.
    const tieneId = item.inventario_id !== null && item.inventario_id !== undefined;
    const tieneCodigo = typeof item.codigo === 'string' && item.codigo.trim() !== '';
    assert.ok(tieneId || tieneCodigo,
      `item sin inventario_id ni codigo: ${JSON.stringify(item)}`);
    assert.equal(typeof item.cantidad, 'number');
    assert.ok(item.cantidad > 0);
  }
});

test('un accesorio con id no numerico no produce NaN en el payload', async () => {
  await reset();
  const sale = {
    id: '30000000-0000-4000-8000-000000000002',
    cedula: '17123456789', nombre: 'Paciente Prueba', venta: '50',
    descuento: '0', abono: '0',
    // Valor corrupto: antes numericId devolvia NaN y el JSON lo mandaba como null.
    accesorio_id: 'ABC'
  };
  await guardarVentaLocal({
    patient: patient(),
    consultationId: '20000000-0000-4000-8000-000000000002',
    sale
  });

  const ops = await localDb.outbox.toArray();
  const crear = ops.find(o => o.type === 'CREAR_VENTA');
  assert.ok(crear, 'debe encolarse la operacion de venta');

  const serializado = JSON.stringify(crear.payload.p_payload.items);
  assert.doesNotMatch(serializado, /null,\s*"cantidad"/,
    'ningun item puede llevar inventario_id null con cantidad: el servidor lo rechaza');

  for (const item of crear.payload.p_payload.items) {
    assert.notEqual(item.inventario_id, null, 'un id no numerico debe omitirse, no enviarse como null');
  }
});
// ---------------------------------------------------------------------------
// BUG CRITICO: ReferenceError al guardar una venta con abono
// ---------------------------------------------------------------------------
// Se consultaba la tabla de pagos por `paymentKey` SEIS LINEAS antes de
// declararla con const. En JavaScript una const no existe hasta su declaracion,
// asi que la app lanzaba "Cannot access 'paymentKey' before initialization"
// y era IMPOSIBLE guardar cualquier venta con abono inicial. El pago tampoco
// llegaba a registrarse nunca.

test('una venta con abono registra el pago y su operacion', async () => {
  await reset();
  await localDb.inventory.put({ ...product(5), id: 1 });

  const resultado = await guardarVentaLocal({
    patient: patient(),
    consultationId: '20000000-0000-4000-8000-000000000009',
    sale: {
      id: '30000000-0000-4000-8000-000000000009',
      cedula: '1712345678', nombre: 'Paciente Abono', venta: '100',
      descuento: '0', abono: '40', estado: 'En laboratorio'
    },
    // El abono inicial es lo que disparaba el ReferenceError.
    initialPayment: { monto: 40, metodo: 'Efectivo', idempotencyKey: 'aaaabbbb-0000-4000-8000-000000000001' }
  });

  assert.ok(resultado, 'guardarVentaLocal debe devolver un resultado');

  const pagos = await localDb.payments.toArray();
  assert.equal(pagos.length, 1, 'el pago debe quedar registrado en la base local');
  assert.equal(Number(pagos[0].monto), 40);
  assert.equal(pagos[0].metodo, 'Efectivo');

  const ops = await localDb.outbox.toArray();
  const venta = ops.find(o => o.type === 'CREAR_VENTA');
  const cobro = ops.find(o => o.type === 'REGISTRAR_PAGO');
  assert.ok(venta, 'debe encolarse la venta');
  assert.ok(cobro, 'debe encolarse el cobro');
  assert.equal(Number(cobro.payload.p_monto), 40);

  // El cobro va DESPUES de la venta en la cola: si se invirtiera, el servidor
  // recibiria el pago antes de que exista el pedido.
  assert.ok(
    Date.parse(cobro.createdAt) >= Date.parse(venta.createdAt),
    'el cobro debe procesarse despues de la venta'
  );
});

test('reintentar la misma venta con el mismo idempotencyKey no duplica el cobro', async () => {
  await reset();
  await localDb.inventory.put({ ...product(5), id: 1 });
  const clave = 'aaaabbbb-0000-4000-8000-000000000002';
  const venta = {
    id: '30000000-0000-4000-8000-000000000010',
    cedula: '1712345678', nombre: 'Paciente Reintento', venta: '100',
    descuento: '0', abono: '40', estado: 'En laboratorio'
  };

  await guardarVentaLocal({
    patient: patient(), consultationId: '20000000-0000-4000-8000-000000000010',
    sale: venta, initialPayment: { monto: 40, metodo: 'Efectivo', idempotencyKey: clave }
  });
  await guardarVentaLocal({
    patient: patient(), consultationId: '20000000-0000-4000-8000-000000000010',
    sale: venta, initialPayment: { monto: 40, metodo: 'Efectivo', idempotencyKey: clave }
  });

  const pagos = await localDb.payments.toArray();
  assert.equal(pagos.length, 1, 'la misma clave de idempotencia no debe cobrar dos veces');
});
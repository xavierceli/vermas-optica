import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { localDb } from './localDb.js';
import {
  guardarConsultaLocal,
  guardarVentaLocal,
  registrarPagoLocal,
  cacheServerCatalog,
  obtenerContadorEscaneosInventario, archivarConsultaLocal
} from './localRepository.js';
import { calcularTotal } from './reglas.js';
import { guardarAdjuntoLocal, leerAdjuntoLocal, obtenerAdjuntosDeRef, contarAdjuntosPendientes, anularVentaLocal, cacheServerHistorial, obtenerSnapshotLocal, anularVentaConReembolso, registrarReembolsoLocal, enColaEscritura } from './localRepository.js';

const reset = async () => {
  await localDb.delete();
  await localDb.open();
};

const product = (stock = 2) => ({
  id: 1, categoria: 'Accesorio', nombre_accesorio: 'Estuche',
  codigo: 'ACC-1', precio: '10', stock, syncStatus: 'synced'
});

const patient = () => ({
  id: '10000000-0000-4000-8000-000000000001',
  cedula: '17123456789',
  nombre: 'Paciente Prueba'
});

const sale = (accessory = '1') => ({
  id: '20000000-0000-4000-8000-000000000001',
  pedido_id: '20000000-0000-4000-8000-000000000001',
  patient_id: patient().id,
  consultation_id: '30000000-0000-4000-8000-000000000001',
  fecha: '2026-09-24', venta: '100', descuento: '0', abono: '0',
  estado: 'En laboratorio', accesorio_id: accessory
});

test('guardar consulta crea dominio y outbox en la misma transacción', async () => {
  await reset();
  const consultationId = '30000000-0000-4000-8000-000000000001';
  await guardarConsultaLocal({
    patient: patient(),
    consultation: { id: consultationId, fecha: '2026-09-24', esfera_od: '-1.00' }
  });
  assert.equal(await localDb.consultations.count(), 1);
  assert.equal(await localDb.outbox.where('type').equals('GUARDAR_CONSULTA').count(), 1);
});

test('venta sin stock suficiente hace rollback de venta, items y outbox', async () => {
  await reset();
  await localDb.inventory.put(product(0));
  await assert.rejects(() => guardarVentaLocal({
    patient: patient(),
    consultationId: sale().consultation_id,
    sale: sale()
  }), /Stock insuficiente/);
  assert.equal(await localDb.sales.count(), 0);
  assert.equal(await localDb.saleItems.count(), 0);
  assert.equal(await localDb.outbox.count(), 0);
  assert.equal((await localDb.inventory.get(1)).stock, 0);
});

test('editar venta devuelve stock del producto eliminado', async () => {
  await reset();
  await localDb.inventory.put(product(1));
  await guardarVentaLocal({
    patient: patient(),
    consultationId: sale().consultation_id,
    sale: sale()
  });
  assert.equal((await localDb.inventory.get(1)).stock, 0);

  await guardarVentaLocal({
    patient: patient(),
    consultationId: sale().consultation_id,
    sale: sale(null)
  });
  assert.equal((await localDb.inventory.get(1)).stock, 1);
  assert.equal(await localDb.saleItems.where('saleId').equals(sale().id).count(), 0);
  assert.equal(await localDb.outbox.where('type').equals('EDITAR_VENTA').count(), 1);
});

test('misma clave de pago no crea dos filas ni dos operaciones', async () => {
  await reset();
  await localDb.inventory.put(product(2));
  await guardarVentaLocal({
    patient: patient(),
    consultationId: sale().consultation_id,
    sale: sale()
  });
  const key = '40000000-0000-4000-8000-000000000001';
  await registrarPagoLocal({ saleId: sale().id, amount: 10, idempotencyKey: key });
  await registrarPagoLocal({ saleId: sale().id, amount: 10, idempotencyKey: key });
  assert.equal(await localDb.payments.count(), 1);
  assert.equal(await localDb.outbox.where('type').equals('REGISTRAR_PAGO').count(), 1);
  assert.equal(Number((await localDb.sales.get(sale().id)).abono), 10);
});
// --- Regresiones de campo (puntos 3, 4 y 5) -------------------------------

test('cachear el catalogo no hace un escaneo de inventario por venta', async () => {
  await reset();
  await localDb.inventory.put({ ...product(50), codigo: 'ARM-9', categoria: 'Armazon' });
  // 300 ventas remotas referencian el armazon SOLO por codigo (sin id).
  await localDb.sales.bulkPut(Array.from({ length: 300 }, (_, i) => ({
    id: `venta-lote-${i}`,
    consultationId: `consulta-lote-${i}`,
    patientId: patient().id,
    fecha: '2026-01-01',
    venta: '10', descuento: '0', abono: '0',
    accesorio_id: '', codigo_armazon: 'ARM-9',
    syncStatus: 'synced'
  })));

  const antes = obtenerContadorEscaneosInventario();
  await cacheServerCatalog({ inventory: [], prices: [] });
  const escaneos = obtenerContadorEscaneosInventario() - antes;

  // Con el indice en memoria el pull es O(1) en escaneos, no O(ventas).
  assert.equal(escaneos, 0, 'el pull no debe recorrer el inventario repetidamente');
  assert.equal(await localDb.saleItems.count(), 300);
});
test('el pull del servidor actualiza el stock local tras descontar una venta', async () => {
  await reset();
  await localDb.inventory.put(product(5));
  await guardarVentaLocal({
    patient: patient(),
    consultationId: sale().consultation_id,
    sale: sale()
  });
  assert.equal((await localDb.inventory.get(1)).stock, 4);

  // El servidor responde con el stock ya descontado: el cacheo debe reflejarlo.
  await cacheServerCatalog({
    inventory: [{ id: 1, categoria: 'Accesorio', codigo: 'ACC-1', precio: '10', stock: 4, syncStatus: 'synced' }],
    prices: []
  });

  const local = await localDb.inventory.get(1);
  assert.equal(local.stock, 4);
  assert.equal(local.syncStatus, 'synced');
});

test('editar venta resuelve siempre y devuelve el stock del armazon cambiado', async () => {
  await reset();
  await localDb.inventory.bulkPut([
    { id: 1, categoria: 'Accesorio', codigo: 'ACC-1', precio: '10', stock: 3, syncStatus: 'synced' },
    { id: 2, categoria: 'Armazon', codigo: 'ARM-9', precio: '50', stock: 1, syncStatus: 'synced' }
  ]);
  await guardarVentaLocal({
    patient: patient(),
    consultationId: sale().consultation_id,
    sale: { ...sale(), codigo_armazon: 'ARM-9' }
  });
  assert.equal((await localDb.inventory.get(1)).stock, 2);
  assert.equal((await localDb.inventory.get(2)).stock, 0);

  // Cambia de armazon: el nuevo descuenta y el anterior se devuelve.
  await guardarVentaLocal({
    patient: patient(),
    consultationId: sale().consultation_id,
    sale: { ...sale(), codigo_armazon: '' }
  });
  assert.equal((await localDb.inventory.get(2)).stock, 1);
  assert.equal((await localDb.sales.get(sale().id)).syncStatus, 'pending');
  assert.equal(await localDb.outbox.where('type').equals('EDITAR_VENTA').count(), 1);
});
test('un pago igual al saldo del servidor no se rechaza por error de redondeo', async () => {
  await reset();
  await localDb.inventory.put(product(1));
  // 19.99 con 50% de descuento => el servidor redondea a 10.00, no a 9.99.
  const ventaDescuento = {
    ...sale(),
    venta: '19.99',
    descuento: '50',
    abono: '0'
  };
  await guardarVentaLocal({
    patient: patient(),
    consultationId: sale().consultation_id,
    sale: ventaDescuento
  });

  // El saldo real segun la formula del servidor es 10.00.
  assert.equal(calcularTotal('19.99', '50'), 10);

  // Cobrar exactamente ese saldo debe aceptarse localmente.
  const resultado = await registrarPagoLocal({
    saleId: ventaDescuento.id,
    amount: 10,
    idempotencyKey: '50000000-0000-4000-8000-000000000001'
  });
  assert.equal(resultado.balance, 0, 'la venta queda pagada por completo');
  assert.equal(Number((await localDb.sales.get(ventaDescuento.id)).abono), 10);
});
test('un comprobante capturado sin conexion NO se pierde', async () => {
  await reset();
  const binario = new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])], { type: 'image/jpeg' });
  const refId = '90000000-0000-4000-8000-000000000001';

  const adjunto = await guardarAdjuntoLocal({
    blob: binario,
    nombre: 'comprobante_123.jpg',
    mime: 'image/jpeg',
    bucket: 'comprobantes_pagos',
    refType: 'pago',
    refId
  });

  // El binario queda recoverable en el dispositivo.
  const blobRecuperado = await leerAdjuntoLocal(adjunto.adjuntoId);
  assert.ok(blobRecuperado instanceof Blob, 'el blob debe quedar guardado localmente');
  assert.equal(blobRecuperado.size, binario.size);
  assert.equal(blobRecuperado.type, 'image/jpeg');

  // Queda encolado para subir al recuperar conexion.
  const pendientes = await localDb.outbox.where('type').equals('SUBIR_ADJUNTO').count();
  assert.equal(pendientes, 1);
  assert.equal(await contarAdjuntosPendientes(), 1);

  // Y es localizable por la venta a la que pertenece.
  const porRef = await obtenerAdjuntosDeRef(refId);
  assert.equal(porRef.length, 1);
  assert.equal(porRef[0].bucket, 'comprobantes_pagos');
});

test('la ruta del adjunto es unica y segura para usar en el servidor', async () => {
  await reset();
  const binario = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
  const a = await guardarAdjuntoLocal({ blob: binario, nombre: 'captura con espacios (1).jpg', bucket: 'comprobantes_pagos', refType: 'pago', refId: 'r1' });
  const b = await guardarAdjuntoLocal({ blob: binario, nombre: 'captura con espacios (1).jpg', bucket: 'comprobantes_pagos', refType: 'pago', refId: 'r1' });

  assert.notEqual(a.ruta, b.ruta, 'dos adjuntos nunca comparten ruta');
  assert.match(a.ruta, /^[A-Za-z0-9._-]+$/, 'la ruta no debe llevar espacios ni caracteres raros');
  assert.ok(a.ruta.endsWith('.jpg'));
});
test('REPRO: anular una venta que llego del servidor', async () => {
  await reset();
  await localDb.inventory.put({ id: 1, categoria: 'Accesorio', codigo: 'ACC-1', precio: '10', stock: 5, syncStatus: 'synced' });

  // Así se ve una venta en el servidor: llega por cacheServerHistorial.
  await cacheServerHistorial([{
    id: 'consulta-remota-1',
    paciente_id: '30000000-0000-4000-8000-000000000001',
    cedula: '17123456789',
    nombre: 'Paciente Remoto',
    fecha: '2026-09-01',
    fecha_venta: '2026-09-01',
    pedido_id: '40000000-0000-4000-8000-000000000001',
    venta: '100', descuento: '0', abono: '0', estado: 'En laboratorio',
    codigo_armazon: '', accesorio_id: '1'
  }]);

  // Y el catalogo se hidrata igual que hace el motor de sync.
  await cacheServerCatalog({
    inventory: [{ id: 1, categoria: 'Accesorio', codigo: 'ACC-1', precio: '10', stock: 5, syncStatus: 'synced' }],
    prices: []
  });

  const historial = await obtenerSnapshotLocal();
  const fila = historial.historial.find(r => r.pedido_id);
  assert.ok(fila, 'la venta debe aparecer en el historial');

  await anularVentaLocal(fila.pedido_id);
  assert.equal((await localDb.sales.get(fila.pedido_id)).estado, 'Anulado');
  assert.equal((await localDb.inventory.get(1)).stock, 6, 'el stock debe devolverse');
});

test('REPRO: un producto que solo existe en el servidor no rompe el catalogo', async () => {
  await reset();
  // Venta remota que referencia un producto que el dispositivo aun no tiene.
  await cacheServerHistorial([{
    id: 'consulta-remota-2',
    paciente_id: '30000000-0000-4000-8000-000000000002',
    cedula: '17123456790',
    nombre: 'Otro Paciente',
    fecha: '2026-09-02',
    pedido_id: '40000000-0000-4000-8000-000000000002',
    venta: '50', descuento: '0', abono: '0', estado: 'En laboratorio',
    codigo_armazon: 'ARM-NUEVO', accesorio_id: ''
  }]);

  // El servidor SI tiene el producto, pero es nuevo para este dispositivo.
  await cacheServerCatalog({
    inventory: [{ id: 7, categoria: 'Armazon', codigo: 'ARM-NUEVO', precio: '50', stock: 3, syncStatus: 'synced' }],
    prices: []
  });

  assert.ok(await localDb.inventory.get(7), 'el producto nuevo debe quedar en el inventario local');
  assert.ok(await localDb.saleItems.where('saleId').equals('40000000-0000-4000-8000-000000000002').count() > 0, 'los items de la venta deben hidratarse');
});
test('anular NO se bloquea si falta un producto en el dispositivo', async () => {
  await reset();
  await localDb.inventory.put({ id: 1, categoria: 'Accesorio', codigo: 'ACC-1', precio: '10', stock: 3, syncStatus: 'synced' });
  await guardarVentaLocal({ patient: patient(), consultationId: sale().consultation_id, sale: sale() });
  assert.equal((await localDb.inventory.get(1)).stock, 2);

  // El producto desaparece del dispositivo (borrado en otro equipo, por ejemplo).
  await localDb.inventory.delete(1);

  const resultado = await anularVentaLocal(sale().id);
  assert.equal(resultado.estado, 'Anulado', 'la venta debe anularse igual');
  assert.equal((await localDb.sales.get(sale().id)).estado, 'Anulado');
  assert.deepEqual(resultado.productosAusentes, [1], 'debe reportar el producto ausente');
  assert.ok(await localDb.outbox.where('type').equals('ANULAR_VENTA').count() > 0, 'la anulacion debe encolarse');
});

test('anular una venta ya anulada vuelve a encolar la operacion', async () => {
  await reset();
  await localDb.inventory.put(product(3));
  await guardarVentaLocal({ patient: patient(), consultationId: sale().consultation_id, sale: sale() });
  await anularVentaLocal(sale().id);
  await localDb.outbox.clear();

  // Segundo intento: antes no hacia nada y el servidor nunca se enteraba.
  const resultado = await anularVentaLocal(sale().id);
  assert.equal(resultado.estado, 'Anulado');
  assert.equal(await localDb.outbox.where('type').equals('ANULAR_VENTA').count(), 1,
    'debe re-encolar la anulacion para que el servidor la aplique');
});

test('el mensaje de abono indica cuanto hay que reembolsar', async () => {
  await reset();
  await localDb.inventory.put(product(5));
  await guardarVentaLocal({ patient: patient(), consultationId: sale().consultation_id, sale: sale() });
  await registrarPagoLocal({ saleId: sale().id, amount: 25, idempotencyKey: '70000000-0000-4000-8000-000000000001' });

  await assert.rejects(
    () => anularVentaLocal(sale().id),
    /25\.00/, 
    'el error debe decir cuanto abonado tiene la venta'
  );
  assert.equal((await localDb.sales.get(sale().id)).estado, 'En laboratorio', 'no debe anularse con pagos');
});
test('anular con abono devuelve el dinero y despues anula', async () => {
  await reset();
  await localDb.inventory.put(product(5));
  await guardarVentaLocal({ patient: patient(), consultationId: sale().consultation_id, sale: sale() });
  await registrarPagoLocal({ saleId: sale().id, amount: 30, idempotencyKey: '80000000-0000-4000-8000-000000000001' });
  assert.equal(Number((await localDb.sales.get(sale().id)).abono), 30);

  await anularVentaConReembolso({ saleId: sale().id, method: 'Efectivo' });

  const venta = await localDb.sales.get(sale().id);
  assert.equal(venta.estado, 'Anulado', 'la venta queda anulada');
  assert.equal(Number(venta.abono), 0, 'el abono queda en cero');

  const pagos = await localDb.payments.where('saleId').equals(sale().id).toArray();
  const reembolso = pagos.find(p => p.tipo === 'REEMBOLSO');
  assert.ok(reembolso, 'debe quedar registrado el reembolso');
  assert.equal(reembolso.monto, 30);
  assert.equal((await localDb.inventory.get(1)).stock, 5, 'el stock vuelve al inventario');
});

test('el reembolso no puede superar lo abonado', async () => {
  await reset();
  await localDb.inventory.put(product(5));
  await guardarVentaLocal({ patient: patient(), consultationId: sale().consultation_id, sale: sale() });
  await registrarPagoLocal({ saleId: sale().id, amount: 10, idempotencyKey: '80000000-0000-4000-8000-000000000002' });

  await assert.rejects(
    () => registrarReembolsoLocal({ saleId: sale().id, amount: 25 }),
    /supera lo abonado/i
  );
  assert.equal(Number((await localDb.sales.get(sale().id)).abono), 10, 'el abono no se toca');
  assert.equal((await localDb.sales.get(sale().id)).estado, 'En laboratorio', 'la venta sigue viva');
});
test('la misma clave de reembolso no mueve el dinero dos veces', async () => {
  await reset();
  await localDb.inventory.put(product(5));
  await guardarVentaLocal({ patient: patient(), consultationId: sale().consultation_id, sale: sale() });
  await registrarPagoLocal({ saleId: sale().id, amount: 20, idempotencyKey: '80000000-0000-4000-8000-000000000003' });

  const clave = '90000000-0000-4000-8000-000000000001';
  const uno = await registrarReembolsoLocal({ saleId: sale().id, amount: 20, idempotencyKey: clave });
  const dos = await registrarReembolsoLocal({ saleId: sale().id, amount: 20, idempotencyKey: clave });

  assert.equal(uno.alreadyExists, undefined);
  assert.equal(dos.alreadyExists, true, 'el reintento se reconoce');
  assert.equal(await localDb.payments.where('saleId').equals(sale().id).count(), 2, 'un cobro y un reembolso');
  assert.equal(Number((await localDb.sales.get(sale().id)).abono), 0, 'el dinero solo se devolvio una vez');
});

test('no se puede reembolsar una venta sin abonos', async () => {
  await reset();
  await localDb.inventory.put(product(5));
  await guardarVentaLocal({ patient: patient(), consultationId: sale().consultation_id, sale: sale() });
  await assert.rejects(
    () => registrarReembolsoLocal({ saleId: sale().id, amount: 5 }),
    /no tiene saldo abonado/i
  );
});
test('una tarea colgada NO bloquea las escrituras siguientes', async () => {
  await reset();
  // Se simula una tarea que nunca resuelve, como una llamada de red colgada.
  let liberar;
  const atascada = new Promise(resolve => { liberar = resolve; });
  enColaEscritura(() => atascada, 'alta', 'atascada');

  // La escritura del usuario debe poder pasar en cuanto se libere el hueco,
  // aunque la tarea atascada nunca termine.
  const guardado = guardarConsultaLocal({
    patient: patient(),
    consultation: { id: '30000000-0000-4000-8000-000000000009', fecha: '2026-09-25' }
  });
  liberar();
  await atascada;
  await guardado;

  assert.equal(await localDb.consultations.count(), 1, 'la escritura del usuario no se quedo bloqueada');
});

test('el vigilante libera el hueco si la tarea no termina', async () => {
  await reset();
  // Tarea que nunca resuelve, como una llamada de red colgada.
  enColaEscritura(() => new Promise(() => {}), 'alta', 'colgada');
  // La escritura del usuario debe salir igual gracias al vigilante.
  await guardarConsultaLocal({
    patient: patient(),
    consultation: { id: '30000000-0000-4000-8000-000000000010', fecha: '2026-09-25' }
  });
  assert.equal(await localDb.consultations.count(), 1, 'la escritura no quedo bloqueada para siempre');
});
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
// ---------------------------------------------------------------------------
// ARCHIVAR UNA CONSULTA (boton "Eliminar" del historial)
// ---------------------------------------------------------------------------

test('archivar una consulta la marca como archivada', async () => {
  await reset();
  const id = '60000000-0000-4000-8000-000000000001';
  await guardarConsultaLocal({
    patient: patient(),
    consultation: { id, fecha: '2026-01-15' }
  });

  const resultado = await archivarConsultaLocal(id);
  assert.equal(resultado.yaArchivada, false);

  const fila = await localDb.consultations.get(id);
  assert.ok(fila.archivedAt, 'debe quedar marcada como archivada');
});

test('archivar dos veces NO da error (debe ser idempotente)', async () => {
  // Pulsar "Eliminar" dos veces no puede mostrar un error rojo: para el usuario
  // el objetivo (que la consulta desaparezca) ya se cumplio.
  await reset();
  const id = '60000000-0000-4000-8000-000000000002';
  await guardarConsultaLocal({
    patient: patient(),
    consultation: { id, fecha: '2026-01-15' }
  });

  const primera = await archivarConsultaLocal(id);
  const segunda = await archivarConsultaLocal(id);

  assert.equal(primera.yaArchivada, false, 'la primera vez si archiva');
  assert.equal(segunda.yaArchivada, true, 'la segunda vez avisa que ya estaba');
  assert.match(segunda.motivo, /ya estaba archivada/i);
});

test('archivar una consulta inexistente no lanza error', async () => {
  await reset();
  const resultado = await archivarConsultaLocal('60000000-0000-4000-8000-000000000999');
  assert.equal(resultado.yaArchivada, true);
  assert.match(resultado.motivo, /no existe/i);
});

test('archivar una consulta que nunca se sincronizo no encola operacion', async () => {
  // Si nunca llego al servidor, encolar el archivo haria que el servidor lo
  // rechazara para siempre ("La consulta X no existe"), dejando la barra roja.
  await reset();
  const id = '60000000-0000-4000-8000-000000000003';
  await guardarConsultaLocal({
    patient: patient(),
    consultation: { id, fecha: '2026-01-15' }
  });

  await archivarConsultaLocal(id);

  const ops = await localDb.outbox.toArray();
  const archivar = ops.filter(o => o.type === 'ARCHIVAR_CONSULTA');
  assert.equal(archivar.length, 0,
    'una consulta local que nunca se subio no debe generar una operacion de archivo');
});
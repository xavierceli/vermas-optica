import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'fake-indexeddb/auto';
import { localDb } from './localDb.js';
import { armarCopiaPaciente, contarComprobantesCopia } from './eliminacionPaciente.js';

// PROBLEMA QUE RESUELVE:
// Al borrar un paciente se borran tambien sus comprobantes de pago (es lo
// correcto para la privacidad del paciente). Despues no hay forma de
// recuperarlos. La copia que se descarga antes de borrar guardaba los montos y
// las fechas, pero NO la foto del comprobante: es decir, sin la evidencia de
// que ese dinero entro.
//
// Ahora la copia incluye los comprobantes en base64 dentro del mismo .json, y la
// pantalla avisa cuantos van incluidos antes de confirmar.

// Un JPEG de verdad en miniatura: 1x1 pixel. Sirve para comprobar que el base64
// vuelve a ser exactamente el mismo archivo.
const JPEG_MINIMO = new Uint8Array([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9
]);
const blobFoto = () => new Blob([JPEG_MINIMO], { type: 'image/jpeg' });

const limpiar = async () => {
  for (const t of ['patients','consultations','sales','saleItems','payments',
    'inventoryMovements','outbox','attachments','cache']) {
    await localDb[t].clear();
  }
};

/** Paciente con una venta, un cobro y dos comprobantes. */
const sembrarConComprobantes = async () => {
  await localDb.patients.put({ id: 'p1', cedula: '1712345678', nombre: 'JUAN' });
  await localDb.consultations.put({ id: 'c1', patientId: 'p1', cedula: '1712345678' });
  await localDb.sales.put({ id: 's1', patientId: 'p1', cedula: '1712345678', venta: '150' });
  await localDb.payments.put({ id: 'pay1', saleId: 's1', monto: 150, metodo: 'Transferencia' });
  await localDb.attachments.put({
    id: 'a1', ruta: 'comp1.jpg', nombre: 'comp1.jpg', mime: 'image/jpeg',
    bucket: 'comprobantes_pagos', refType: 'pago', refId: 'pay1', blob: blobFoto()
  });
  await localDb.attachments.put({
    id: 'a2', ruta: 'comp2.jpg', nombre: 'comp2.jpg', mime: 'image/jpeg',
    bucket: 'comprobantes_pagos', refType: 'pago', refId: 's1', blob: blobFoto()
  });
};

/** Paciente igual, pero sin comprobantes. */
const sembrarSinComprobantes = async () => {
  await localDb.patients.put({ id: 'p1', cedula: '1712345678', nombre: 'JUAN' });
  await localDb.sales.put({ id: 's1', patientId: 'p1', cedula: '1712345678', venta: '150' });
};

const base64ABlob = (base64, mime) => {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
};

// --- La copia incluye los comprobantes ---------------------------------------

test('la copia incluye los comprobantes del paciente', async () => {
  await limpiar(); await sembrarConComprobantes();
  const copia = await armarCopiaPaciente('1712345678');
  assert.equal(copia.comprobantes.length, 2, 'debe llevar los dos comprobantes');
});

test('cada comprobante conserva su archivo byte a byte', async () => {
  await limpiar(); await sembrarConComprobantes();
  const copia = await armarCopiaPaciente('1712345678');
  // Si el base64 estuviera truncado o alterado, al reconstruirlo daria otro
  // archivo: y una foto de comprobante alterada no sirve como evidencia.
  for (const comprobante of copia.comprobantes) {
    const recuperado = base64ABlob(comprobante.base64, comprobante.mime);
    const bytes = new Uint8Array(await recuperado.arrayBuffer());
    assert.deepEqual([...bytes], [...JPEG_MINIMO], 'el archivo debe volver igual');
  }
});

test('los comprobantes dicen a que venta y cobro pertenecen', async () => {
  await limpiar(); await sembrarConComprobantes();
  const copia = await armarCopiaPaciente('1712345678');
  const refIds = copia.comprobantes.map(c => c.refId).sort();
  assert.deepEqual(refIds, ['pay1', 's1'], 'sin esto no se sabe a que pago pertenece cada foto');
});

test('la copia sigue llevando los datos que ya llevaba', async () => {
  await limpiar(); await sembrarConComprobantes();
  const copia = await armarCopiaPaciente('1712345678');
  assert.equal(copia.pacientes.length, 1);
  assert.equal(copia.ventas.length, 1);
  assert.equal(copia.cobros.length, 1, 'los montos siguen ahi: no se perdio nada');
});

test('un paciente sin comprobantes da una copia valida y vacia', async () => {
  await limpiar(); await sembrarSinComprobantes();
  const copia = await armarCopiaPaciente('1712345678');
  assert.deepEqual(copia.comprobantes, [], 'no falla, simplemente no hay');
  assert.equal(copia.pacientes.length, 1);
});

test('NO se incluyen comprobantes de OTRO paciente', async () => {
  await limpiar();
  await sembrarConComprobantes();
  await localDb.patients.put({ id: 'p2', cedula: '0911111111', nombre: 'MARIA' });
  await localDb.sales.put({ id: 's2', patientId: 'p2', cedula: '0911111111', venta: '80' });
  await localDb.attachments.put({
    id: 'a3', ruta: 'comp3.jpg', nombre: 'comp3.jpg', mime: 'image/jpeg',
    bucket: 'comprobantes_pagos', refType: 'pago', refId: 's2', blob: blobFoto()
  });

  const copia = await armarCopiaPaciente('1712345678');
  assert.equal(copia.comprobantes.length, 2, 'los de Maria no se cuelan en la copia de Juan');
  assert.ok(!copia.comprobantes.some(c => c.refId === 's2'));
});

// --- El conteo para avisar antes de borrar -----------------------------------

test('el conteo dice cuantos comprobantes se van a copiar', async () => {
  await limpiar(); await sembrarConComprobantes();
  assert.equal(await contarComprobantesCopia('1712345678'), 2);
});

test('el conteo da 0 cuando no hay comprobantes', async () => {
  await limpiar(); await sembrarSinComprobantes();
  assert.equal(await contarComprobantesCopia('1712345678'), 0);
});

test('el conteo y la copia dicen lo MISMO', async () => {
  // Si se desviaran, el aviso mentiria. Es la comprobacion mas importante.
  await limpiar(); await sembrarConComprobantes();
  const copia = await armarCopiaPaciente('1712345678');
  const contados = await contarComprobantesCopia('1712345678');
  assert.equal(contados, copia.comprobantes.length,
    'lo que se avisa tiene que ser lo que de verdad se copia');
});

test('un comprobante sin archivo local no se promete en el aviso', async () => {
  await limpiar(); await sembrarConComprobantes();
  // El adjunto quedo solo con la ruta en el servidor: aqui no hay nada que copiar.
  await localDb.attachments.put({
    id: 'a4', ruta: 'comp4.jpg', nombre: 'comp4.jpg', mime: 'image/jpeg',
    bucket: 'comprobantes_pagos', refType: 'pago', refId: 's1', blob: null
  });
  const contados = await contarComprobantesCopia('1712345678');
  const copia = await armarCopiaPaciente('1712345678');
  assert.equal(contados, 2, 'no se cuenta lo que no se puede copiar');
  assert.equal(copia.comprobantes.length, 2);
});

// --- La copia se serializa bien ----------------------------------------------

test('la copia es un JSON que se puede abrir y tiene los comprobantes dentro', async () => {
  await limpiar(); await sembrarConComprobantes();
  const copia = await armarCopiaPaciente('1712345678');
  const texto = JSON.stringify(copia, null, 2);
  const releido = JSON.parse(texto);
  assert.equal(releido.comprobantes.length, 2);
  assert.ok(releido.comprobantes[0].base64.length > 0, 'el archivo va dentro del JSON');
  assert.match(releido.aviso, /base64/i, 'el aviso explica donde estan los comprobantes');
});

test('un paciente inexistente da una copia vacia, no un error', async () => {
  await limpiar();
  const copia = await armarCopiaPaciente('0000000000');
  assert.deepEqual(copia.pacientes, []);
  assert.deepEqual(copia.comprobantes, []);
});

// --- La pantalla avisa antes de borrar ---------------------------------------

test('la ventana de confirmacion dice cuantos comprobantes se copian', () => {
  // node --test no renderiza React, asi que se comprueba el fuente: si alguien
  // quita el aviso, el usuario volveria a creer que la copia lo tiene todo.
  const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'BotonEliminarPaciente.jsx'), 'utf8');
  assert.match(fuente, /contarComprobantesCopia/, 'debe consultar cuantos comprobantes habra');
  assert.match(fuente, /comprobante de pago/, 'debe mostrarlos en la ventana');
  assert.match(fuente, /descargarCopia/, 'el aviso va junto a la casilla de la copia');
});

test('si no hay comprobantes, se avisa igualmente', () => {
  // El caso peligroso: creer que la copia lo guarda todo cuando no es cierto.
  const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'BotonEliminarPaciente.jsx'), 'utf8');
  assert.match(fuente, /No hay comprobantes guardados en este equipo/i,
    'debe advertir cuando la copia no lleva comprobantes');
});
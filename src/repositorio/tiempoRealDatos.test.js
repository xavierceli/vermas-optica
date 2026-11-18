import { reset as resetDb } from './ayudaPruebas.js';

// ---------------------------------------------------------------------------
// APLICAR UN CAMBIO REMOTO (evento de Realtime) A LA BASE LOCAL
// ---------------------------------------------------------------------------
// Realtime no puede descargar 20.000 consultas por cada cambio: aplica UNA
// fila. Estas pruebas fijan las reglas que hacen que eso sea seguro:
//   - nunca pisa trabajo local sin sincronizar,
//   - nunca retrocede a una version anterior,
//   - respeta archivados y no revive filas archivadas.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { localDb, setMeta } from '../localDb.js';
import { aplicarFilaHistorialImpl } from './lectura.js';

const CONSULTA_ID = '80000000-0000-4000-8000-000000000001';
const PACIENTE_ID = '80000000-0000-4000-8000-000000000002';
const PEDIDO_ID = '80000000-0000-4000-8000-000000000003';
const CEDULA = '1799999999';

const filaRemota = (extra = {}) => ({
  id: CONSULTA_ID,
  paciente_id: PACIENTE_ID,
  cedula: CEDULA,
  nombre: 'Paciente Remoto',
  telefono: '0991234567',
  fecha: '2026-04-01 10:00',
  k1_d_od: '42.5',
  pedido_id: null,
  sync_version_consulta: 3,
  ...extra
});

test('aplica una fila nueva: paciente, consulta y cache', async () => {
  await resetDb();

  const resultado = await aplicarFilaHistorialImpl(filaRemota());
  assert.equal(resultado.aplicada, true);

  const consulta = await localDb.consultations.get(CONSULTA_ID);
  assert.ok(consulta, 'la consulta debe quedar en local');
  assert.equal(consulta.syncVersion, 3);
  assert.equal(consulta.syncStatus, 'synced');
  assert.equal(consulta.k1_d_od, '42.5');

  const paciente = await localDb.patients.get(PACIENTE_ID);
  assert.ok(paciente, 'el paciente debe quedar en local');
  assert.equal(paciente.nombre, 'Paciente Remoto');

  assert.ok(await localDb.cache.get(`remote:${CONSULTA_ID}`),
    'tambien debe quedar la copia remota para el historial');
});

test('NO pisa una consulta local pendiente de subir', async () => {
  await resetDb();
  await localDb.patients.put({
    id: PACIENTE_ID, cedula: CEDULA, nombre: 'Local', syncStatus: 'pending'
  });
  await localDb.consultations.put({
    id: CONSULTA_ID, patientId: PACIENTE_ID, fecha: '2026-04-01',
    k1_d_od: '99', syncStatus: 'pending'
  });

  const resultado = await aplicarFilaHistorialImpl(filaRemota());
  assert.equal(resultado.aplicada, false, 'no habia nada que aplicar');

  const consulta = await localDb.consultations.get(CONSULTA_ID);
  assert.equal(consulta.k1_d_od, '99', 'el trabajo local no se puede perder');
  assert.equal(consulta.syncStatus, 'pending');
});

test('un evento atrasado no retrocede la version local', async () => {
  await resetDb();
  await localDb.consultations.put({
    id: CONSULTA_ID, patientId: PACIENTE_ID, fecha: '2026-04-02',
    k1_d_od: '50', syncVersion: 6, syncStatus: 'synced'
  });

  const resultado = await aplicarFilaHistorialImpl(
    filaRemota({ sync_version_consulta: 3, k1_d_od: '10' })
  );

  assert.equal(resultado.aplicada, false);
  const consulta = await localDb.consultations.get(CONSULTA_ID);
  assert.equal(consulta.syncVersion, 6);
  assert.equal(consulta.k1_d_od, '50', 'no se puede pisar con un evento viejo');
});

test('un evento con version mayor si actualiza', async () => {
  await resetDb();
  await localDb.consultations.put({
    id: CONSULTA_ID, patientId: PACIENTE_ID, fecha: '2026-04-02',
    k1_d_od: '50', syncVersion: 2, syncStatus: 'synced'
  });

  const resultado = await aplicarFilaHistorialImpl(
    filaRemota({ sync_version_consulta: 3, k1_d_od: '51' })
  );

  assert.equal(resultado.aplicada, true);
  const consulta = await localDb.consultations.get(CONSULTA_ID);
  assert.equal(consulta.syncVersion, 3);
  assert.equal(consulta.k1_d_od, '51');
});

test('una cedula archivada en cualquier equipo no revive', async () => {
  await resetDb();
  await setMeta('cedulasArchivadas', [CEDULA]);

  const resultado = await aplicarFilaHistorialImpl(filaRemota());
  assert.equal(resultado.aplicada, false);
  assert.equal(await localDb.consultations.get(CONSULTA_ID), undefined);
  assert.equal(await localDb.cache.get(`remote:${CONSULTA_ID}`), undefined);
});

test('si la fila trae venta, tambien actualiza la venta local', async () => {
  await resetDb();

  const resultado = await aplicarFilaHistorialImpl(filaRemota({
    pedido_id: PEDIDO_ID,
    fecha_venta: '2026-04-01',
    venta: '120.50',
    abono: '40',
    estado: 'En laboratorio'
  }));

  assert.equal(resultado.aplicada, true);
  const venta = await localDb.sales.get(PEDIDO_ID);
  assert.ok(venta, 'la venta debe quedar en local');
  assert.equal(venta.id, PEDIDO_ID);
  assert.equal(venta.patientId, PACIENTE_ID);
  assert.equal(venta.consultationId, CONSULTA_ID);
  assert.equal(venta.abono, '40');
  assert.equal(venta.syncStatus, 'synced');
});

test('una venta local pendiente no se pisa con la del servidor', async () => {
  await resetDb();
  await localDb.sales.put({
    id: PEDIDO_ID, patientId: PACIENTE_ID, consultationId: CONSULTA_ID,
    fecha: '2026-04-01', abono: '10', syncStatus: 'pending'
  });

  await aplicarFilaHistorialImpl(filaRemota({
    pedido_id: PEDIDO_ID, fecha_venta: '2026-04-01', abono: '99'
  }));

  const venta = await localDb.sales.get(PEDIDO_ID);
  assert.equal(venta.abono, '10', 'el abono local sin subir no se puede perder');
  assert.equal(venta.syncStatus, 'pending');
});

test('una fila sin id no rompe nada', async () => {
  await resetDb();
  const resultado = await aplicarFilaHistorialImpl({ nombre: 'sin id' });
  assert.equal(resultado.aplicada, false);
  assert.match(resultado.motivo, /sin id/i);
});

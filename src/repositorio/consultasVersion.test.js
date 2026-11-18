import { reset, patient } from './ayudaPruebas.js';

// ---------------------------------------------------------------------------
// VERSIONADO OPTIMISTA DE CONSULTAS CLINICAS (migracion 024)
// ---------------------------------------------------------------------------
// Antes, dos equipos que editaban la misma ficha se pisaban en silencio: el
// ultimo UPDATE borraba lo del primero. Ahora el payload lleva `base_version`
// y el servidor rechaza con 40001 si otro equipo guardo antes.
//
// Estas pruebas fijan el contrato del lado del cliente: que version se envia y,
// sobre todo, que la version NUNCA se manda como campo clinico.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { localDb } from '../localDb.js';
import { guardarConsultaLocal } from '../localRepository.js';
import { consultationPayload } from './base.js';

const CONSULTA_ID = '70000000-0000-4000-8000-000000000001';

const sembrarPaciente = async () => {
  const p = patient();
  await localDb.patients.put({ ...p, syncStatus: 'synced' });
  return p;
};

const leerOperacion = async () => {
  const operaciones = await localDb.outbox.toArray();
  const operacion = operaciones.find(row => row.type === 'GUARDAR_CONSULTA');
  assert.ok(operacion, 'debe encolarse la operacion GUARDAR_CONSULTA');
  return operacion;
};

test('una consulta nueva se envia sin base_version (no hay nada que comparar)', async () => {
  await reset();
  const p = await sembrarPaciente();

  await guardarConsultaLocal({
    patient: p,
    consultation: { id: CONSULTA_ID, fecha: '2026-03-01', k1_d_od: '42' }
  });

  const operacion = await leerOperacion();
  assert.equal(operacion.payload.p_payload.base_version, null);
  assert.equal(operacion.baseVersion, null);
});

test('una consulta sincronizada envia la version que conoce del servidor', async () => {
  await reset();
  const p = await sembrarPaciente();
  await localDb.consultations.put({
    id: CONSULTA_ID,
    patientId: p.id,
    fecha: '2026-03-01',
    syncVersion: 7,
    syncStatus: 'synced'
  });

  await guardarConsultaLocal({
    patient: p,
    consultation: { id: CONSULTA_ID, fecha: '2026-03-02', k1_d_od: '43' }
  });

  const operacion = await leerOperacion();
  assert.equal(operacion.payload.p_payload.base_version, 7,
    'sin esta version el servidor no puede detectar que otro equipo edito antes');
  assert.equal(operacion.baseVersion, 7);
});

test('una consulta que solo vive en la cache tambien envia su version', async () => {
  // El historial descargado sin abrir la ficha solo existe como "remote:<id>".
  await reset();
  const p = await sembrarPaciente();
  await localDb.cache.put({
    id: `remote:${CONSULTA_ID}`,
    kind: 'historial',
    cedula: p.cedula,
    paciente_id: p.id,
    fecha: '2026-03-01',
    syncVersion: 3
  });

  await guardarConsultaLocal({
    patient: p,
    consultation: { id: CONSULTA_ID, fecha: '2026-03-02', k1_d_od: '44' }
  });

  const operacion = await leerOperacion();
  assert.equal(operacion.payload.p_payload.base_version, 3);
});

test('el payload clinico NUNCA envia la version al servidor', () => {
  // Si sync_version viajara en el payload, el UPDATE dinamico la escribiria y
  // el cliente podria adelantarla, desactivando el control de concurrencia.
  const payload = consultationPayload({
    id: CONSULTA_ID,
    patientId: 'x',
    fecha: '2026-03-01',
    k1_d_od: '42',
    sync_version: 9,
    syncVersion: 9,
    sync_version_consulta: 9,
    server_updated_at: '2026-03-01T00:00:00Z',
    syncStatus: 'pending',
    updatedAt: '2026-03-01T00:00:00Z'
  });

  for (const clave of ['sync_version', 'syncVersion', 'sync_version_consulta', 'server_updated_at', 'syncStatus']) {
    assert.ok(!(clave in payload), `el payload no debe incluir ${clave}`);
  }
  assert.equal(payload.k1_d_od, '42', 'los datos clinicos si deben viajar');
});

test('si la version local es un valor corrupto, no se envia NaN', async () => {
  await reset();
  const p = await sembrarPaciente();
  await localDb.consultations.put({
    id: CONSULTA_ID,
    patientId: p.id,
    fecha: '2026-03-01',
    syncVersion: 'no-es-un-numero',
    syncStatus: 'synced'
  });

  await guardarConsultaLocal({
    patient: p,
    consultation: { id: CONSULTA_ID, fecha: '2026-03-02', k1_d_od: '45' }
  });

  const operacion = await leerOperacion();
  assert.equal(operacion.payload.p_payload.base_version, null,
    'NaN se serializaria como null sin avisar; mejor mandar null explicito');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { compararClinica, resumenCambioPendiente } from './comparacionClinica.js';

const PENDIENTE = {
  fecha: '2026-03-01 10:30',
  avsl_od: '20/20', esfera_od: '-1.00', cilindro_od: '-0.50', eje_od: '90',
  esfera_oi: '-2.00',
  notas_clinicas: 'Control anual'
};

test('extrae la consulta pendiente del payload del outbox', () => {
  const consulta = resumenCambioPendiente({ p_payload: { base_version: 3, consulta: PENDIENTE } });
  assert.deepEqual(consulta, PENDIENTE);
});

test('sin payload clinico devuelve null en vez de romper', () => {
  assert.equal(resumenCambioPendiente(null), null);
  assert.equal(resumenCambioPendiente({}), null);
  assert.equal(resumenCambioPendiente({ p_payload: { consulta: 'texto' } }), null);
});

test('marca como distintos solo los datos que difieren del servidor', () => {
  const filas = compararClinica(PENDIENTE, {
    fecha: '2026-03-01 10:30',
    avsl_od: '20/20', esfera_od: '-1.00', cilindro_od: '-0.50', eje_od: '90',
    esfera_oi: '-2.50',
    notas_clinicas: 'Control anual'
  });

  const porCampo = Object.fromEntries(filas.map(fila => [fila.campo, fila]));
  assert.equal(porCampo.fecha.distinto, false);
  assert.equal(porCampo.od.distinto, false);
  assert.equal(porCampo.od.pendiente, porCampo.od.servidor);
  assert.equal(porCampo.oi.distinto, true);
  assert.match(porCampo.oi.pendiente, /Esf -2\.00/);
  assert.match(porCampo.oi.servidor, /Esf -2\.50/);
  assert.equal(porCampo.notas.distinto, false);
});

test('sin fila del servidor no hay comparacion que mostrar', () => {
  assert.deepEqual(compararClinica(PENDIENTE, null), []);
  assert.deepEqual(compararClinica(null, { esfera_od: '-1.00' }), []);
});

test('las notas vacias de un lado cuentan como diferencia', () => {
  const filas = compararClinica({ notas_clinicas: '' }, { notas_clinicas: 'Agregado en otro equipo' });
  const notas = filas.find(fila => fila.campo === 'notas');
  assert.equal(notas.distinto, true);
  assert.equal(notas.pendiente, '');
  assert.equal(notas.servidor, 'Agregado en otro equipo');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { resumenDeVersion } from './revisionesResumen.js';

test('resume la refraccion de cada ojo con las etiquetas del formulario', () => {
  const resumen = resumenDeVersion({
    fecha: '2026-03-01',
    avsl_od: '20/20', esfera_od: '-1.00', cilindro_od: '-0.50', eje_od: '90', adicion_od: '2.00', dnp_od: '32',
    avsl_oi: '20/25', esfera_oi: '-1.25', cilindro_oi: '-0.75', eje_oi: '80', adicion_oi: '2.00', dnp_oi: '31.5'
  });

  assert.equal(resumen.fecha, '2026-03-01');
  assert.equal(resumen.od, 'AV lejos 20/20 · Esf -1.00 · Cil -0.50 · Eje 90 · Add 2.00 · DNP 32');
  assert.equal(resumen.oi, 'AV lejos 20/25 · Esf -1.25 · Cil -0.75 · Eje 80 · Add 2.00 · DNP 31.5');
});

test('solo muestra los campos que tienen valor', () => {
  const resumen = resumenDeVersion({ esfera_od: '-2.00', eje_od: '180' });
  assert.equal(resumen.od, 'Esf -2.00 · Eje 180');
});

test('un ojo sin datos lo dice sin romper el resumen', () => {
  const resumen = resumenDeVersion({ esfera_od: '-1.00' });
  assert.equal(resumen.oi, 'Sin datos de refracción');
});

test('incluye las notas clinicas y tolera snapshots raros', () => {
  assert.equal(resumenDeVersion({ notas_clinicas: 'Control anual' }).notas, 'Control anual');
  assert.deepEqual(resumenDeVersion(null), {
    fecha: '', od: 'Sin datos de refracción', oi: 'Sin datos de refracción', notas: ''
  });
  assert.equal(resumenDeVersion('no es un objeto').od, 'Sin datos de refracción');
});

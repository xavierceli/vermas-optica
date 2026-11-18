import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extraerIdsPerfiles,
  sqlInsertarUsuarios,
  compararConteos,
  formatearComparacion
} from './restauracion.js';

// ---------------------------------------------------------------------------
// Simulacro de restauracion: si el extractor de usuarios falla, la
// restauracion falla por la clave foranea de perfiles. Si la comparacion de
// conteos es permisiva, un respaldo incompleto pasaria como bueno.
// ---------------------------------------------------------------------------

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

const volcadoConPerfiles = (filas, columnas = 'user_id, rol, creado_en') => [
  'COPY public.perfiles (' + columnas + ') FROM stdin;',
  ...filas,
  '\\.',
  'COPY public.pacientes_perfil (id) FROM stdin;',
  ID_A,
  '\\.'
].join('\n');

test('extrae los user_id de perfiles en el orden que vengan', () => {
  const sql = volcadoConPerfiles([
    `${ID_A}\tadmin\t2026-01-01`,
    `${ID_B}\tpersonal\t2026-01-02`
  ]);

  assert.deepEqual(extraerIdsPerfiles(sql), [ID_A, ID_B]);

  const conOtraColumna = volcadoConPerfiles(
    [`admin\t${ID_A}\t2026-01-01`],
    'rol, user_id, creado_en'
  );
  assert.deepEqual(extraerIdsPerfiles(conOtraColumna), [ID_A]);
});

test('no duplica ids y ignora filas que no son uuid', () => {
  const sql = volcadoConPerfiles([
    `${ID_A}\tadmin\tx`,
    `${ID_A}\tpersonal\ty`,
    'no-es-un-uuid\tadmin\tz'
  ]);

  assert.deepEqual(extraerIdsPerfiles(sql), [ID_A]);
});

test('un volcado sin perfiles no inventa usuarios', () => {
  assert.deepEqual(extraerIdsPerfiles('COPY public.pacientes_perfil (id) FROM stdin;\n\\.'), []);
  assert.deepEqual(extraerIdsPerfiles(''), []);
});

test('genera el insert seguro para auth.users', () => {
  const sql = sqlInsertarUsuarios([ID_A, ID_B]);
  assert.match(sql, /insert into auth\.users \(id\)/);
  assert.match(sql, new RegExp(ID_A));
  assert.match(sql, /on conflict \(id\) do nothing/);

  assert.equal(sqlInsertarUsuarios([]), 'select 1;\n');
});

test('conteos iguales no reportan diferencias', () => {
  const esperado = { pacientes_perfil: 3, consultas_clinicas: 5 };
  const real = { pacientes_perfil: 3, consultas_clinicas: 5 };

  assert.deepEqual(compararConteos(esperado, real), []);
  assert.match(formatearComparacion(esperado, real, []), /OK: la restauracion coincide/);
});

test('una fila de menos se detecta y se explica', () => {
  const diferencias = compararConteos(
    { pacientes_perfil: 3, pagos: 4 },
    { pacientes_perfil: 2, pagos: 4 }
  );

  assert.equal(diferencias.length, 1);
  assert.match(diferencias[0], /pacientes_perfil: el respaldo tiene 3 filas y la restauracion 2/);
  assert.match(formatearComparacion({ pacientes_perfil: 3 }, { pacientes_perfil: 2 }, diferencias), /FALLO/);
});

test('una tabla que no se pudo contar se reporta', () => {
  const diferencias = compararConteos({ pedidos_ventas: 1 }, {});
  assert.equal(diferencias.length, 1);
  assert.match(diferencias[0], /no se pudo contar/);
});

test('solo compara las tablas presentes en el respaldo', () => {
  const diferencias = compararConteos({ pacientes_perfil: 1 }, { pacientes_perfil: 1, pagos: 99 });
  assert.deepEqual(diferencias, []);
});

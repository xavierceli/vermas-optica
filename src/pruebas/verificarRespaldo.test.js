import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLAS_CRITICAS,
  FUNCIONES_CRITICAS,
  contarFilasPorTabla,
  verificarRespaldo,
  formatearInforme
} from './verificarRespaldo.js';

// ---------------------------------------------------------------------------
// El verificador es la ultima barrera antes de publicar un respaldo. Si deja
// pasar un volcado cortado, la rama de respaldos se llena de archivos que no
// restauran nada. Estas pruebas construyen volcados sinteticos con la misma
// forma que produce pg_dump.
// ---------------------------------------------------------------------------

const construir = ({
  tablas = TABLAS_CRITICAS,
  funciones = FUNCIONES_CRITICAS,
  filas = {},
  rls = 8,
  politicas = 8,
  completo = true,
  lineaError = ''
} = {}) => {
  const partes = ['--', '-- PostgreSQL database dump', '--', ''];

  for (const tabla of tablas) {
    partes.push(`CREATE TABLE public.${tabla} (`, '    id uuid NOT NULL', ');', '');
  }

  for (const funcion of funciones) {
    partes.push(`CREATE FUNCTION public.${funcion}(p jsonb) RETURNS jsonb`,
      '    LANGUAGE sql AS $$ select p $$;', '');
  }

  for (let i = 0; i < rls; i += 1) {
    const tabla = TABLAS_CRITICAS[i % TABLAS_CRITICAS.length];
    partes.push(`ALTER TABLE public.${tabla} ENABLE ROW LEVEL SECURITY;`);
  }

  for (let i = 0; i < politicas; i += 1) {
    partes.push(`CREATE POLICY politica_${i} ON public.pacientes_perfil FOR SELECT TO authenticated USING (true);`);
  }

  for (const tabla of tablas) {
    if (filas[tabla] === null) continue;
    const cantidad = filas[tabla] ?? 1;
    partes.push(`COPY public.${tabla} (id) FROM stdin;`);
    for (let i = 0; i < cantidad; i += 1) {
      partes.push(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    }
    partes.push('\\.');
  }

  if (lineaError) partes.push(lineaError);
  if (completo) partes.push('--', '-- PostgreSQL database dump complete', '--');

  return partes.join('\n');
};

test('un volcado completo pasa y reporta las filas', () => {
  const sql = construir({ filas: { pacientes_perfil: 3, consultas_clinicas: 5, pagos: 2 } });
  const resultado = verificarRespaldo(sql);

  assert.equal(resultado.ok, true, resultado.errores.join('; '));
  assert.equal(resultado.completo, true);
  assert.equal(resultado.filas.pacientes_perfil, 3);
  assert.equal(resultado.filas.consultas_clinicas, 5);
  assert.equal(resultado.filas.pagos, 2);
  assert.deepEqual(resultado.errores, []);
});

test('un volcado cortado se rechaza', () => {
  const resultado = verificarRespaldo(construir({ completo: false }));
  assert.equal(resultado.ok, false);
  assert.match(resultado.errores.join(' '), /volcado cortado|marca final/i);
});

test('si falta una tabla critica se rechaza', () => {
  const tablas = TABLAS_CRITICAS.filter(tabla => tabla !== 'pagos');
  const resultado = verificarRespaldo(construir({ tablas }));

  assert.equal(resultado.ok, false);
  assert.match(resultado.errores.join(' '), /falta la tabla pagos/);
});

test('si falta una funcion critica se rechaza', () => {
  const funciones = FUNCIONES_CRITICAS.filter(funcion => funcion !== 'crear_venta');
  const resultado = verificarRespaldo(construir({ funciones }));

  assert.equal(resultado.ok, false);
  assert.match(resultado.errores.join(' '), /falta la funcion crear_venta/);
});

test('una tabla sin bloque COPY se rechaza (esquema sin datos)', () => {
  const resultado = verificarRespaldo(construir({ filas: { consultas_clinicas: null } }));

  assert.equal(resultado.ok, false);
  assert.match(resultado.errores.join(' '), /consultas_clinicas no trae bloque COPY/);
});

test('consultas sin pacientes se detecta como inconsistencia', () => {
  const resultado = verificarRespaldo(construir({
    filas: { pacientes_perfil: 0, consultas_clinicas: 4 }
  }));

  assert.equal(resultado.ok, false);
  assert.match(resultado.errores.join(' '), /0 pacientes/);
});

test('una base vacia es valida pero avisa', () => {
  const resultado = verificarRespaldo(construir({ filas: { pacientes_perfil: 0, consultas_clinicas: 0 } }));

  assert.equal(resultado.ok, true, resultado.errores.join('; '));
  assert.match(resultado.avisos.join(' '), /pacientes_perfil esta vacia/i);
});

test('detecta la salida de error mezclada con el volcado', () => {
  const resultado = verificarRespaldo(construir({
    lineaError: 'pg_dump: error: connection to server was lost'
  }));

  assert.equal(resultado.ok, false);
  assert.match(resultado.errores.join(' '), /ERROR\/FATAL|connection to server/i);
});

test('sin politicas RLS avisa, no falla', () => {
  const resultado = verificarRespaldo(construir({ politicas: 0 }));

  assert.equal(resultado.ok, true);
  assert.match(resultado.avisos.join(' '), /ninguna CREATE POLICY/i);
});

test('el contador de COPY no se confunde con el terminador', () => {
  const filas = contarFilasPorTabla(
    'COPY public.pedidos_ventas (id) FROM stdin;\n1\n2\n\\.\nCOPY public.pagos (id) FROM stdin;\n\\.\n'
  );

  assert.equal(filas.get('pedidos_ventas'), 2);
  assert.equal(filas.get('pagos'), 0);
});

test('el informe final dice claramente si sirve o no', () => {
  const ok = formatearInforme(verificarRespaldo(construir()), 'respaldo.sql');
  assert.match(ok, /^Respaldo: respaldo\.sql/m);
  assert.match(ok, /OK: el respaldo parece restaurable/);

  const roto = formatearInforme(verificarRespaldo(construir({ completo: false })), 'roto.sql');
  assert.match(roto, /FALLO: el respaldo NO es fiable/);
  assert.match(roto, /ERROR:/);
});

test('un COPY sin terminador se detecta aunque el archivo diga "complete"', () => {
  // Se quita la linea del terminador del bloque COPY de pagos.
  const lineas = construir().split('\n');
  const inicio = lineas.findIndex(linea => linea.startsWith('COPY public.pagos'));
  lineas.splice(inicio + 2, 1);
  const resultado = verificarRespaldo(lineas.join('\n'));

  assert.equal(resultado.ok, false);
  assert.match(resultado.errores.join(' '), /bloque COPY de pagos no termina/);
});

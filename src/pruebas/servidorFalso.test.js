import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crearEstado,
  sembrar,
  atenderPeticion,
  crearSesion
} from './servidorFalso.js';

// ---------------------------------------------------------------------------
// SERVIDOR FALSO DE LAS PRUEBAS E2E
// ---------------------------------------------------------------------------
// Si el servidor falso miente, las pruebas de dos equipos no valen nada. Aqui
// se comprueba que reproduce las reglas que de verdad importan:
//   - versionado de consultas (40001),
//   - stock (23514),
//   - idempotencia del outbox.
// ---------------------------------------------------------------------------
const PACIENTE = '11111111-1111-4111-8111-111111111111';
const CONSULTA = '22222222-2222-4222-8222-222222222222';
const CEDULA = '1712345678';

const opConsulta = (id, baseVersion, k1) => ({
  id,
  type: 'GUARDAR_CONSULTA',
  payload: {
    p_consulta_id: CONSULTA,
    p_payload: {
      base_version: baseVersion,
      paciente: { id: PACIENTE, cedula: CEDULA, nombre: 'Paciente Demo' },
      consulta: { k1_d_od: k1 }
    }
  }
});

const opVenta = (id, ventaId) => ({
  id,
  type: 'CREAR_VENTA',
  payload: {
    p_venta_id: ventaId,
    p_payload: {
      paciente: { id: PACIENTE, cedula: CEDULA, nombre: 'Paciente Demo' },
      consulta_id: CONSULTA,
      consulta: {},
      venta: { fecha: '2026-05-01', venta: '100', descuento: '0', estado: 'En laboratorio' },
      items: [{ inventario_id: 1, cantidad: 1, codigo: null }]
    }
  }
});

const enviar = (estado, operaciones, url = 'https://falso.supabase.co/rest/v1/rpc/aplicar_operaciones') =>
  atenderPeticion(estado, {
    method: 'POST',
    url,
    body: { p_operaciones: operaciones }
  }).cuerpo;

test('la vista versionada entrega sync_version_consulta', () => {
  const estado = sembrar(crearEstado());
  const { status, cuerpo } = atenderPeticion(estado, {
    method: 'GET',
    url: 'https://falso.supabase.co/rest/v1/vista_pacientes_versionada?select=*&order=fecha.desc'
  });

  assert.equal(status, 200);
  assert.equal(cuerpo.length, 1);
  assert.equal(cuerpo[0].id, CONSULTA);
  assert.equal(cuerpo[0].sync_version_consulta, 1);
  assert.equal(cuerpo[0].cedula, CEDULA);
});

test('la consulta se guarda y sube de version', () => {
  const estado = sembrar(crearEstado());
  const resultado = enviar(estado, [opConsulta('op-1', 1, '45')]);

  assert.equal(resultado.results[0].status, 'applied');
  assert.equal(resultado.results[0].result.sync_version, 2);
  assert.equal(estado.consultas.get(CONSULTA).k1_d_od, '45');
  assert.equal(estado.consultas.get(CONSULTA).sync_version, 2);
});

test('si otro equipo edito antes, devuelve conflicto y NO pisa el dato', () => {
  const estado = sembrar(crearEstado());

  enviar(estado, [opConsulta('op-a', 1, '45')]);
  const resultado = enviar(estado, [opConsulta('op-b', 1, '99')]);

  assert.equal(resultado.results[0].status, 'conflict');
  assert.match(resultado.results[0].error, /modificad[ao] en otro dispositivo/i);
  assert.equal(estado.consultas.get(CONSULTA).k1_d_od, '45',
    'la edicion del segundo equipo no puede aplicarse');
  assert.equal(estado.consultas.get(CONSULTA).sync_version, 2);

  assert.equal(estado.revisiones.length, 1, 'la version anterior queda guardada');
  assert.equal(estado.revisiones[0].version, 1);
});

test('la venta descuenta stock y la segunda queda en conflicto', () => {
  const estado = sembrar(crearEstado());
  assert.equal(estado.inventario.get(1).stock, 1);

  const primera = enviar(estado, [opVenta('venta-a', 'venta-1')]);
  assert.equal(primera.results[0].status, 'applied');
  assert.equal(estado.inventario.get(1).stock, 0);

  const segunda = enviar(estado, [opVenta('venta-b', 'venta-2')]);
  assert.equal(segunda.results[0].status, 'conflict');
  assert.match(segunda.results[0].error, /stock insuficiente/i);
  assert.equal(estado.inventario.get(1).stock, 0, 'no puede quedar negativo');
});

test('repetir la misma operacion no descuenta stock dos veces (idempotencia)', () => {
  const estado = sembrar(crearEstado());

  enviar(estado, [opVenta('venta-a', 'venta-1')]);
  const repetida = enviar(estado, [opVenta('venta-a', 'venta-1')]);

  assert.equal(repetida.results[0].status, 'applied');
  assert.equal(repetida.results[0].replay, true);
  assert.equal(estado.inventario.get(1).stock, 0);
});

test('la consulta nueva arranca en version 0', () => {
  const estado = sembrar(crearEstado());
  const nueva = '33333333-3333-4333-8333-333333333333';

  const resultado = enviar(estado, [{
    id: 'op-nueva',
    type: 'GUARDAR_CONSULTA',
    payload: {
      p_consulta_id: nueva,
      p_payload: {
        base_version: null,
        paciente: { cedula: '1799999999', nombre: 'Paciente Nuevo' },
        consulta: { fecha: '2026-05-01', k1_d_od: '40' }
      }
    }
  }]);

  assert.equal(resultado.results[0].status, 'applied');
  assert.equal(resultado.results[0].result.creada, true);
  assert.equal(resultado.results[0].result.sync_version, 0);
});

test('las cedulas archivadas se exponen como filas', () => {
  const estado = sembrar(crearEstado());
  estado.archivados.push('1711111111');

  const { cuerpo } = atenderPeticion(estado, {
    method: 'GET',
    url: 'https://falso.supabase.co/rest/v1/pacientes_archivados?select=cedula'
  });

  assert.deepEqual(cuerpo, [{ cedula: '1711111111' }]);
});

test('paginacion y orden de PostgREST', () => {
  const estado = sembrar(crearEstado());
  for (const numero of [2, 3]) {
    estado.consultas.set(`consulta-${numero}`, {
      id: `consulta-${numero}`,
      paciente_id: PACIENTE,
      fecha: `2026-0${numero}-01`,
      sync_version: 0,
      archived_at: null
    });
  }

  const { cuerpo } = atenderPeticion(estado, {
    method: 'GET',
    url: 'https://falso.supabase.co/rest/v1/vista_pacientes_versionada?select=*&order=fecha.desc&offset=0&limit=2'
  });

  assert.equal(cuerpo.length, 2);
  assert.equal(cuerpo[0].fecha, '2026-03-01');
  assert.equal(cuerpo[1].fecha, '2026-02-01');
});

test('una tabla desconocida responde vacio, no rompe la app', () => {
  const estado = sembrar(crearEstado());
  const { status, cuerpo } = atenderPeticion(estado, {
    method: 'GET',
    url: 'https://falso.supabase.co/rest/v1/tabla_que_no_existe?select=*'
  });
  assert.equal(status, 200);
  assert.deepEqual(cuerpo, []);
});

test('la sesion falsa tiene la forma que espera supabase-js', () => {
  const sesion = crearSesion('admin@vermas.test');
  assert.ok(sesion.access_token.split('.').length === 3);
  assert.equal(sesion.token_type, 'bearer');
  assert.ok(sesion.expires_at > Date.now() / 1000);
  assert.equal(sesion.user.email, 'admin@vermas.test');
});

test('mi_rol devuelve un rol utilizable', () => {
  const estado = sembrar(crearEstado());
  const { cuerpo } = atenderPeticion(estado, {
    method: 'POST',
    url: 'https://falso.supabase.co/rest/v1/rpc/mi_rol',
    body: {}
  });
  assert.equal(cuerpo, 'admin');
});

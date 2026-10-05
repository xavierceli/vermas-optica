import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { localDb } from './localDb.js';
import {
  usarClienteDePrueba, traducirErrorEliminacion, contarRegistrosPaciente,
  purgarPacienteLocal, reconciliarConServidor
} from './eliminacionPaciente.js';

// ESTE ES EL ARCHIVO MAS DELICADO DE LA APP: borra un paciente y todo lo que
// cuelga de el, para siempre, en el servidor y en los demas equipos.
//
// Antes de estas pruebas solo se comprobaba el TEXTO del boton de confirmacion
// ("Se borrara para siempre", "escribe la cedula"). El comportamiento, es decir
// QUE BORRA Y QUE NO, no estaba cubierto por ninguna prueba.
//
// aqui se fija lo que un borrado puede tocar y, sobre todo, lo que NO puede.

const limpiar = async () => {
  for (const t of ['patients','consultations','sales','saleItems','payments',
    'inventoryMovements','outbox','attachments','cache']) {
    await localDb[t].clear();
  }
};

const sembrar = async () => {
  await localDb.patients.bulkPut([
    { id: 'p1', cedula: '1712345678', nombre: 'JUAN', syncStatus: 'synced' },
    { id: 'p2', cedula: '0911111111', nombre: 'MARIA', syncStatus: 'synced' },
    { id: 'p3', cedula: '0555555555', nombre: 'PENDIENTE', syncStatus: 'pending' }
  ]);
  await localDb.consultations.bulkPut([
    { id: 'c1', patientId: 'p1', cedula: '1712345678', syncStatus: 'synced' },
    { id: 'c2', patientId: 'p2', cedula: '0911111111', syncStatus: 'synced' },
    { id: 'c3', patientId: 'p3', cedula: '0555555555', syncStatus: 'pending' }
  ]);
  await localDb.sales.bulkPut([
    { id: 's1', patientId: 'p1', cedula: '1712345678', syncStatus: 'synced' },
    { id: 's2', patientId: 'p2', cedula: '0911111111', syncStatus: 'synced' }
  ]);
  await localDb.saleItems.bulkPut([
    { id: 'i1', saleId: 's1', inventoryId: 'inv1' },
    { id: 'i2', saleId: 's2', inventoryId: 'inv2' }
  ]);
  await localDb.payments.bulkPut([
    { id: 'pay1', saleId: 's1', monto: 50, syncStatus: 'synced' },
    { id: 'pay2', saleId: 's2', monto: 80, syncStatus: 'synced' }
  ]);
};

// --- Lo que un borrado NO debe tocar ------------------------------------------

test('borrar un paciente no toca a los demas', async () => {
  await limpiar(); await sembrar();
  await purgarPacienteLocal({ cedula: '1712345678' });

  const quedan = await localDb.patients.toArray();
  // Quedan 2: el otro paciente Y el que esta pendiente de subir. Borrar de este
  // equipo lo que aun no se ha subido dejaria un hueco que la sincronizacion
  // volveria a llenar con datos de un paciente "borrado".
  assert.equal(quedan.length, 2, 'el pendiente de subir sobrevive');
  assert.ok(!quedan.find(p => p.cedula === '1712345678'), 'el borrado ya no esta');
  assert.ok(quedan.find(p => p.cedula === '0911111111'), 'el otro paciente intacto');
  assert.equal((await localDb.sales.toArray()).length, 1, 'solo se borra su venta');
});

test('los datos ya sincronizados SI se borran, con todo lo suyo', async () => {
  await limpiar(); await sembrar();
  await purgarPacienteLocal({ cedula: '1712345678' });
  assert.equal(await localDb.patients.get('p1'), undefined);
  assert.equal(await localDb.consultations.get('c1'), undefined);
  assert.equal(await localDb.saleItems.get('i1'), undefined, 'ni sus productos de venta');
  assert.equal(await localDb.payments.get('pay1'), undefined, 'ni sus cobros');
});

test('los cobros y productos del otro paciente siguen ahi', async () => {
  await limpiar(); await sembrar();
  await purgarPacienteLocal({ cedula: '1712345678' });
  assert.ok(await localDb.saleItems.get('i2'), 'los productos del otro venta siguen');
  assert.ok(await localDb.payments.get('pay2'), 'y sus cobros tambien');
});

test('borrar por id del servidor también limpia, aunque la cedula local difiera', async () => {
  await limpiar(); await sembrar();
  // El id del servidor puede no coincidir con el local: por eso se busca por ambos.
  await purgarPacienteLocal({ pacienteIds: ['p1'] });
  assert.equal(await localDb.patients.get('p1'), undefined);
  assert.ok(await localDb.patients.get('p2'), 'el otro paciente intacto');
});

// --- Reconciliacion: la parte que mas duele si se equivoca -------------------

test('la reconciliacion BORRA lo sincronizado que el servidor ya no tiene', async () => {
  await limpiar(); await sembrar();
  // El servidor solo devuelve c1 y c2: s1 ya no existe alla.
  await reconciliarConServidor([
    { id: 'c1', pedido_id: null },
    { id: 'c2', pedido_id: 's2' }
  ]);

  assert.equal(await localDb.sales.get('s1'), undefined, 'la venta que el servidor no tiene, fuera');
  assert.ok(await localDb.sales.get('s2'), 'la que si tiene, se queda');
});

test('la reconciliacion NUNCA toca lo pendiente de subir', async () => {
  await limpiar(); await sembrar();
  // El servidor no devuelve la c3, pero la c3 esta pendiente: si se borrara, la
  // consulta del usuario se perderia sin haber llegado a subirse nunca.
  await reconciliarConServidor([
    { id: 'c1', pedido_id: null },
    { id: 'c2', pedido_id: 's2' }
  ]);
  assert.ok(await localDb.consultations.get('c3'), 'lo pendiente de subir sobrevive siempre');
  assert.ok(await localDb.patients.get('p3'), 'tambien su ficha');
});

test('una descarga vacia NO borra nada (seria una lectura fallida)', async () => {
  await limpiar(); await sembrar();
  await reconciliarConServidor([]);
  assert.equal((await localDb.patients.toArray()).length, 3, 'nada se borra sin confirmacion');
  assert.equal((await localDb.sales.toArray()).length, 2);
});

test('una descarga vacia solo borra si alguien confirma que es verdad', async () => {
  await limpiar(); await sembrar();
  await reconciliarConServidor([], { permitirVacio: true });
  assert.equal((await localDb.sales.toArray()).length, 0, 'con confirmacion si limpia');
});

test('una respuesta que no es lista no borra nada', async () => {
  await limpiar(); await sembrar();
  assert.equal(await reconciliarConServidor(null), null);
  assert.equal(await reconciliarConServidor(undefined), null);
  assert.equal(await reconciliarConServidor({ error: 'timeout' }), null);
  assert.equal((await localDb.sales.toArray()).length, 2, 'los datos siguen intactos');
});

test('la reconciliacion se puede repetir sin romper nada', async () => {
  await limpiar(); await sembrar();
  const filas = [{ id: 'c1', pedido_id: null }, { id: 'c2', pedido_id: 's2' }];
  await reconciliarConServidor(filas);
  await reconciliarConServidor(filas);
  assert.equal((await localDb.consultations.toArray()).length, 3, 'idempotente');
});

// --- Errores: el mensaje que ve el usuario ------------------------------------

test('si falta la migracion, el aviso lo dice claro', () => {
  const mensaje = traducirErrorEliminacion({ code: 'PGRST202', message: 'does not exist' });
  assert.match(mensaje, /migraci[oó]n 018/i, 'debe decir que falta aplicar la migracion');
});

test('un problema de permisos invita a iniciar sesion de nuevo', () => {
  assert.match(traducirErrorEliminacion({ code: '42501' }), /sesi[oó]n/i);
});

test('un fallo de red no dice que se borro nada', () => {
  // Este es el mensaje mas importante: si el servidor no contesto, el usuario
  // tiene que saber que no se borro, para no repetirlo creyendo que si.
  const mensaje = traducirErrorEliminacion({ message: 'Failed to fetch' });
  assert.match(mensaje, /No se pudo conectar/i);
});

test('sin conexion el borrado se rechaza antes de tocar nada', async () => {
  await limpiar(); await sembrar();
  usarClienteDePrueba({ rpc: async () => { throw new Error('no deberia llamarse'); } });
  const original = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false }, configurable: true, writable: true
  });
  try {
    await assert.rejects(
      () => contarRegistrosPaciente('1712345678'),
      /Sin conexi[oó]n/i,
      'debe rechazar en vez de borrar a medias'
    );
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: original, configurable: true, writable: true
    });
  }
  assert.equal((await localDb.patients.toArray()).length, 3, 'no se toco nada');
});

test('la cedula es obligatoria', async () => {
  await assert.rejects(() => contarRegistrosPaciente(''), /c[eé]dula es obligatoria/i);
  await assert.rejects(() => contarRegistrosPaciente('   '), /c[eé]dula es obligatoria/i);
});
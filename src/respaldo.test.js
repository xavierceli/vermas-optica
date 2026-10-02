import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FORMATO_RESPALDO, TABLAS, VERSION_RESPALDO, base64ABlob, blobABase64,
  construirRespaldo, formatearMB, nivelEspacio, nombreArchivoRespaldo,
  parsearRespaldo, resumenRespaldo, restaurarRespaldo
} from './respaldo.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)));
const leer = nombre => readFileSync(join(SRC, nombre), 'utf8');

// Todo lo que se guarda sin conexion vive unicamente en el navegador. Si se
// rompe el equipo o se limpia la cache, esa semana de trabajo se pierde. Estos
// tests fijan que el respaldo sea fiel y, sobre todo, que restaurar NUNCA borre.

const MB = 1024 * 1024;

/** Base falsa con las mismas operaciones que usa Dexie. */
const crearDb = (sembrado = {}) => {
  const tablas = new Map();
  const llamadas = [];
  for (const nombre of TABLAS) {
    const filas = new Map((sembrado[nombre] || []).map(f => [f.id, f]));
    tablas.set(nombre, {
      toArray: async () => [...filas.values()],
      bulkPut: async nuevos => {
        llamadas.push(['bulkPut', nombre, nuevos.length]);
        nuevos.forEach(f => filas.set(f.id, f));
      },
      bulkAdd: async nuevos => {
        llamadas.push(['bulkAdd', nombre, nuevos.length]);
        for (const fila of nuevos) {
          if (filas.has(fila.id)) throw new Error(`Clave duplicada: ${fila.id}`);
          filas.set(fila.id, fila);
        }
      },
      clear: async () => { llamadas.push(['clear', nombre]); filas.clear(); },
      delete: async id => { llamadas.push(['delete', nombre]); filas.delete(id); },
      snapshot: () => new Map(filas),
      restore: copia => { filas.clear(); for (const [id, fila] of copia) filas.set(id, fila); }
    });
  }
  const db = Object.fromEntries(tablas);
  db.transaction = async (_modo, ...argumentos) => {
    const ejecutar = argumentos.pop();
    const copias = argumentos.map(tabla => [tabla, tabla.snapshot()]);
    try {
      return await ejecutar();
    } catch (error) {
      copias.forEach(([tabla, copia]) => tabla.restore(copia));
      throw error;
    }
  };
  return { llamadas, db };
};

test('un Blob sobrevive al viaje de ida y vuelta sin perder un byte', async () => {
  const original = new Blob(['hola optica'], { type: 'text/plain' });
  const recuperado = base64ABlob(await blobABase64(original), 'text/plain');
  assert.equal(recuperado.type, 'text/plain');
  assert.equal(await recuperado.text(), 'hola optica');
});

test('el respaldo guarda los metadatos del adjunto y el binario aparte', async () => {
  const db = crearDb({
    patients: [{ id: 'p1', nombre: 'Ana' }],
    attachments: [{ id: 'a1', refId: 'p1', blob: new Blob(['JPEGDATA'], { type: 'image/jpeg' }) }]
  }).db;
  const respaldo = await construirRespaldo(db);

  assert.equal(respaldo.formato, FORMATO_RESPALDO);
  assert.equal(respaldo.version, VERSION_RESPALDO);
  assert.equal(respaldo.conteos.patients, 1);
  // El Blob no puede quedar dentro de la fila: al serializar se volveria {}.
  assert.equal(respaldo.tablas.attachments[0].blob, undefined);
  assert.equal(respaldo.binarios.length, 1);
  assert.equal(await base64ABlob(respaldo.binarios[0].base64, respaldo.binarios[0].mime).text(), 'JPEGDATA');
});

test('el respaldo serializa y se vuelve a leer sin perder informacion', async () => {
  const original = await construirRespaldo(
    crearDb({ sales: [{ id: 'v1', total: 25.5 }], inventory: [{ id: 'i1', codigo: 'DXC1' }] }).db
  );
  const copia = parsearRespaldo(JSON.stringify(original));
  assert.equal(copia.tablas.sales[0].total, 25.5);
  assert.equal(copia.tablas.inventory[0].codigo, 'DXC1');
});

test('un archivo que no es respaldo se rechaza con un mensaje entendible', () => {
  assert.throws(() => parsearRespaldo('no soy json'), /no se pudo leer/);
  assert.throws(() => parsearRespaldo('{"otra":"cosa"}'), /no es un respaldo/);
  assert.throws(
    () => parsearRespaldo(JSON.stringify({ formato: FORMATO_RESPALDO, version: 99 })),
    /versión más nueva/
  );
});
test('restaurar solo agrega registros ausentes y conserva intactos los que ya existen', async () => {
  const { db, llamadas } = crearDb({ patients: [{ id: 'p1', nombre: 'Local actualizado' }] });
  const resultado = await restaurarRespaldo(db, {
    formato: FORMATO_RESPALDO,
    version: 1,
    tablas: { patients: [
      { id: 'p1', nombre: 'Ana del respaldo antiguo' },
      { id: 'p9', nombre: 'Luis' }
    ] },
    binarios: []
  });

  assert.deepEqual(resultado, { conteos: { patients: 1 }, omitidos: 1 });
  assert.deepEqual(await db.patients.toArray(), [
    { id: 'p1', nombre: 'Local actualizado' },
    { id: 'p9', nombre: 'Luis' }
  ]);
  assert.ok(
    llamadas.every(([operacion]) => operacion === 'bulkAdd'),
    'restaurar solo agrega claves nuevas: ' + JSON.stringify(llamadas)
  );
});

test('restaurar devuelve los adjuntos con su binario', async () => {
  const { db } = crearDb();
  const resultado = await restaurarRespaldo(db, {
    formato: FORMATO_RESPALDO,
    version: 1,
    tablas: { attachments: [{ id: 'a1', refId: 'p1' }] },
    binarios: [{ id: 'a1', mime: 'image/jpeg', base64: await blobABase64(new Blob(['FOTO'])) }]
  });
  assert.deepEqual(resultado, { conteos: { attachments: 1 }, omitidos: 0 });
  const [adjunto] = await db.attachments.toArray();
  assert.equal(adjunto.blob.type, 'image/jpeg');
  assert.equal(await adjunto.blob.text(), 'FOTO');
});

test('un respaldo con identificadores repetidos se rechaza antes de importar', () => {
  assert.throws(() => parsearRespaldo(JSON.stringify({
    formato: FORMATO_RESPALDO,
    version: VERSION_RESPALDO,
    tablas: { patients: [{ id: 'p1' }, { id: 'p1' }] }
  })), /identificadores repetidos/);
});

test('si falla una tabla, la transacción revierte las filas anteriores', async () => {
  const { db } = crearDb();
  db.attachments.bulkAdd = async () => { throw new Error('fallo de prueba'); };
  await assert.rejects(restaurarRespaldo(db, {
    formato: FORMATO_RESPALDO,
    version: VERSION_RESPALDO,
    tablas: {
      patients: [{ id: 'p1', nombre: 'Ana' }],
      attachments: [{ id: 'a1', refId: 'p1' }]
    },
    binarios: []
  }), /fallo de prueba/);
  assert.deepEqual(await db.patients.toArray(), []);
});

test('el resumen dice que contiene el archivo, no un numero suelto', () => {
  assert.equal(resumenRespaldo({}), 'sin datos');
  const texto = resumenRespaldo({ patients: 3, sales: 2, outbox: 1 });
  assert.match(texto, /3 pacientes/);
  assert.match(texto, /2 ventas/);
  assert.match(texto, /1 cambios en cola/);
});

test('el archivo se llama con la fecha para no pisar respaldos anteriores', () => {
  assert.equal(nombreArchivoRespaldo(new Date(2026, 8, 28, 9, 5)), 'verplus-respaldo-20260928-0905.json');
});

test('el aviso de espacio salta antes de que el navegador borre los datos', () => {
  assert.equal(nivelEspacio(0, 0), 'desconocido');
  assert.equal(nivelEspacio(100 * MB, 5 * 1024 * MB), 'ok');
  assert.equal(nivelEspacio(4.9 * 1024 * MB, 5 * 1024 * MB), 'poco');
  assert.equal(nivelEspacio(4.98 * 1024 * MB, 5 * 1024 * MB), 'critico');
  assert.equal(formatearMB(5 * MB), '5.0 MB');
  assert.equal(formatearMB(2048 * MB), '2048 MB');
});

// --- El respaldo no puede convertirse en una herramienta de borrado --------
test('la interfaz de respaldo jamas borra datos', () => {
  const fuente = leer('RespaldoDatos.jsx');
  assert.ok(
    !/\.clear\(|deleteDatabase|localDb\.delete|truncate/i.test(fuente),
    'la pantalla de respaldo no puede borrar nada'
  );
  assert.ok(fuente.includes('construirRespaldo'), 'debe ofrecer la descarga del respaldo');
  assert.ok(fuente.includes('restaurarRespaldo'), 'debe usar la restauracion segura');
});

test('la interfaz explica que el respaldo es local y puede incluir datos clinicos', () => {
  const fuente = leer('RespaldoDatos.jsx');
  assert.match(fuente, /datos de este navegador/i);
  assert.match(fuente, /No es una copia automática de Supabase/i);
  assert.match(fuente, /datos clínicos y adjuntos/i);
  assert.match(fuente, /no lo envíes por correo/i);
});

test('el panel de sincronizacion incluye el respaldo', () => {
  assert.match(leer('PanelSincronizacion.jsx'), /<RespaldoDatos/);
});

import { reset } from './ayudaPruebas.js';

// ---------------------------------------------------------------------------
// MANTENIMIENTO DEL ALMACENAMIENTO LOCAL
// ---------------------------------------------------------------------------
// La app es offline-first: si IndexedDB se llena, deja de guardar. Estas
// pruebas fijan las dos reglas que evitan perder datos:
//   1. Un adjunto pendiente o con error NUNCA se libera: puede ser la unica
//      copia.
//   2. Una fila de cache solo se borra si el dato ya vive en `consultations`
//      como sincronizado.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { localDb, getMeta, setMeta } from '../localDb.js';
import {
  purgarAdjuntosSubidosImpl,
  purgarCacheRedundanteImpl,
  ejecutarMantenimientoImpl,
  revisarEspacioImpl,
  DIAS_ADJUNTOS_SUBIDOS,
  DIAS_CACHE_REDUNDANTE
} from './mantenimiento.js';

const DIA = 24 * 60 * 60 * 1000;
const hace = dias => new Date(Date.now() - dias * DIA).toISOString();

const adjunto = ({ id, status = 'uploaded', dias = 0, conBlob = true }) => ({
  id,
  ruta: `archivo_${id}.jpg`,
  bucket: 'comprobantes_pagos',
  refType: 'venta',
  refId: 'venta-1',
  mime: 'image/jpeg',
  nombre: `archivo_${id}.jpg`,
  ...(conBlob ? { blob: { size: 4096, type: 'image/jpeg' } } : {}),
  status,
  createdAt: hace(dias),
  updatedAt: hace(dias)
});

test('adjuntos: solo libera los subidos y mas viejos que la retencion', async () => {
  await reset();
  await localDb.attachments.bulkPut([
    adjunto({ id: 'viejo-subido', status: 'uploaded', dias: DIAS_ADJUNTOS_SUBIDOS + 10 }),
    adjunto({ id: 'reciente-subido', status: 'uploaded', dias: 5 }),
    adjunto({ id: 'pendiente', status: 'pending', dias: 400 }),
    adjunto({ id: 'con-error', status: 'failed', dias: 400 }),
    adjunto({ id: 'ya-libre', status: 'uploaded', dias: 400, conBlob: false })
  ]);

  const liberados = await purgarAdjuntosSubidosImpl();
  assert.equal(liberados, 1);

  const viejo = await localDb.attachments.get('viejo-subido');
  assert.ok(viejo, 'la fila se conserva: solo se libera el binario');
  assert.equal(viejo.status, 'uploaded');
  assert.ok(viejo.blobLiberadoEn, 'debe quedar constancia de cuando se libero');
  assert.equal(viejo.blob, undefined, 'el blob debe desaparecer de IndexedDB');

  // Nada de lo que aun no esta en el servidor se toca.
  for (const id of ['pendiente', 'con-error']) {
    const fila = await localDb.attachments.get(id);
    assert.ok(fila.blob, `${id} no se puede liberar: no esta en el servidor`);
  }

  assert.ok((await localDb.attachments.get('reciente-subido')).blob,
    'la retencion protege los adjuntos recientes');
});

test('adjuntos: es idempotente', async () => {
  await reset();
  await localDb.attachments.put(
    adjunto({ id: 'viejo', status: 'uploaded', dias: DIAS_ADJUNTOS_SUBIDOS + 1 })
  );

  assert.equal(await purgarAdjuntosSubidosImpl(), 1);
  assert.equal(await purgarAdjuntosSubidosImpl(), 0, 'la segunda pasada no hace nada');
  assert.ok(await localDb.attachments.get('viejo'));
});

test('cache: borra la copia duplicada cuando el dato ya esta local y sincronizado', async () => {
  await reset();
  const viejo = hace(DIAS_CACHE_REDUNDANTE + 5);

  await localDb.consultations.bulkPut([
    { id: 'c-sincronizada', patientId: 'p1', fecha: '2026-01-01', syncStatus: 'synced' },
    { id: 'c-pendiente', patientId: 'p1', fecha: '2026-01-02', syncStatus: 'pending' }
  ]);
  await localDb.cache.bulkPut([
    { id: 'remote:c-sincronizada', kind: 'historial', updatedAt: viejo },
    { id: 'remote:c-pendiente', kind: 'historial', updatedAt: viejo },
    { id: 'remote:solo-cache', kind: 'historial', updatedAt: viejo },
    { id: 'remote:c-reciente', kind: 'historial', updatedAt: new Date().toISOString() }
  ]);
  await localDb.consultations.put({
    id: 'c-reciente', patientId: 'p1', fecha: '2026-01-03', syncStatus: 'synced'
  });

  const borradas = await purgarCacheRedundanteImpl();
  assert.equal(borradas, 1, 'solo la copia redundante y vieja');

  assert.equal(await localDb.cache.get('remote:c-sincronizada'), undefined);
  assert.ok(await localDb.cache.get('remote:c-pendiente'),
    'si la consulta local aun no subio, la cache es respaldo: no se borra');
  assert.ok(await localDb.cache.get('remote:solo-cache'),
    'si el dato solo vive en la cache, borrarlo lo perderia');
  assert.ok(await localDb.cache.get('remote:c-reciente'),
    'la retencion protege las copias recientes');
});

test('mantenimiento: corre como maximo una vez al dia', async () => {
  await reset();
  const ahora = Date.now();

  await setMeta('mantenimientoUltimo', ahora);
  const primera = await ejecutarMantenimientoImpl({ ahora });
  assert.equal(primera.omitido, true);

  const forzada = await ejecutarMantenimientoImpl({ ahora, forzar: true });
  assert.equal(forzada.omitido, false);
  assert.equal(await getMeta('mantenimientoUltimo'), ahora);

  const pasadas24h = ahora + 25 * 60 * 60 * 1000;
  const segunda = await ejecutarMantenimientoImpl({ ahora: pasadas24h });
  assert.equal(segunda.omitido, false);
});

test('mantenimiento: guarda un resumen de lo que libero', async () => {
  await reset();
  await localDb.attachments.put(
    adjunto({ id: 'viejo', status: 'uploaded', dias: DIAS_ADJUNTOS_SUBIDOS + 1 })
  );

  const resultado = await ejecutarMantenimientoImpl({ forzar: true });
  assert.equal(resultado.adjuntos, 1);

  const resumen = await getMeta('mantenimientoUltimoResumen');
  assert.equal(resumen.adjuntos, 1);
  assert.ok(resumen.cuando);
});

test('sin navegador no hay medicion de espacio: devuelve null sin romper', async () => {
  await reset();
  assert.equal(await revisarEspacioImpl(), null);
});

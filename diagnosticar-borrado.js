/* ============================================================================
 * DIAGNÓSTICO DEL BORRADO DE UN PACIENTE
 * ============================================================================
 * NO modifica nada: solo imprime qué hay guardado en este dispositivo.
 *
 * USO: abre la app en una PESTAÑA NORMAL (no el icono de la PWA) >
 *      F12 > pestaña Console > pega esto > Enter
 * ========================================================================== */

(async () => {
  console.clear();
  console.log('%c=== DIAGNÓSTICO DE BORRADO ===',
    'background:#7c3aed;color:#fff;padding:6px 12px;font-weight:bold;font-size:14px');

  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('vermas-local');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  const leer = store => new Promise(res => {
    try {
      const q = db.transaction(store, 'readonly').objectStore(store).getAll();
      q.onsuccess = () => res(q.result || []);
      q.onerror = () => res([]);
    } catch { res([]); }
  });

  const [meta, consultas, pacientes, cache, outbox] = await Promise.all(
    ['meta', 'consultations', 'patients', 'cache', 'outbox'].map(leer)
  );

  // OBJETIVO: el nombre (o parte) del paciente que sigue apareciendo.
  const OBJETIVO = 'PRUEBA';
  const esObjetivo = texto => String(texto || '').toUpperCase().includes(OBJETIVO);

  const cedulas = [...new Set([
    ...pacientes.filter(p => esObjetivo(p.nombre)).map(p => p.cedula),
    ...consultas.filter(c => esObjetivo(c.nombre)).map(c => c.cedula),
    ...cache.filter(r => esObjetivo(r.nombre)).map(r => r.cedula)
  ].filter(Boolean))];

  console.log(`Cédulas de "${OBJETIVO}":`, cedulas);
  console.log('Cédulas YA archivadas en este dispositivo:',
    meta.find(m => m.key === 'cedulasArchivadas')?.value ?? '(ninguna)');

  const dato = fila => ({
    id: fila.id, cedula: fila.cedula, patientId: fila.patientId,
    archivedAt: fila.archivedAt, syncStatus: fila.syncStatus
  });

  console.log('\n%cCONSULTAS LOCALES (%d):', 'font-weight:bold', consultas.length);
  consultas.filter(c => cedulas.includes(c.cedula) || esObjetivo(c.nombre))
    .forEach(c => console.log('  ', dato(c)));

  console.log('\n%cFILAS DE LA NUBE (cache, se dibujan en el historial) (%d):', 'font-weight:bold', cache.length);
  cache.filter(r => cedulas.includes(r.cedula) || esObjetivo(r.nombre))
    .forEach(r => console.log('  ', dato(r)));

  console.log('\n%cOPERACIONES EN COLA (%d):', 'font-weight:bold', outbox.length);
  outbox.forEach(o => console.log('  ', { tipo: o.type, entidad: o.entityId, estado: o.status, error: o.lastError }));

  console.log('\n%cQUÉ HAY QUE MIRAR', 'font-weight:bold');
  console.log('  · Si en "CÉDULAS YA ARCHIVADAS" NO aparece la del paciente, por eso sigue en pantalla.');
  console.log('  · Si la consulta local tiene archivedAt pero la fila de la nube no, hay que limpiar la nube.');
  console.log('  · Si hay una operación ARCHIVAR_CONSULTA en "failed", el servidor la está rechazando.');
})();
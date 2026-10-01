/* ============================================================================
 * QUITAR UNA OPERACIÓN ATASCADA DE LA COLA DE SINCRONIZACIÓN
 * ============================================================================
 * Úsalo cuando la barra superior diga "Rechazadas (1)" o similar y NO quieras
 * esa operación: es de prueba, o el servidor ya la resolvió por su cuenta.
 *
 * Solo borra operaciones de la cola de salida. NO toca pacientes, consultas,
 * ventas ni el inventario.
 *
 * USO (en una PESTAÑA NORMAL de Chrome, con la app abierta):
 *   Clic derecho > Inspeccionar > Console > pega esto > Enter
 * ========================================================================== */

(async () => {
  console.clear();
  console.log('%c=== COLA DE SINCRONIZACIÓN ===',
    'background:#0f766e;color:#fff;padding:6px 12px;font-weight:bold;font-size:14px');

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

  const outbox = await leer('outbox');
  if (outbox.length === 0) {
    console.log('%cLa cola está VACÍA. No hay nada que quitar.', 'color:#16a34a;font-weight:bold');
    return;
  }

  console.log(`\nOperaciones en la cola: ${outbox.length}\n`);

  outbox
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .forEach((op, i) => {
      const color = op.status === 'failed' ? '#b91c1c'
        : op.status === 'descartada' ? '#c2410c'
        : op.status === 'conflict' ? '#c2410c' : '#16a34a';
      console.log(`%c${String(i + 1).padStart(2)}. ${op.type}`,
        `color:${color};font-weight:bold`,
        `\n     estado: ${op.status}   intentos: ${op.attempts || 0}`,
        `\n     fecha : ${new Date(op.createdAt).toLocaleString('es-EC')}`,
        op.lastError ? `\n     ERROR : ${String(op.lastError).slice(0, 160)}` : '');
    });

  const r = window.prompt(
    'Escribe el NUMERO de la operación a quitar de la cola.\n(cancela si no quieres borrar nada):',
    ''
  );
  if (r === null) { console.log('%cCancelado. No se borró nada.', 'color:#64748b'); return; }

  const idx = Number(r) - 1;
  const op = outbox[idx];
  if (!op) { console.log('%cNúmero no válido.', 'color:#b91c1c'); return; }

  await new Promise(res => {
    const tx = db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').delete(op.id);
    tx.oncomplete = res;
  });

  console.log('\n%c✓ Quitada de la cola: ' + op.type,
    'background:#16a34a;color:#fff;padding:6px 12px;font-weight:bold');
  console.log('%cNo se tocó ningún paciente, consulta ni venta.', 'color:#16a34a');
  setTimeout(() => location.reload(), 1000);
})();

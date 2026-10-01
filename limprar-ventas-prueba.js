/* ============================================================================
 * LIMPIAR VENTAS DE PRUEBA QUE NO SE PUDIERON SINCRONIZAR
 * ============================================================================
 * 21 operaciones quedaron atascadas por un bug ya corregido (un id de
 * inventario no numérico se enviaba como null). Su payload está corrupto y no
 * se van a recuperar.
 *
 * ⚠️ No basta con vaciar la Outbox: las ventas siguen en IndexedDB con
 * syncStatus='pending' y, como el servidor nunca las recibió, el pull NO las
 * sobrescribe (localRepository.js:623). Quedarían fantasma, visibles y sin
 * poder subir nunca. Por eso esto borra la cola Y los datos de la venta.
 *
 * USO: abre la app, consola (F12), pega esto, Enter. Pide confirmación.
 * ========================================================================== */

(async () => {
  console.clear();
  console.log('%c=== LIMPIEZA DE VENTAS DE PRUEBA ===',
    'background:#b91c1c;color:#fff;padding:6px 12px;font-weight:bold;font-size:14px');

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
  const borrar = (store, ids) => new Promise((res, rej) => {
    if (!ids.length) return res(0);
    const tx = db.transaction(store, 'readwrite');
    const st = tx.objectStore(store);
    ids.forEach(id => st.delete(id));
    tx.oncomplete = () => res(ids.length);
    tx.onerror = () => rej(tx.error);
  });

  const [outbox, ventas, pagos, items, movs] = await Promise.all(
    ['outbox', 'sales', 'payments', 'saleItems', 'inventoryMovements'].map(leer)
  );

  // Solo las YA FALLIDAS. Las 'pending' o 'conflict' son trabajo real por subir.
  const fallidas = outbox.filter(o => o.status === 'failed' || o.status === 'descartada');
  if (fallidas.length === 0) {
    console.log('%cNo hay operaciones fallidas. Nada que limpiar.', 'color:#16a34a;font-weight:bold');
    return;
  }
  const ventaIds = [...new Set(fallidas
    .map(o => o.payload?.p_pedido_id || o.payload?.p_venta_id || o.entityId).filter(Boolean))];

  console.log(`\n%c1. RESUMEN`, 'font-weight:bold;color:#b91c1c');
  console.log(`   ${fallidas.length} de ${outbox.length} operaciones fallidas`);

  console.log(`\n%c2. VENTAS AFECTADAS`, 'font-weight:bold;color:#b91c1c');
  for (const id of ventaIds) {
    const v = ventas.find(x => x.id === id);
    const ops = fallidas.filter(o =>
      (o.payload?.p_pedido_id || o.payload?.p_venta_id || o.entityId) === id);
    console.log(`\n   ${id.slice(0, 8)}…  (${ops.length} ops)`,
      `\n     paciente : ${v ? (v.nombre || '(sin nombre)') : '⚠ NO ESTA EN LA BASE LOCAL'}`,
      `\n     fecha    : ${v ? v.fecha : '-'}    monto: ${v ? '$' + Number(v.venta || 0).toFixed(2) : '-'}`,
      `\n     estado   : ${v ? v.estado : '-'}   ops: ${[...new Set(ops.map(o => o.type))].join(', ')}`);
    if (v && v.nombre && v.nombre !== 'CONSUMIDOR FINAL') {
      console.log('     ⚠ Tiene nombre real: confirma que era una prueba.', 'color:#c2410c;font-weight:bold');
    }
  }

  const pagosABorrar = [...new Set(pagos.filter(p => ventaIds.includes(p.saleId || p.pedido_id)).map(p => p.id))];
  const itemsABorrar = items.filter(i => ventaIds.includes(i.saleId)).map(i => i.id);
  const movsABorrar = movs.filter(m => ventaIds.includes(m.saleId)).map(m => m.id);

  console.log(`\n%c3. SE BORRARA`, 'font-weight:bold;color:#b91c1c');
  console.log(`   operaciones: ${fallidas.length}   ventas: ${ventaIds.length}` +
              `   pagos: ${pagosABorrar.length}   items: ${itemsABorrar.length}   movimientos: ${movsABorrar.length}`);
  console.log('%c   Se conservan: datos ya sincronizados, inventario y tarifario.',
    'color:#16a34a');

  if (window.prompt(`Se borraran ${fallidas.length} operaciones y ${ventaIds.length} ventas.\nEscribe SI para confirmar:`, '') !== 'SI') {
    console.log('%cCancelado. No se borro nada.', 'color:#64748b;font-weight:bold');
    return;
  }

  const r = {
    operaciones: await borrar('outbox', fallidas.map(o => o.id)),
    ventas: await borrar('sales', ventaIds),
    pagos: await borrar('payments', pagosABorrar),
    items: await borrar('saleItems', itemsABorrar),
    movimientos: await borrar('inventoryMovements', movsABorrar)
  };
  console.log('\n%c✓ LIMPIEZA COMPLETADA',
    'background:#16a34a;color:#fff;padding:6px 12px;font-weight:bold');
  Object.entries(r).forEach(([k, v]) => console.log(`   ${k}: ${v}`));
  console.log('\n%cRecargando...', 'color:#0f766e;font-weight:bold');
  setTimeout(() => location.reload(), 1200);
})();

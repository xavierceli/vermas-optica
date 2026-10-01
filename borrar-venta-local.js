/* ============================================================================
 * BORRAR UNA VENTA DE PRUEBA QUE NO PUEDES ANULAR DESDE LA APP
 * ============================================================================
 *
 * POR QUE PASA
 * La pantalla de Pedidos mezcla consultas clinicas (que no tienen venta) con
 * ventas reales. Cuando intentas "Cancelar" sobre una consulta sin venta local,
 * la app responde "Este registro todavia no tiene una venta local": no es un
 * fallo, es que ese registro nunca fue una venta en este dispositivo.
 *
 * QUE HACE
 * Permite borrar una fila concreta por su cedula o su nombre, eliminando de la
 * base local la consulta, la venta y sus operaciones pendientes. Despues hay que
 * recargar para que la lista se actualice.
 *
 * ⚠️ BORRA DATOS. El script pide confirmacion y muestra que va a eliminar.
 *
 * USO
 * 1. Abre la app en una PESTAÑA NORMAL de Chrome (no el icono de la PWA: ahi
 *    F12 esta deshabilitado).
 * 2. Abre la consola: clic derecho en la pagina > "Inspeccionar", o
 *    Ctrl+Shift+I.
 * 3. Pega este archivo y presiona Enter.
 * 4. Escribe el nombre o cedula de la venta a borrar cuando lo pida.
 * ========================================================================== */

(async () => {
  console.clear();
  console.log('%c=== BORRAR VENTA DE PRUEBA ===',
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

  const [consultations, sales, patients] = await Promise.all(
    ['consultations', 'sales', 'patients'].map(leer)
  );

  console.log(`\nConsultas: ${consultations.length}   Ventas: ${sales.length}`);

  // Se listan los candidatos: los que tienen algo vendible o un monto.
  const candidatos = sales.map(s => {
    const consulta = consultations.find(c => c.id === s.consultationId) || {};
    const paciente = patients.find(p => p.id === (s.patientId || consulta.patientId)) || {};
    return { ...s, ...paciente, ...consulta, _consulta: consulta, _paciente: paciente };
  }).filter(v => v.cedula);

  console.log(`\n%cVENTAS LOCALES (candidatas)`, 'font-weight:bold;color:#b91c1c');
  if (candidatos.length === 0) {
    console.log('%cNo hay ventas locales. Las que ves en Pedidos vienen solo del servidor.',
      'color:#c2410c');
  }
  candidatos.forEach((v, i) => {
    const monto = Number(v.venta || 0).toFixed(2);
    const abono = Number(v.abono || 0).toFixed(2);
    const saldo = (Number(monto) - Number(abono)).toFixed(2);
    console.log(`  ${String(i + 1).padStart(2)}. ${v.nombre || '(sin nombre)'} — cedula ${v.cedula}`,
      `\n      monto $${monto}  abonado $${abono}  saldo $${saldo}  fecha ${v.fecha || '-'}`,
      `\n      id: ${v.id}`);
  });

  if (candidatos.length === 0) return;

  const seleccion = window.prompt(
    'Escribe el NUMERO de la venta a borrar (de la lista de arriba), o cancela:',
    ''
  );
  if (seleccion === null) { console.log('%cCancelado.', 'color:#64748b'); return; }

  const idx = Number(seleccion) - 1;
  if (!candidatos[idx]) { console.log('%cNumero no valido.', 'color:#b91c1c'); return; }
  const v = candidatos[idx];

  const ok = window.prompt(
    `Se va a BORRAR:\n  ${v.nombre}\n  cedula ${v.cedula}\n  monto $${Number(v.venta || 0).toFixed(2)}\n\nEscribe SI para confirmar:`,
    ''
  );
  if (ok !== 'SI') { console.log('%cCancelado. No se borro nada.', 'color:#64748b'); return; }

  const borrar = (store, ids) => new Promise(res => {
    if (!ids.length) return res(0);
    const tx = db.transaction(store, 'readwrite');
    const st = tx.objectStore(store);
    ids.forEach(id => st.delete(id));
    tx.oncomplete = () => res(ids.length);
  });

  const outbox = await leer('outbox');
  const r = {
    'Operaciones de cola': await borrar('outbox',
      outbox.filter(o => (o.payload?.p_venta_id === v.id || o.payload?.p_pedido_id === v.id)).map(o => o.id)),
    'Ventas': await borrar('sales', [v.id]),
    'Consultas': v._consulta?.id ? await borrar('consultations', [v._consulta.id]) : 0,
    'Pagos': await borrar('payments', (await leer('payments')).filter(p => p.saleId === v.id).map(p => p.id)),
    'Items': await borrar('saleItems', (await leer('saleItems')).filter(i => i.saleId === v.id).map(i => i.id))
  };

  console.log('\n%c✓ BORRADO', 'background:#16a34a;color:#fff;padding:6px 12px;font-weight:bold');
  Object.entries(r).forEach(([k, n]) => console.log(`   ${k}: ${n}`));
  console.log('\n%cRecargando...', 'color:#0f766e;font-weight:bold');
  setTimeout(() => location.reload(), 1200);
})();

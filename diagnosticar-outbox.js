/* ============================================================================
 * DIAGNÓSTICO DE LA COLA DE SINCRONIZACIÓN
 * ============================================================================
 *
 * CÓMO USARLO
 * 1. Abre la app e inicia sesión.
 * 2. Abre la consola: F12 en Chrome/Edge, Ctrl+Shift+J.
 * 3. Copia TODO este archivo, pégalo en la consola y presiona Enter.
 *
 * NO modifica nada: solo lee e imprime qué hay en la cola de salida.
 * ========================================================================== */

(async () => {
  console.clear();
  console.log('%c=== DIAGNÓSTICO DE LA COLA DE SINCRONIZACIÓN ===',
    'background:#0f766e;color:#fff;padding:6px 12px;font-weight:bold;font-size:14px');

  // --- 1. Red y sesión ------------------------------------------------------
  const enLinea = navigator.onLine;
  console.log(`\n%c1. RED Y SESIÓN`, 'font-weight:bold;color:#0f766e');
  console.log(`   Conectado a internet : ${enLinea ? 'SÍ' : 'NO'}`);

  let sesion;
  try {
    const clave = Object.keys(localStorage).find(k => k.includes('auth-token'));
    if (!clave) sesion = 'SIN SESIÓN (entraste con el PIN local)';
    else {
      const datos = JSON.parse(localStorage.getItem(clave));
      const exp = datos?.expires_at ? new Date(datos.expires_at * 1000) : null;
      sesion = exp && exp > new Date()
        ? `ACTIVA (caduca ${exp.toLocaleString('es-EC')})`
        : 'CADUCADA → hay que volver a entrar';
    }
  } catch (e) { sesion = 'NO SE PUDO LEER: ' + e.message; }
  console.log(`   Sesión de servidor  : ${sesion}`);

  // --- 2. Leer la cola ------------------------------------------------------
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
  console.log(`\n%c2. COLA DE SALIDA (outbox)`, 'font-weight:bold;color:#0f766e');
  console.log(`   Operaciones en total: ${outbox.length}`);

  if (outbox.length === 0) {
    console.log('%c   La cola está VACÍA.', 'color:#16a34a;font-weight:bold');
    return;
  }

  // --- 3. Agrupación -------------------------------------------------------
  const agrupar = campo => outbox.reduce((acc, op) => {
    acc[op[campo]] = (acc[op[campo]] || 0) + 1; return acc;
  }, {});

  console.log('\n   Por estado:');
  Object.entries(agrupar('status')).forEach(([k, n]) => console.log(
    `     ${String(n).padStart(3)} × ${k}`,
    `color:${k === 'failed' ? '#b91c1c' : k === 'conflict' ? '#c2410c' : '#ca8a04'}`));

  console.log('\n   Por tipo:');
  Object.entries(agrupar('type')).sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`     ${String(n).padStart(3)} × ${k}`));

  // --- 4. Detalle ----------------------------------------------------------
  console.log(`\n%c3. DETALLE`, 'font-weight:bold;color:#0f766e');
  outbox.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .forEach((op, i) => console.log(
      `%c${String(i + 1).padStart(2)}. ${op.type}`,
      `color:${op.status === 'failed' ? '#b91c1c' : op.status === 'conflict' ? '#c2410c' : '#ca8a04'};font-weight:bold`,
      `\n    entidad: ${op.entityId}   estado: ${op.status}   intentos: ${op.attempts || 0}`,
      `\n    creada : ${new Date(op.createdAt).toLocaleString('es-EC')}`,
      op.lastError ? `\n    ERROR  : ${String(op.lastError).slice(0, 200)}` : ''));

  // --- 5. Diagnóstico ------------------------------------------------------
  const fallidas = outbox.filter(o => o.status === 'failed');
  const conflictos = outbox.filter(o => o.status === 'conflict');
  console.log(`\n%c4. DIAGNÓSTICO`, 'font-weight:bold;color:#0f766e');

  if (fallidas.length) {
    console.log(`%c   ⚠ ${fallidas.length} FALLIDA(s): se reintentan cada 30 s para siempre.`,
      'color:#b91c1c;font-weight:bold');
    [...new Set(fallidas.map(o => String(o.lastError).slice(0, 120)))]
      .forEach(m => console.log(`       → ${m}`, 'color:#b91c1c'));
  }
  if (conflictos.length) {
    console.log(`%c   ⚠ ${conflictos.length} CONFLICTO(s): requieren revisión manual.`,
      'color:#c2410c;font-weight:bold');
  }
  if (!fallidas.length && !conflictos.length) {
    if (!enLinea) console.log('%c   Sin internet: se subirán al reconectar.', 'color:#ca8a04');
    else if (sesion.startsWith('SIN')) {
      console.log('%c   Entraste con el PIN local: NO hay sesión del servidor.', 'color:#7c3aed;font-weight:bold');
      console.log('     Cierra sesión y entra con correo y contraseña para subir la cola.');
    } else console.log('%c   Pulsa "Sincronizar ahora".', 'color:#16a34a');
  }

  // --- 6. Limpieza ---------------------------------------------------------
  console.log(`\n%c5. PARA DESCARTAR LA COLA`, 'font-weight:bold;color:#0f766e');
  console.log('   ⚠ Borra lo pendiente SIN subirlo. Solo si ya no quieres esos cambios.');
  console.log(`
   indexedDB.deleteDatabase('vermas-local'); location.reload();

   Para vaciar SOLO lo fallido, ejecuta diagnoseOutbox.soloFallidas()
  `);
  globalThis.diagnoseOutbox = {
    outbox, db, leer,
    async soloFallidas() {
      const ids = outbox.filter(o => o.status === 'failed').map(o => o.id);
      await new Promise(res => {
        const tx = db.transaction('outbox', 'readwrite');
        const st = tx.objectStore('outbox');
        ids.forEach(id => st.delete(id));
        tx.oncomplete = res;
      });
      console.log(`Descartadas ${ids.length} operaciones fallidas.`);
      location.reload();
    },
    /**
     * Si la consola muestra "[cola] falla importLegacyCache" en bucle, el flag
     * de migración nunca se pudo escribir. Esto lo marca como hecho para que
     * la app deje de reintentarlo. NO borra datos: solo la tarea opcional de
     * migrar un cache de una versión vieja.
     */
    async pararBucleMigracion() {
      await new Promise(res => {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({
          key: 'legacyCacheImported', value: true, updatedAt: new Date().toISOString()
        });
        tx.oncomplete = res;
      });
      console.log('%cFlag de migración marcado. Recargando...', 'color:#16a34a;font-weight:bold');
      setTimeout(() => location.reload(), 800);
    }
  };
  console.log('\n%c   Comandos disponibles:', 'color:#0f766e;font-weight:bold');
  console.log('     diagnoseOutbox.soloFallidas()   → vacía solo lo que falló');
  console.log('     diagnoseOutbox.pararBucleMigracion() → corta el bucle de importLegacyCache');
})();

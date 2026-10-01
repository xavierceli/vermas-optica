/* ============================================================================
 * DIAGNÓSTICO DE LAS FOTOS DEL INVENTARIO
 * ============================================================================
 * Dice exactamente qué hay guardado en cada producto y si la foto se puede
 * firmar. No modifica nada.
 *
 * USO: abre la app en una PESTAÑA NORMAL -> clic derecho > Inspeccionar >
 *      pestaña Console -> pega esto -> Enter
 * ========================================================================== */

/** Supabase guarda la sesion en localStorage bajo una clave que incluye auth-token. */
function leerToken() {
  try {
    const clave = Object.keys(localStorage).find(k => k.includes('auth-token'));
    if (!clave) return null;
    const datos = JSON.parse(localStorage.getItem(clave));
    return datos?.access_token || datos?.currentSession?.access_token || null;
  } catch { return null; }
}
(async () => {
  console.clear();
  console.log('%c=== DIAGNÓSTICO DE FOTOS DEL INVENTARIO ===',
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

  const inventario = await leer('inventory');
  console.log(`\nProductos en total: ${inventario.length}`);

  const conFotoDeclarada = inventario.filter(i => i && i.imagen_url);
  console.log(`Productos con "imagen_url" informada: ${conFotoDeclarada.length}`);

  if (conFotoDeclarada.length === 0) {
    console.log('\n%cNINGUN producto declara imagen_url.', 'color:#b91c1c;font-weight:bold');
    console.log('%cSi antes se veian las fotos, puede que nunca se subieran al', 'color:#b91c1c');
    console.log('%cbucket o que se perdieran al editar productos.', 'color:#b91c1c');
    return;
  }

  console.log('\n%cQUÉ HAY GUARDADO (las 6 primeras):', 'font-weight:bold;color:#7c3aed');
  conFotoDeclarada.slice(0, 6).forEach(i => {
    console.log(`  ${i.codigo || i.nombre_accesorio || '(sin código)'}`);
    console.log(`     imagen_url = ${JSON.stringify(i.imagen_url)}`);
  });

  const clasificar = v => {
    const t = String(v || '').trim();
    if (!t) return 'VACIO';
    if (t.startsWith('http') && t.includes('/object/public/')) return 'URL PUBLICA (obsoleta, bucket ya es privado)';
    if (t.startsWith('http')) return 'URL (otro formato)';
    if (t.startsWith('inventario_imagenes/')) return 'RUTA CON EL BUCKET DENTRO (se recorta al firmar)';
    return 'RUTA (correcto)';
  };
  const formatos = conFotoDeclarada.reduce((a, i) => {
    const k = clasificar(i.imagen_url); a[k] = (a[k] || 0) + 1; return a;
  }, {});
  console.log('\n%cFORMATO DE LO GUARDADO:', 'font-weight:bold;color:#7c3aed');
  Object.entries(formatos).forEach(([k, n]) => console.log(`  ${String(n).padStart(3)} × ${k}`));
  console.log('\n%cPROBANDO FIRMAR Y BAJAR LAS PRIMERAS FOTOS...', 'font-weight:bold;color:#7c3aed');
  const token = leerToken();
  if (!token) {
    console.log('%c  No se encontro el token de sesion en localStorage.', 'color:#b91c1c;font-weight:bold');
    console.log('%c  Entra con correo y contrasena y vuelve a ejecutar este script.', 'color:#b91c1c');
    return;
  }
  const { data: sesion } = await fetch(
    'https://uaflmzuklixcpqspiyqi.supabase.co/auth/v1/user',
    { headers: { apikey: 'sb_publishable_6OdeKTv6wQwNHok7iOUb0A_bSgZyH7s', Authorization: 'Bearer ' + token } }
  ).then(r => r.ok ? r.json() : null).catch(() => null);
  console.log('  Sesion encontrada: ' + (sesion?.email || 'si'));

  // MISMA normalizacion que src/rutaImagen.js. Importa: createSignedUrl recibe
  // el bucket por separado, asi que la ruta NUNCA debe empezar por
  // "inventario_imagenes". La version anterior de este script usaba
  // partes.slice(idx), que devolvia el bucket DENTRO de la ruta y hacia fallar
  // la firma con HTTP 400 aunque el archivo existiera en el bucket.
  const normalizarRuta = valor => {
    let ruta = String(valor || '').trim();
    if (!ruta) return null;
    if (/^https?:\/\//i.test(ruta)) {
      let pathname;
      try { pathname = new URL(ruta).pathname; } catch { return null; }
      try { ruta = decodeURIComponent(pathname); } catch { ruta = pathname; }
    }
    ruta = ruta
      .replace(/^\/+/, '')
      .replace(/^\/?(?:storage\/v1\/)?(?:object\/(?:public|sign|authenticated)|render\/image\/(?:public|authenticated))\//i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/{2,}/g, '/')
      .replace(/\/+$/, '');
    while (ruta.slice(0, 21).toLowerCase() === 'inventario_imagenes/') ruta = ruta.slice(21);
    return ruta || null;
  };

  for (const item of conFotoDeclarada.slice(0, 3)) {
    console.log('\n  ' + (item.codigo || item.nombre_accesorio || '(sin codigo)'));
    const ruta = normalizarRuta(item.imagen_url);
    console.log('     ruta a firmar  : ' + ruta);
    if (!ruta) {
      console.log('     No se pudo normalizar el valor guardado', 'color:#b91c1c;font-weight:bold');
      continue;
    }
    try {
      const r = await fetch(
        'https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/sign/inventario_imagenes/' + encodeURI(ruta),
        { method: 'POST', headers: { apikey: 'sb_publishable_6OdeKTv6wQwNHok7iOUb0A_bSgZyH7s', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) }
      );
      const cuerpo = await r.json();
      if (!r.ok) {
        console.log('     Firmar fallo (HTTP ' + r.status + '): ' + (cuerpo.message || cuerpo.error || 'sin detalle'), 'color:#b91c1c;font-weight:bold');
        continue;
      }
      console.log('     Firma OK');
      const descarga = await fetch(cuerpo.signedURL);
      console.log('     Descarga: HTTP ' + descarga.status,
        descarga.status === 200 ? 'ARCHIVO EXISTE' : 'NO EXISTE O SIN PERMISO',
        descarga.status === 200 ? 'color:#16a34a;font-weight:bold' : 'color:#b91c1c;font-weight:bold');
    } catch (e) {
      console.log('     Error de red: ' + e.message, 'color:#b91c1c');
    }
  }
  console.log('\n%cINTERPRETACIÓN', 'font-weight:bold;color:#7c3aed');
  console.log('%c  - Firma 200 + Descarga 200 : el archivo EXISTE. La app ya lo', 'color:#16a34a');
  console.log('%c    resuelve con la ruta correcta; actualiza y deberia verse.', 'color:#16a34a');
  console.log('%c  - Firma 400                : ruta mal construida o el archivo NO', 'color:#b91c1c');
  console.log('%c    esta en el bucket. Si "ruta a firmar" se ve correcta, hay que', 'color:#b91c1c');
  console.log('%c    volver a subir la foto de ese producto.', 'color:#b91c1c');
  console.log('%c  - Firma 403                : tu usuario no tiene la politica', 'color:#b91c1c');
  console.log('%c    "ver_inventario_imagenes".', 'color:#b91c1c');
})();
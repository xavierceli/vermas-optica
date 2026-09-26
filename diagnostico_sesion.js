(async () => {
  const K = 'uaflmzuklixcpqspiyqi';
  const KEY = `sb-${K}-auth-token`;
  const crudo = localStorage.getItem(KEY);
  console.log('--- 1. Sesion en localStorage ---');
  if (!crudo) { console.log('NO EXISTE la sesion guardada. Eso explica el 403: la app va como anon.'); }
  else {
    const s = JSON.parse(crudo);
    const exp = new Date(s.expires_at * 1000);
    console.log('expira:', exp.toLocaleString(), '| ya caduco:', exp < new Date());
    console.log('--- 2. Que dice el servidor ---');
    const r = await fetch(`https://${K}.supabase.co/auth/v1/user`, {
      headers: { apikey: 'sb_publishable_6OdeKTv6wQwNHok7iOUb0A_bSgZyH7s', Authorization: 'Bearer ' + s.access_token }
    });
    console.log('estado:', r.status, r.status === 200 ? '(token valido)' : '(token RECHAZADO)');
    if (r.status !== 200) console.log(await r.text());
  }
  console.log('--- 3. Version que estas ejecutando ---');
  console.log('bundle:', performance.getEntriesByType('resource').map(x => x.name.split('/').pop()).find(n => n.startsWith('index-') && n.endsWith('.js')) || 'no detectado');
  console.log('--- 4. Service workers activos ---');
  console.log((await navigator.serviceWorker.getRegistrations()).map(r => r.active?.scriptURL || r.installing?.scriptURL).join('\n') || 'ninguno');
})();
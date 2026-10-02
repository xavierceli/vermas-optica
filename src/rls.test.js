import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)));
const MIGRACIONES = join(SRC, '..', 'supabase', 'migrations');
const leerRuta = ruta => readFileSync(ruta, 'utf8');
const MIGRACION = '202609240012_rls_solo_lectura.sql';
const TABLAS = ['consultas_clinicas', 'inventario', 'lista_precios', 'pacientes_perfil', 'pedidos_ventas'];
const VISTAS = ['vista_pacientes', 'vista_pacientes_unicos'];

/** El SQL sin comentarios: los comentarios describen lo que se elimina y si se
 *  comprobaran, un test que los leyera daria un falso positivo. */
const sql = () => leerRuta(join(MIGRACIONES, MIGRACION)).replace(/--[^\n]*/g, '');

// Las politicas de la base se crean a mano en el panel de Supabase, asi que no
// aparecen en el codigo: el unico lugar donde quedan escritas es esta
// migracion. Estos tests la vigilan, porque una politica de mas aqui no rompe
// la app de inmediato: la rompe el dia que alguien conceda un permiso.

// --- La migracion deja las tablas en solo lectura -------------------------
test('se van las politicas que permitirian escritura directa', () => {
  for (const tabla of TABLAS) {
    assert.ok(
      sql().includes(`drop policy if exists "Acceso total autenticados" on public.${tabla}`),
      'falta quitar "Acceso total autenticados" de ' + tabla
    );
  }
});

test('cada tabla de negocio queda con UNA politica, y es de solo lectura', () => {
  for (const tabla of TABLAS) {
    assert.match(
      sql(),
      new RegExp(`create policy ${tabla}_lectura_autenticados on public\\.${tabla}\\s+for select to authenticated`),
      'falta la politica de solo lectura de ' + tabla
    );
  }
  assert.ok(
    !/create policy[\s\S]{0,140}\bfor all\b/i.test(sql()),
    'no debe quedar ninguna politica "for all": la que se creo asi permitia '
    + 'INSERT/UPDATE/DELETE a cualquiera con sesion'
  );
  assert.ok(
    !/create policy[\s\S]{0,140}\bto\s+public\b/i.test(sql()),
    'ninguna politica debe abrirse al rol publico'
  );
});

test('las vistas quedan sin permisos de escritura', () => {
  for (const vista of VISTAS) {
    assert.ok(sql().includes(`revoke all on public.${vista} from public, anon, authenticated;`), vista);
    assert.ok(sql().includes(`grant select on public.${vista} to authenticated;`), vista);
    assert.doesNotMatch(
      sql(),
      new RegExp(`(?:create|drop)\\s+policy[^;]*\\bon\\s+public\\.${vista}\\b`, 'i'),
      `${vista} es una vista y no debe tener politicas RLS`
    );
  }
  // PostgreSQL no admite politicas RLS sobre vistas. El acceso se controla
  // mediante GRANT/REVOKE, no con CREATE/DROP POLICY.
  assert.ok(
    !/alter\s+table\s+public\.vista_pacientes(_unicos)?\s+enable\s+row\s+level\s+security/i.test(sql()),
    'PostgreSQL no admite activar RLS directamente sobre vistas'
  );
});

test('anon se queda sin permisos en las tablas de negocio', () => {
  for (const tabla of TABLAS) {
    assert.ok(sql().includes(`revoke all on public.${tabla} from public, anon;`), 'falta el revoke de PUBLIC/anon en ' + tabla);
  }
});

test('el historial de revisiones se queda sin ningun permiso, no solo sin SELECT', () => {
  // La RLS sin politicas ya lo bloquea todo, pero los permisos heredados de
  // escritura eran una mina para el dia que se exponga el historial en la app.
  assert.ok(
    sql().includes('revoke all on public.consultas_clinicas_revisiones from public, anon, authenticated;'),
    'debe revocarse TODO, no solo SELECT'
  );
});

// --- Limpieza puntual de un paciente de prueba ---------------------------
test('la migracion de limpieza archiva por id explicito y es idempotente', () => {
  const fuente = leerRuta(join(MIGRACIONES, '202609240013_archiva_consultas_prueba.sql'));
  // Por id y no por cedula: los ids son los del servidor y no dependen de como
  // este escrito el documento en cada ficha.
  assert.match(fuente, /where archived_at is null/i, 'debe tocar solo lo que falta archivar');
  assert.match(fuente, /set archived_at = now\(\)/i);
  for (const sufijo of ['1a0298a0', '25157037', '84deef12', 'd7cf3787']) {
    assert.ok(fuente.includes(sufijo), 'falta la consulta ' + sufijo);
  }
  assert.ok(
    !/delete\s+from/i.test(fuente),
    'esta migracion archiva, nunca borra: el historial clinico no se elimina'
  );
});

// --- Y la app sigue sin escribir nunca directamente -----------------------
test('la app NO escribe en ninguna tabla: todo entra por funciones del servidor', () => {
  const escrituras = [];
  for (const archivo of readdirSync(SRC).filter(f => /\.(js|jsx)$/.test(f) && !f.includes('.test.'))) {
    const fuente = leerRuta(join(SRC, archivo));
    const patron = /\.from\('([a-z_]+)'\)\s*\.(insert|update|delete|upsert)\(/g;
    let m;
    while ((m = patron.exec(fuente)) !== null) {
      escrituras.push(`${archivo}: ${m[1]}.${m[2]}()`);
    }
  }
  assert.deepEqual(
    escrituras,
    [],
    'una escritura directa saltaria la RLS y las validaciones del servidor: ' + escrituras.join(', ')
  );
});

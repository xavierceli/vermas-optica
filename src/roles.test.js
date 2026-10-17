import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// SEPARACION ADMIN / PERSONAL
// ---------------------------------------------------------------------------
// La regla vive en el SERVIDOR (migracion 022): el rol se comprueba dentro de
// las funciones y, ademas, se quita el permiso de llamarlas directamente. Como
// una migracion no se puede probar con node --test (necesita PostgreSQL), aqui
// se vigila el SQL escrito, igual que hace rls.test.js con las politicas. La
// idea es que nadie borre por descuido una de estas lineas de seguridad.
// ---------------------------------------------------------------------------

const MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');

// El SQL sin comentarios: los comentarios describen lo que hace, y si un test
// los leyera podria dar un falso positivo.
const sql = readFileSync(join(MIGRACIONES, '202609240022_roles_admin_personal.sql'), 'utf8')
  .replace(/--[^\n]*/g, '');

const TIPOS_SOLO_ADMIN = [
  'REEMBOLSAR_PAGO', 'ANULAR_VENTA',
  'UPSERT_INVENTARIO', 'ELIMINAR_INVENTARIO',
  'UPSERT_PRECIO', 'ELIMINAR_PRECIO'
];

test('existe la tabla de perfiles y solo admite dos roles', () => {
  assert.match(sql, /create table if not exists public\.perfiles/i);
  assert.match(sql, /rol text not null default 'personal'/i);
  assert.match(sql, /check \(rol in \('admin', 'personal'\)\)/i);
});

test('el rol se decide en el servidor con es_admin()', () => {
  assert.match(sql, /create or replace function public\.es_admin\(\)/i);
  assert.match(sql, /p\.rol = 'admin'/i);
});

test('la app pregunta su propio rol con mi_rol()', () => {
  assert.match(sql, /create or replace function public\.mi_rol\(\)/i);
  assert.match(sql, /coalesce\(/i);
});

test('el despachador rechaza al personal en las operaciones de dinero', () => {
  // El control tiene que estar DENTRO de aplicar_operaciones: esconder el boton
  // en la pantalla no impide llamar a la funcion desde fuera.
  assert.match(sql, /create or replace function public\.aplicar_operaciones\(p_operaciones jsonb\)/i);
  for (const tipo of TIPOS_SOLO_ADMIN) {
    assert.ok(sql.includes(`'${tipo}'`), `el control debe nombrar ${tipo}`);
  }
  assert.match(sql, /and not public\.es_admin\(\) then/i);
  assert.match(sql, /Solo un administrador puede/i);
});

test('las funciones sensibles no se pueden llamar directamente', () => {
  // Sin esto, un usuario con sesion podria saltarse el despachador y llamar a
  // la funcion a mano (la clave publica viaja dentro de la app).
  const esperados = [
    /revoke all on function public\.upsert_inventario\(bigint, jsonb\) from public, anon, authenticated/i,
    /revoke all on function public\.eliminar_inventario\(bigint\) from public, anon, authenticated/i,
    /revoke all on function public\.upsert_precio\(bigint, jsonb\) from public, anon, authenticated/i,
    /revoke all on function public\.eliminar_precio\(bigint\) from public, anon, authenticated/i,
    /revoke all on function public\.reembolsar_pago\(uuid, uuid, numeric, text, text\) from public, anon, authenticated/i,
    /revoke all on function public\.anular_venta\(uuid\) from public, anon, authenticated/i
  ];
  for (const patron of esperados) assert.match(sql, patron);
});

test('borrar un paciente definitivamente exige admin y no se puede esquivar', () => {
  // Se renombra la version actual y se publica un envoltorio con el control.
  assert.match(
    sql,
    /alter function public\.eliminar_paciente_definitivo\(text\) rename to eliminar_paciente_definitivo_impl/i
  );
  const envoltorio = sql.slice(sql.indexOf('create or replace function public.eliminar_paciente_definitivo('));
  assert.match(envoltorio, /if not public\.es_admin\(\) then/i);
  assert.match(envoltorio, /return public\.eliminar_paciente_definitivo_impl\(p_cedula\)/i);
  // La implementacion interna queda sin permiso para nadie salvo el dueño.
  assert.match(
    sql,
    /revoke all on function public\.eliminar_paciente_definitivo_impl\(text\) from public, anon, authenticated/i
  );
});

test('la app queda limitada a 3 usuarios como maximo', () => {
  assert.match(sql, /create or replace function public\.limitar_usuarios_vermas\(\)/i);
  assert.match(sql, /if v_total >= 3 then/i);
  assert.match(sql, /before insert on auth\.users/i);
});

test('el usuario mas antiguo queda de admin; los demas, de personal', () => {
  assert.match(sql, /insert into public\.perfiles \(user_id, rol\)/i);
  assert.match(sql, /row_number\(\) over \(order by u\.created_at, u\.id\) = 1 then 'admin'/i);
  assert.match(sql, /else 'personal'/i);
});

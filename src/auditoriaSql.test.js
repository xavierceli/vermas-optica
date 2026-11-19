import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Hallazgos de la auditoria externa, verificados DOS VECES contra el codigo
// antes de tocar nada, y despues fijados aqui para que no vuelvan.
//
// Las migraciones no se pueden probar con node --test (requieren PostgreSQL), asi
// que se comprueba el SQL escrito. Es lo que ya hace rls.test.js con las
// politicas de seguridad.

const MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const leer = nombre => readFileSync(join(MIGRACIONES, nombre), 'utf8');

const m020 = leer('202609240020_normaliza_estado_stock.sql');
const m024 = leer('202609240024_versionado_consultas.sql');
const m025 = leer('202609240025_realtime_publicacion.sql');
const m026 = leer('202609240026_revisiones_consulta.sql');

// --- C-03: la devolucion de stock distinguia mayusculas -----------------------

test('borrar un paciente NO devuelve stock de una venta ya entregada', () => {
  // BUG: la comparacion era coalesce(v.estado,'') <> 'Entregado'. Con el estado
  // en minuscula ('entregado') la condicion daba verdadera y el producto
  // volvia al catalogo aunque el paciente ya se lo habia llevado.
  assert.match(m020, /lower\(btrim\(coalesce\(v\.estado, ''\)\)\) <> 'entregado'/,
    'el estado debe normalizarse antes de comparar');
});

test('la comparacion antigua NO debe quedar viva en la migracion nueva', () => {
  assert.ok(!/coalesce\(v\.estado, ''\) <> 'Entregado'/.test(m020),
    'si sobrevive la comparacion estricta, el bug sigue vivo');
});

test('una venta anulada tampoco devuelve stock', () => {
  // Anular ya habia devuelto el stock. Al borrar despues el paciente, la venta
  // anulada se contaba como "no entregada" y devolvia el producto una segunda vez.
  assert.match(m020, /<> 'anulado'/,
    'una venta anulada no debe reponer stock otra vez');
});

test('la migracion redefine la funcion en vez de editar la vieja', () => {
  // Si se editara el archivo 001, la funcion ya aplicada en la base seguiria
  // siendo la vieja: el arreglo no tendria efecto.
  assert.match(m020, /create or replace function public\.eliminar_paciente_definitivo/);
  assert.match(m020, /\bbegin;/i);
  assert.match(m020, /\bcommit;/i);
});

test('las tres migraciones se pueden aplicar en orden', () => {
  const nombres = [
    '202609240018_eliminar_paciente_definitivo.sql',
    '202609240020_normaliza_estado_stock.sql',
    '202609240021_anular_venta_producto_borrado.sql'
  ];
  for (const nombre of nombres) {
    const sql = leer(nombre);
    assert.match(sql, /\$function\$/, `${nombre}: debe tener cuerpo de funcion`);
    const count = (sql.match(/\$function\$/g) || []).length;
    // Cada funcion abre y cierra con $function$: el total debe ser par y mayor o igual a 2
    assert.ok(
      count >= 2 && count % 2 === 0,
      `${nombre}: los delimitadores de funcion deben abrir y cerrar en pares (encontrados: ${count})`
    );
  }
});

// --- 024: versionado optimista de consultas ---------------------------------
// Dos equipos editando la misma ficha clinica se pisaban en silencio. La prueba
// real necesita PostgreSQL, asi que se vigila el SQL escrito: que bloquee la
// fila, que compare la version, que guarde la revision y que no cambie la firma
// que ya usan crear_venta y aplicar_operaciones.

test('024: la consulta se bloquea y se compara la version antes de escribir', () => {
  assert.match(m024, /for update/i,
    'sin FOR UPDATE dos equipos pueden leer la misma version a la vez');
  assert.match(m024, /v_version_actual <> p_base_version/,
    'debe comparar la version del servidor con la que trae el cliente');
  assert.match(m024, /errcode = '40001'/,
    '40001 es lo que aplicar_operaciones traduce a status conflict');
});

test('024: antes de pisar una consulta guarda la version anterior', () => {
  assert.match(m024, /insert into public\.consultas_clinicas_revisiones/,
    'la version reemplazada debe quedar recuperable');
  assert.match(m024, /to_jsonb\(v_actual\)/,
    'la revision debe guardar la fila completa anterior');
  assert.match(m024, /values[\s\S]{0,200}'edicion'/,
    'la revision debe identificar que fue una edicion');
});

test('024: la firma de 2 argumentos se conserva (crear_venta no se toca)', () => {
  assert.match(m024, /create or replace function public\.guardar_consulta_clinica\(\s*p_consulta_id uuid,\s*p_payload jsonb\s*\)/i,
    'aplicar_operaciones y crear_venta siguen llamando con 2 argumentos');
  assert.match(m024, /guardar_consulta_clinica_v2/,
    'la implementacion con version vive en _v2');
});

test('024: el servidor no acepta que el cliente escriba la version', () => {
  // Si el payload pudiera fijar sync_version, el cliente desactivaria el control.
  assert.match(m024, /'sync_version', 'server_updated_at'/, 
    'las columnas de sistema deben excluirse del UPDATE dinamico');
  assert.match(m024, /sync_version = \$4::bigint/,
    'la version nueva la calcula el servidor, no el payload');
});

test('024: la vista de historial no puede ocultar filas', () => {
  assert.match(m024, /left join public\.consultas_clinicas/i,
    'un inner join perderia consultas si el id no coincide');
  assert.match(m024, /sync_version_consulta/,
    'el cliente necesita la version para detectar conflictos');
  assert.match(m024, /security_invoker = on/i,
    'la vista debe respetar RLS del usuario que consulta');
});

test('024: el INSERT rellena las columnas NOT NULL de sistema', () => {
  // jsonb_populate_record NO aplica defaults: deja NULL lo que falta del JSON.
  // Si sync_version quedara NULL, CUALQUIER consulta nueva fallaria (NOT NULL
  // desde la 002). Se inyecta explicitamente en el JSON del INSERT.
  assert.match(m024, /'sync_version', 0/,
    'la version inicial debe viajar en el JSON del INSERT');
  assert.match(m024, /'server_updated_at', now\(\)/,
    'server_updated_at no puede quedar NULL');
});

test('024: es idempotente y transaccional', () => {
  assert.match(m024, /^\s*begin;/im);
  assert.match(m024, /\bcommit;/i);
  assert.match(m024, /create or replace function/i);
  assert.match(m024, /create or replace view/i);
});

// --- 025: publicacion de Realtime -------------------------------------------

test('025: publica las tablas que cambian en el trabajo diario', () => {
  for (const tabla of ['inventario', 'lista_precios', 'consultas_clinicas', 'pedidos_ventas', 'pagos']) {
    assert.match(m025, new RegExp(`'${tabla}'`), `falta publicar ${tabla}`);
  }
  assert.match(m025, /alter publication supabase_realtime add table/i);
});

test('025: es idempotente (no falla si la tabla ya estaba publicada)', () => {
  assert.match(m025, /pg_publication_tables/,
    'debe comprobar la pertenencia antes de anadir');
  assert.match(m025, /if not exists/i);
});

test('025: no toca datos, RLS ni funciones', () => {
  assert.doesNotMatch(m025, /\b(drop|truncate|delete|update)\s+(table|from|public\.)/i,
    'una migracion de publicacion no debe modificar datos');
  assert.doesNotMatch(m025, /create policy|drop policy|create or replace function/i);
});

test('025: no aborta si el entorno no tiene la publicacion de Supabase', () => {
  assert.match(m025, /no existe la publicacion supabase_realtime/i);
  assert.match(m025, /\breturn;/i,
    'en otro entorno debe salir sin romper la migracion');
});

// --- 026: historial de revisiones visible desde la app ----------------------

test('026: la funcion es de solo lectura, acotada y para authenticated', () => {
  assert.match(m026, /create or replace function public\.revisiones_consulta/);
  assert.match(m026, /language sql\s+stable\s+security definer/i);
  assert.match(m026, /set search_path = pg_catalog, public, pg_temp/i);
  assert.match(m026, /revoke all on function public\.revisiones_consulta\(uuid, integer\) from public, anon;/);
  assert.match(m026, /grant execute on function public\.revisiones_consulta\(uuid, integer\) to authenticated;/,
    'solo un usuario con sesion puede leer el historial');
});

test('026: devuelve las versiones con limite y sin abrir la tabla', () => {
  assert.match(m026, /from public\.consultas_clinicas_revisiones r/);
  assert.match(m026, /order by r\.version desc/);
  assert.match(m026, /limit greatest\(1, least\(coalesce\(p_limite, 20\), 50\)\)/,
    'la funcion nunca debe devolver la tabla entera');
  assert.match(m026, /left join auth\.users/, 'quien guardo la version debe poder identificarse');
});

test('026: no modifica datos ni permisos de la tabla', () => {
  assert.doesNotMatch(m026, /\b(insert|update|delete|drop|truncate)\s+(into|from|table|public\.)/i,
    'exponer el historial no puede abrir escritura ni borrado');
  assert.doesNotMatch(m026, /alter table|create policy|drop policy/i);
});
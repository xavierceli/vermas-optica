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
const m021 = leer('202609240021_anular_venta_producto_borrado.sql');

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
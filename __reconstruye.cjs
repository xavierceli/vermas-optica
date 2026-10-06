'use strict';
// Reconstruye las migraciones 202609240020 y 202609240021 extrayendo el texto
// REAL de la funcion vigente de su migracion de origen y aplicandole SOLO el
// cambio de la auditoria. Si algo no coincide exactamente 1 vez, aborta sin
// escribir nada. Al final imprime la diff de lineas para verificacion doble.
const fs = require('fs');
const path = require('path');
const M = f => path.join(__dirname, 'supabase', 'migrations', f);
const leer = f => fs.readFileSync(M(f), 'utf8').replace(/\r\n/g, '\n');
const escribir = (f, t) => fs.writeFileSync(M(f), t, 'utf8');
const veces = (t, s) => t.split(s).length - 1;

function extraerFn(cuerpo, reInicio, nombre) {
  const m = cuerpo.match(reInicio);
  if (!m) throw new Error('no se encontro el inicio de ' + nombre);
  const cierre = cuerpo.indexOf('\n$function$;', m.index);
  if (cierre === -1) throw new Error('no se encontro el cierre de ' + nombre);
  return cuerpo.slice(m.index, cierre + '\n$function$;'.length);
}

function cambiarUnico(t, viejo, nuevo, etiqueta) {
  const n = veces(t, viejo);
  if (n !== 1) throw new Error(etiqueta + ': la cadena aparece ' + n + ' veces (esperado 1)');
  return t.replace(viejo, nuevo);
}

function diff(vieja, nueva) {
  const va = vieja.split('\n');
  const na = nueva.split('\n');
  return {
    salidas: va.filter(l => !na.includes(l)),
    entradas: na.filter(l => !va.includes(l))
  };
}

// ------------------------------------------------------------- C-03 -> 020
const m018 = leer('202609240018_eliminar_paciente_definitivo.sql');
if (veces(m018, 'create or replace function public.eliminar_paciente_definitivo') !== 1)
  throw new Error('018: eliminar_paciente_definitivo aparece mas de una vez');

const fn020Original = extraerFn(
  m018,
  /create or replace function public\.eliminar_paciente_definitivo\(p_cedula text\)/,
  'eliminar_paciente_definitivo'
);
let fn020 = fn020Original;

const condVieja = "where m.pedido_id = any(v_pedidos) and coalesce(v.estado, '') <> 'Entregado'";
const condNueva = "where m.pedido_id = any(v_pedidos) and lower(btrim(coalesce(v.estado, ''))) <> 'entregado'";
fn020 = cambiarUnico(fn020, condVieja, condNueva, 'C-03 condicion de estado');

const comViejo = '  -- Ventas no entregadas: los productos vuelven al inventario (salidas menos devoluciones). Las entregadas no.';
const comNuevo = comViejo + '\n  -- C-03: lower/btrim del estado para que "entregado" o "ENTREGADO" no devuelvan stock.';
fn020 = cambiarUnico(fn020, comViejo, comNuevo, 'C-03 comentario');

const cab020 = [
  '-- ---------------------------------------------------------------------------',
  '-- 202609240020 - Borrar paciente: la devolucion de stock distingue mayusculas',
  '-- ---------------------------------------------------------------------------',
  '-- CORRIGE C-03 de la auditoria tecnica.',
  '-- eliminar_paciente_definitivo() (migracion 018) devolvio al inventario los',
  "-- productos de las ventas cuyo estado no era exactamente 'Entregado':",
  "--     coalesce(v.estado, '') <> 'Entregado'",
  "-- Si la venta quedo guardada como 'entregado' (o con espacios), la condicion",
  '-- dio verdadera y el producto ya vendido volvio al catalogo.',
  '-- Esta migracion reemplaza la funcion con la condicion normalizada:',
  "--     lower(btrim(coalesce(v.estado, ''))) <> 'entregado'",
  '-- El resto del cuerpo es el de la migracion 018, sin cambios. No borra ni',
  '-- modifica datos, y los permisos de la funcion no cambian.',
  '-- ---------------------------------------------------------------------------',
  'begin;',
  ''
].join('\n');

escribir('202609240020_normaliza_estado_stock.sql', cab020 + fn020 + '\n\ncommit;\n');

// ------------------------------------------------------------- C-04 -> 021
const m001 = leer('202609240001_p0_integridad.sql');
if (veces(m001, 'create or replace function public.anular_venta') !== 1)
  throw new Error('001: anular_venta aparece mas de una vez');

const fn021Original = extraerFn(
  m001,
  /create or replace function public\.anular_venta\(p_venta_id uuid\)/,
  'anular_venta'
);
let fn021 = fn021Original;

const ancla = '    perform 1 from public.inventario i where i.id = v_item.inventario_id for update;';
const bloqueNuevo = [
  ancla,
  '',
  '    -- C-04: si el producto se borro del catalogo (eliminar_inventario), el for update',
  '    -- no encontro fila: el update de stock afectaria 0 filas sin error y quedaria',
  '    -- un movimiento DEVOLUCION sin existencias. Se aborta la anulacion.',
  '    if not found then',
  "      raise exception 'El producto % ya no existe en el catálogo.', v_item.inventario_id",
  "        using errcode = '23514';",
  '    end if;'
].join('\n');
fn021 = cambiarUnico(fn021, ancla, bloqueNuevo, 'C-04 ancla del for update');

const cab021 = [
  '-- ---------------------------------------------------------------------------',
  '-- 202609240021 - Anular venta: validar que el producto siga en el catalogo',
  '-- ---------------------------------------------------------------------------',
  '-- CORRIGE C-04 de la auditoria tecnica.',
  '-- anular_venta() (migracion 001) bloquea cada producto con:',
  '     perform 1 from public.inventario i where i.id = v_item.inventario_id for update;',
  '-- pero no comprobaba si encontro la fila. Si el producto se borro antes con',
  '-- eliminar_inventario(), el update de stock afectaba 0 filas sin error, se',
  "-- insertaba un movimiento DEVOLUCION y la venta quedaba 'Anulado': descuadre",
  '-- contable silencioso.',
  '-- Esta migracion reemplaza la funcion anadiendo SOLO el if not found. El resto',
  '-- del cuerpo es el de la migracion 001, sin cambios. No borra ni modifica',
  '-- datos, y los permisos de la funcion no cambian.',
  '-- ---------------------------------------------------------------------------',
  'begin;',
  ''
].join('\n');

escribir('202609240021_anular_venta_producto_borrado.sql', cab021 + fn021 + '\n\ncommit;\n');

// ------------------------------------------------------------- Verificacion
const n020 = leer('202609240020_normaliza_estado_stock.sql');
const n021 = leer('202609240021_anular_venta_producto_borrado.sql');

function checar(cond, ok, msg) {
  if (cond !== ok) throw new Error('Sanity fallida: ' + msg);
  console.log('OK  ' + msg);
}

checar((n020.match(/\$function\$/g) || []).length, 2, '020: $function$ abre y cierra (2)');
checar((n021.match(/\$function\$/g) || []).length, 2, '021: $function$ abre y cierra (2)');
checar(/\bbegin;/.test(n020), true, '020: tiene begin;');
checar(/\bcommit;/.test(n020), true, '020: tiene commit;');
checar(/\bbegin;/.test(n021), true, '021: tiene begin;');
checar(/\bcommit;/.test(n021), true, '021: tiene commit;');
checar(/v\.consultation_id/.test(n020), false, '020: NO usa el nombre JS "consultation_id"');
checar(/v\.consulta_id = any\(v_consultas\)/.test(n020), true, '020: usa la columna real "consulta_id"');
checar(/[\u4e00-\u9fff]/.test(n020 + n021), false, '020/021: sin caracteres ajenos al latin');

console.log('\n=== DIFF 020 respecto a la funcion vigente (018) ===');
const d020 = diff(fn020Original, fn020);
d020.salidas.forEach(l => console.log('  - ' + l));
d020.entradas.forEach(l => console.log('  + ' + l));
console.log('(Debe salir exactamente 1 linea quitada y 2 agregadas.)');
console.log('\n=== DIFF 021 respecto a la funcion vigente (001) ===');
const d021 = diff(fn021Original, fn021);
d021.salidas.forEach(l => console.log('  - ' + l));
d021.entradas.forEach(l => console.log('  + ' + l));
console.log('(Debe salir 0 lineas quitadas y solo el bloque if not found.)');
console.log('\nRECONSTRUCCION COMPLETADA');

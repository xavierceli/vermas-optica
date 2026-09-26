-- ===========================================================================
-- DIAGNOSTICO: por que no se puede anular un pedido
-- Ejecutalo en el SQL Editor de Supabase y pega el resultado aqui.
-- No modifica nada: solo SELECT.
-- ===========================================================================

-- 1) ¿Que permisos tiene realmente authenticated hoy?
select
  has_table_privilege('authenticated', 'public.pacientes_perfil', 'SELECT')  as leer_pacientes,
  has_table_privilege('authenticated', 'public.consultas_clinicas', 'SELECT') as leer_consultas,
  has_table_privilege('authenticated', 'public.pedidos_ventas', 'SELECT')   as leer_ventas,
  has_table_privilege('authenticated', 'public.inventario', 'SELECT')        as leer_inventario,
  has_table_privilege('authenticated', 'public.vista_pacientes', 'SELECT')   as leer_vista,
  has_table_privilege('anon', 'public.pacientes_perfil', 'SELECT')          as anon_pacientes;

-- 2) Cuantas ventas NO se pueden anular y por que motivo.
--    'sin items' = venta anterior al ledger P0: el servidor la rechaza siempre.
--    'con pagos'  = tiene abono: requiere reembolso explicito.
select
  case
    when p.abono::numeric > 0 then 'con pagos'
    when (nullif(btrim(coalesce(p.codigo_armazon,'')),'') is not null
       or nullif(btrim(coalesce(p.accesorio_id,'')),'') is not null)
     and not exists (select 1 from public.pedido_items i where i.pedido_id = p.id)
      then 'sin items (anterior a P0)'
    else 'anulable'
  end as motivo,
  count(*) as ventas,
  min(p.fecha) as mas_antigua,
  max(p.fecha) as mas_reciente
from public.pedidos_ventas p
where p.estado <> 'Anulado'
group by 1
order by 2 desc;

-- 3) Listado concreto de las que el servidor rechazara (maximo 30).
select p.id, p.fecha, p.estado, p.abono, p.codigo_armazon, p.accesorio_id,
       (select count(*) from public.pedido_items i where i.pedido_id = p.id) as items
from public.pedidos_ventas p
where p.estado <> 'Anulado'
  and p.abono::numeric <= 0
  and (nullif(btrim(coalesce(p.codigo_armazon,'')),'') is not null
    or nullif(btrim(coalesce(p.accesorio_id,'')),'') is not null)
  and not exists (select 1 from public.pedido_items i where i.pedido_id = p.id)
order by p.fecha desc
limit 30;
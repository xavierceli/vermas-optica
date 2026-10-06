-- ---------------------------------------------------------------------------
-- 202609240020 - La devolucion de stock al borrar un paciente distingue mayusculas
-- ---------------------------------------------------------------------------
-- QUE ARREGLA
--
-- La funcion eliminar_paciente_definitivo() (migracion 018) devuelve al
-- inventario los productos de las ventas que NO estaban entregadas.
--
-- La comparacion anterior era estricta sin normalizar mayusculas/minusculas.
-- Si una venta quedo guardada como 'entregado' (minuscula), la condicion
-- daba verdadera y se devuelven al catalogo monturas que el paciente ya se llevo.
-- El stock quedaba inflado con productos que nadie tiene.
--
-- POR QUE NO BASTABA CON CORREGIR EL TEXTO
--
-- No se edita la migracion 018: ya se aplico en la base de datos y cambiarla
-- a mano no cambiaria la funcion que esta live. Por eso se crea una migracion
-- NUEVA que reemplaza la funcion.
--
-- QUE HACE
--
-- Reemplaza eliminar_paciente_definitivo() con una version que normaliza el
-- estado antes de compararlo: lower(btrim(...)) = 'entregado'.
--
-- QUE NO HACE
--
-- No toca datos. Solo redefine la funcion.
-- ---------------------------------------------------------------------------

begin;

create or replace function public.eliminar_paciente_definitivo(p_cedula text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_pacientes uuid[];
  v_consultas uuid[];
  v_pedidos uuid[];
  v_cobros integer;
  v_archivos text[];
begin
  -- RLS: la funcion corre como postgres, pero se filtra igual por el usuario.
  perform set_config('app.eliminacion_cedula', coalesce(p_cedula, ''), true);

  perform 1 from public.pacientes_perfil p
   where p.cedula = p_cedula
   order by p.id
   for update;

  select coalesce(array_agg(p.id), '{}') into v_pacientes
    from public.pacientes_perfil p where p.cedula = p_cedula;

  if v_pacientes = '{}' then
    return jsonb_build_object('encontrado', false, 'paciente_ids', '[]'::jsonb,
      'consulta_ids', '[]'::jsonb, 'pedido_ids', '[]'::jsonb, 'archivos', '[]'::jsonb,
      'consultas', 0, 'ventas', 0, 'cobros', 0);
  end if;

  select coalesce(array_agg(c.id), '{}') into v_consultas
    from public.consultas_clinicas c where c.paciente_id = any(v_pacientes);

  select coalesce(array_agg(v.id), '{}') into v_pedidos
    from public.pedidos_ventas v
   where v.paciente_id = any(v_pacientes) or v.consultation_id = any(v_consultas);

  perform 1 from public.consultas_clinicas c where c.id = any(v_consultas) order by c.id for update;
  perform 1 from public.pedidos_ventas v where v.id = any(v_pedidos) order by v.id for update;
  perform 1 from public.inventario i
   where i.id in (select m.inventario_id from public.inventario_movimientos m
                   where m.pedido_id = any(v_pedidos))
   order by i.id for update;

  perform set_config('app.eliminacion_paciente', 'on', true);

  -- Normalizar el estado antes de compararlo
  update public.inventario i
     set stock = i.stock + n.neto,
         sync_version = i.sync_version + 1,
         server_updated_at = now()
    from (
      select m.inventario_id,
             sum(case when m.tipo = 'SALIDA' then m.cantidad else -m.cantidad end) as neto
        from public.inventario_movimientos m
        join public.pedidos_ventas v on v.id = m.pedido_id
       where m.pedido_id = any(v_pedidos)
         and lower(btrim(coalesce(v.estado, ''))) <> 'entregado'
         and lower(btrim(coalesce(v.estado, ''))) <> 'anulado'
       group by m.inventario_id
    ) n
   where i.id = n.inventario_id and n.neto > 0;

  select coalesce(array_agg(distinct x), '{}') into v_archivos from (
    select g.comprobante_path as x
      from public.pagos g
     where g.pedido_id = any(v_pedidos) and btrim(coalesce(g.comprobante_path, '')) <> ''
    union
    select v.comprobante_url
      from public.pedidos_ventas v
     where v.id = any(v_pedidos) and btrim(coalesce(v.comprobante_url, '')) <> ''
  ) q;

  select count(*) into v_cobros from public.pagos g where g.pedido_id = any(v_pedidos);

  delete from public.consultas_clinicas_revisiones where consulta_id = any(v_consultas);
  delete from public.inventario_movimientos where pedido_id = any(v_pedidos);
  delete from public.pagos where pedido_id = any(v_pedidos);
  delete from public.pedido_items where pedido_id = any(v_pedidos);
  delete from public.pedidos_ventas where id = any(v_pedidos);
  delete from public.consultas_clinicas where id = any(v_consultas);
  delete from public.pacientes_perfil where id = any(v_pacientes);

  return jsonb_build_object(
    'encontrado', true,
    'paciente_ids', to_jsonb(v_pacientes),
    'consulta_ids', to_jsonb(v_consultas),
    'pedido_ids', to_jsonb(v_pedidos),
    'archivos', to_jsonb(v_archivos),
    'consultas', array_length(v_consultas, 1),
    'ventas', array_length(v_pedidos, 1),
    'cobros', v_cobros
  );
end;
$function$;

comment on function public.eliminar_paciente_definitivo(text) is
  'Borra un paciente y todo lo suyo. La devolucion de stock normaliza el estado '
  '(lower/btrim) y excluye tambien las ventas anuladas, que ya devolvieron su stock.';

commit;
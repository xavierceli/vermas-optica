-- ---------------------------------------------------------------------------
-- 202609240021 - Anular una venta avisa si el producto ya no esta en el catalogo
-- ---------------------------------------------------------------------------
-- QUE ARREGLA
--
-- En anular_venta() (migracion 001) el bucle de devolucion hace:
--
--     perform 1 from public.inventario i
--      where i.id = v_item.inventario_id for update;
--
-- pero no comprueba si encontro la fila. Si el producto se borro del catalogo
-- despues de la venta (con eliminar_inventario), ese `for update` no bloquea
-- nada, y despues el `update ... set stock = stock + cantidad` afecta CERO filas
-- sin dar error.
--
-- El resultado: la venta queda marcada como 'Anulado', se registra un
-- movimiento 'DEVOLUCION' en inventario_movimientos, y el stock NO se repone.
-- El ledger dice que se devolvio algo que en realidad no volvio, y nadie se
-- entera. Quedan movimientos contables que no corresponden a existencias reales.
--
-- QUE HACE ESTA MIGRACION
--
-- Reemplaza anular_venta() para que:
--   1. Compruebe con `if not found` que el producto sigue en el catalogo.
--   2. Si falta, avise con un error CLARO en vez de dejar el descuadre mudo.
--
-- Se eligio avisar y no devolver stock silenciosamente porque, si el producto
-- ya no existe, "devolverlo" no significa nada: no hay fila a la que sumarle.
-- Inventariar un producto inexistente seria inventar existencias.
--
-- NO se edita la migracion 001: ya esta aplicada en la base de datos y cambiarla
-- en el archivo no cambiaria la funcion que esta live.
-- ---------------------------------------------------------------------------

begin;

create or replace function public.anular_venta(p_venta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_usuario uuid := auth.uid();
  v_estado text;
  v_abono numeric;
  v_item record;
  v_movimiento_id bigint;
  v_insertados integer;
  v_faltantes text[] := '{}';
begin
  if v_usuario is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;

  select p.estado, public._p0_numero(p.abono)
    into v_estado, v_abono
    from public.pedidos_ventas p
   where p.id = p_venta_id
   for update;

  if not found then
    raise exception 'El pedido % no existe.', p_venta_id using errcode = 'P0002';
  end if;
  if v_estado = 'Anulado' then
    return jsonb_build_object('venta_id', p_venta_id, 'anulada', true);
  end if;
  if v_abono > 0 then
    raise exception 'La venta % tiene pagos y no puede anularse sin un reembolso explícito.', p_venta_id
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.pedidos_ventas p
     where p.id = p_venta_id
       and (nullif(btrim(coalesce(p.codigo_armazon, '')), '') is not null
         or nullif(btrim(coalesce(p.accesorio_id, '')), '') is not null)
       and not exists (select 1 from public.pedido_items i where i.pedido_id = p_venta_id)
  ) then
    raise exception 'La venta % es anterior al ledger P0 y no tiene detalle de stock; requiere reconciliación manual.', p_venta_id
      using errcode = '23514';
  end if;

  for v_item in
    select i.inventario_id, i.cantidad
      from public.pedido_items i
     where i.pedido_id = p_venta_id
     order by i.inventario_id
  loop
    perform 1 from public.inventario i where i.id = v_item.inventario_id for update;

    -- CORRECCION: antes no se comprobaba. Si el producto se borro del catalogo,
    -- el update de mas abajo afectaba 0 filas y el movimiento de devolucion se
    -- lo registraba igualmente: el ledger decia que el stock habia vuelto, cuando
    -- en realidad no habia vuelto a ninguna parte.
    if not found then
      v_faltantes := v_faltantes || v_item.inventario_id::text;
      continue;
    end if;

    if not exists (
      select 1
        from public.inventario_movimientos m
       where m.pedido_id = p_venta_id
         and m.inventario_id = v_item.inventario_id
         and m.tipo = 'SALIDA'
         and m.cantidad = v_item.cantidad
    ) then
      raise exception 'No existe una salida de stock coincidente para el producto %.', v_item.inventario_id
        using errcode = '23514';
    end if;

    insert into public.inventario_movimientos (
      pedido_id, inventario_id, tipo, cantidad, created_by
    ) values (
      p_venta_id, v_item.inventario_id, 'DEVOLUCION', v_item.cantidad, v_usuario
    )
    on conflict (pedido_id, tipo, inventario_id) do nothing
    returning id into v_movimiento_id;

    get diagnostics v_insertados = row_count;
    if v_insertados = 1 then
      update public.inventario i
         set stock = i.stock + v_item.cantidad
       where i.id = v_item.inventario_id;
    end if;
  end loop;

  -- Si habia productos que ya no estan en el catalogo, se aborta ANTES de marcar
  -- la venta como anulada. Asi no queda una venta 'Anulado' con una devolucion a
  -- medias, y el optometrista sabe exactamente que producto falta reponer.
  if v_faltantes <> '{}' then
    raise exception 'No se puede anular: el producto % ya no existe en el catálogo. Reingrésalo con su stock antes de anular la venta.', array_to_string(v_faltantes, ', ')
      using errcode = '23514';
  end if;

  perform set_config('app.transaccion_pedido', 'anular_venta', true);
  update public.pedidos_ventas set estado = 'Anulado' where id = p_venta_id;

  return jsonb_build_object('venta_id', p_venta_id, 'anulada', true);
end;
$function$;

comment on function public.anular_venta(uuid) is
  'Anula una venta y repone el stock. Si un producto de la venta ya no esta en el '
  'catalogo, aborta con un error claro en vez de registrar una devolucion imposible.';

commit;
-- ===========================================================================
-- 202609240015_editar_venta_items.sql  (version sin lineas en blanco)
-- IMPORTANTE: el SQL Editor de Supabase parte el script por lineas en blanco.
-- Este archivo NO tiene ninguna linea vacia y es idempotente.
-- QUE ARREGLA: editar una venta que tiene productos fallaba con
--   "Item de venta invalido" porque la app envia inventario_id y la funcion
--   leia inventory_id. Ahora acepta ambos nombres.
-- TAMBIEN ARREGLA: al editar, el precio y el codigo guardados de cada producto
--   (pedido_items) se borraban (quedaban NULL). Ahora se conservan.
-- TERCER ARREGLO: el candado bloquear_escritura_directa_pedidos rechazaba toda
--   edicion que cambiara total o descuento (solo dejaba pasar campos de sistema).
--   Ahora la edicion puede cambiar los datos de la venta, pero sigue sin poder
--   tocar paciente, consulta, estado ni nada de pagos (abono, forma de pago...).
-- CUARTO ARREGLO: al AGREGAR a una venta un producto que no tenia (por ejemplo
--   cambiar un armazon por otro), el producto quedaba en la venta pero NO se
--   descontaba de existencias ni se anotaba la salida. Ahora si.
-- NO TOCA datos existentes: solo reemplaza dos funciones (editar_venta y el candado).
-- ===========================================================================
begin;
create or replace function public.editar_venta(
  p_venta_id uuid,
  p_operacion_id uuid,
  p_base_version bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_venta public.pedidos_ventas%rowtype;
  v_items jsonb;
  v_item jsonb;
  v_old record;
  v_inventario_id bigint;
  v_cantidad integer;
  v_stock integer;
  v_cantidad_anterior integer;
  v_delta integer;
  v_set text;
  v_sql text;
  v_total numeric;
  v_abono numeric;
  v_precio_inv text;
  v_codigo_inv text;
begin
  if auth.uid() is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;
  perform set_config('app.transaccion_pedido', 'editar_venta', true);
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload de edición inválido.' using errcode = '22023';
  end if;
  select * into v_venta
  from public.pedidos_ventas p
  where p.id = p_venta_id
  for update;
  if not found then
    raise exception 'La venta % no existe.', p_venta_id using errcode = 'P0002';
  end if;
  if v_venta.estado = 'Anulado' then
    raise exception 'Una venta anulada no puede editarse.' using errcode = '23514';
  end if;
  if p_base_version is not null and v_venta.sync_version <> p_base_version then
    raise exception 'La venta fue modificada en otro dispositivo (servidor %, local %).',
      v_venta.sync_version, p_base_version using errcode = '40001';
  end if;
  v_items := coalesce(p_payload -> 'items', '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Items de venta inválidos.' using errcode = '22023';
  end if;
  -- La app envia cada producto como inventario_id; esta funcion trabaja con inventory_id.
  -- Se acepta cualquiera de los dos nombres.
  select coalesce(jsonb_agg(
    case
      when item ? 'inventario_id' and not (item ? 'inventory_id')
        then (item - 'inventario_id') || jsonb_build_object('inventory_id', item -> 'inventario_id')
      else item
    end
  ), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(v_items) item;
  -- Resuelve IDs locales negativos de productos creados offline.
  select coalesce(jsonb_agg(
    case
      when coalesce((item ->> 'inventory_id'), '') ~ '^-' and mapped.id is not null
        then jsonb_set(item, '{inventory_id}', to_jsonb(mapped.id), true)
      else item
    end
  ), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(v_items) item
  left join public.inventario mapped
    on mapped.client_ref = item ->> 'inventory_id';
  -- Primero se bloquean todos los productos de la venta anterior y nueva, ordenados por id.
  for v_inventario_id in
    select distinct id from (
      select (i.inventario_id)::bigint as id
      from public.pedido_items i
      where i.pedido_id = p_venta_id
      union all
      select (i ->> 'inventory_id')::bigint as id
      from jsonb_array_elements(v_items) i
      where nullif(i ->> 'inventory_id', '') is not null
    ) ids
    order by id
  loop
    perform 1 from public.inventario i where i.id = v_inventario_id for update;
  end loop;
  -- Productos eliminados o reducidos: devolver stock.
  for v_old in
    select i.inventario_id, i.cantidad
    from public.pedido_items i
    where i.pedido_id = p_venta_id
    order by i.inventario_id
  loop
    select coalesce((i ->> 'cantidad')::integer, 0)
    into v_cantidad
    from jsonb_array_elements(v_items) i
    where (i ->> 'inventory_id')::bigint = v_old.inventario_id
    limit 1;
    v_delta := coalesce(v_cantidad, 0) - v_old.cantidad;
    if v_delta < 0 then
      update public.inventario i
      set stock = i.stock - v_delta, sync_version = i.sync_version + 1, server_updated_at = now()
      where i.id = v_old.inventario_id;
      insert into public.inventario_movimientos (
        pedido_id, inventario_id, tipo, cantidad, created_by, operacion_id
      ) values (
        p_venta_id, v_old.inventario_id, 'DEVOLUCION', -v_delta, auth.uid(), p_operacion_id
      );
    end if;
  end loop;
  -- Productos nuevos o aumentados: deducir stock atómicamente.
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_inventario_id := (v_item ->> 'inventory_id')::bigint;
    v_cantidad := (v_item ->> 'cantidad')::integer;
    if v_inventario_id is null or v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Item de venta inválido.' using errcode = '22023';
    end if;
    select i.stock, i.precio, i.codigo into v_stock, v_precio_inv, v_codigo_inv from public.inventario i where i.id = v_inventario_id;
    select coalesce(i.cantidad, 0) into v_cantidad_anterior
    from public.pedido_items i
    where i.pedido_id = p_venta_id and i.inventario_id = v_inventario_id;
    v_cantidad_anterior := coalesce(v_cantidad_anterior, 0);
    v_delta := v_cantidad - v_cantidad_anterior;
    if v_delta > 0 then
      if v_stock is null or v_stock < v_delta then
        raise exception 'Stock insuficiente para producto %. Disponible %, solicitado %.',
          v_inventario_id, coalesce(v_stock, 0), v_delta using errcode = '23514';
      end if;
      update public.inventario i
      set stock = i.stock - v_delta, sync_version = i.sync_version + 1, server_updated_at = now()
      where i.id = v_inventario_id;
      insert into public.inventario_movimientos (
        pedido_id, inventario_id, tipo, cantidad, created_by, operacion_id
      ) values (
        p_venta_id, v_inventario_id, 'SALIDA', v_delta, auth.uid(), p_operacion_id
      );
    end if;
    insert into public.pedido_items (
      pedido_id, inventario_id, cantidad, precio_unitario, codigo_snapshot
    ) values (
      p_venta_id, v_inventario_id, v_cantidad,
      coalesce(nullif(v_item ->> 'precio_unitario', ''), v_precio_inv),
      coalesce(nullif(v_item ->> 'codigo', ''), v_codigo_inv)
    )
    on conflict (pedido_id, inventario_id) do update
    set cantidad = excluded.cantidad,
        precio_unitario = case when nullif(v_item ->> 'precio_unitario', '') is not null
          then excluded.precio_unitario else public.pedido_items.precio_unitario end,
        codigo_snapshot = case when nullif(v_item ->> 'codigo', '') is not null
          then excluded.codigo_snapshot else public.pedido_items.codigo_snapshot end;
  end loop;
  delete from public.pedido_items i
  where i.pedido_id = p_venta_id
    and not exists (
      select 1 from jsonb_array_elements(v_items) item
      where (item ->> 'inventory_id')::bigint = i.inventario_id
    );
  select string_agg(format('%I = source.%I', c.column_name, c.column_name), ', ' order by c.column_name)
  into v_set
  from jsonb_object_keys(coalesce(p_payload -> 'venta', '{}'::jsonb)) key
  join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = 'pedidos_ventas'
   and c.column_name = key
  where key not in (
    'id', 'paciente_id', 'consulta_id', 'estado', 'abono', 'pago_nota',
    'forma_pago', 'comprobante_url', 'created_at', 'sync_version', 'server_updated_at'
  );
  if v_set is not null then
    v_sql := format(
      'update public.pedidos_ventas as target
          set %s,
              sync_version = target.sync_version + 1,
              server_updated_at = now()
        from pg_catalog.jsonb_populate_record(null::public.pedidos_ventas, $1::jsonb) source
        where target.id = $2',
      v_set
    );
    execute v_sql using (p_payload -> 'venta')::text, p_venta_id;
  else
    update public.pedidos_ventas set sync_version = sync_version + 1, server_updated_at = now()
    where id = p_venta_id;
  end if;
  v_total := round(public._p0_numero(p_payload -> 'venta' ->> 'venta')
    - public._p0_numero(p_payload -> 'venta' ->> 'venta') * public._p0_numero(p_payload -> 'venta' ->> 'descuento') / 100, 2);
  v_abono := public._p0_numero(v_venta.abono);
  if v_total + 0.005 < v_abono then
    raise exception 'El nuevo total es menor que el abono registrado (%).', v_abono using errcode = '23514';
  end if;
  return jsonb_build_object('venta_id', p_venta_id, 'version', v_venta.sync_version + 1, 'items', v_items);
end;
$function$;
grant execute on function public.editar_venta(uuid, uuid, bigint, jsonb) to authenticated;
-- Candado de pedidos_ventas: igual que el vigente (migracion 004) salvo la rama editar_venta.
create or replace function public.bloquear_escritura_directa_pedidos() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $function$
declare
  v_transaccion text := nullif(current_setting('app.transaccion_pedido', true), '');
  v_campos_financieros text[] := array['abono', 'pago_nota', 'forma_pago', 'comprobante_url'];
  v_campos_sistema text[] := array['abono', 'pago_nota', 'forma_pago', 'comprobante_url', 'sync_version', 'server_updated_at'];
begin
  if tg_op = 'INSERT' and v_transaccion = 'crear_venta' then
    return new;
  end if;
  if tg_op = 'UPDATE' and v_transaccion = 'editar_venta' then
    if new.id = old.id
       and new.paciente_id is not distinct from old.paciente_id
       and new.consulta_id is not distinct from old.consulta_id
       and new.estado is not distinct from old.estado
       and new.abono is not distinct from old.abono
       and new.pago_nota is not distinct from old.pago_nota
       and new.forma_pago is not distinct from old.forma_pago
       and new.comprobante_url is not distinct from old.comprobante_url then
      return new;
    end if;
  end if;
  if tg_op = 'UPDATE' and v_transaccion = 'registrar_pago' then
    if (to_jsonb(new) - v_campos_financieros) = (to_jsonb(old) - v_campos_financieros) then
      return new;
    end if;
  end if;
  if tg_op = 'UPDATE' and v_transaccion = 'reembolsar_pago' then
    if (to_jsonb(new) - v_campos_financieros) = (to_jsonb(old) - v_campos_financieros) then
      return new;
    end if;
  end if;
  if tg_op = 'UPDATE' and v_transaccion = 'actualizar_estado_venta' then
    if (to_jsonb(new) - 'estado') = (to_jsonb(old) - 'estado') then
      return new;
    end if;
  end if;
  if tg_op = 'UPDATE' and v_transaccion = 'anular_venta' then
    if new.estado = 'Anulado' and (to_jsonb(new) - 'estado') = (to_jsonb(old) - 'estado') then
      return new;
    end if;
  end if;
  raise exception 'Escritura directa no permitida. Use aplicar_operaciones.' using errcode = '42501';
end;
$function$;
commit;

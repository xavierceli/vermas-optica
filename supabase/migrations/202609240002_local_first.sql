-- P1 local-first: Outbox idempotente, versionado y edición flexible.
-- Depende de 202609240001_p0_integridad.sql.
begin;

create table if not exists public.operaciones_aplicadas (
  id uuid primary key,
  tipo_operacion text not null,
  entidad_id text,
  resultado jsonb,
  aplicada_por uuid not null default auth.uid(),
  creada_en timestamptz not null default now(),
  completada_en timestamptz
);

comment on table public.operaciones_aplicadas is
  'Registro durable de comandos aplicada. La clave id es el UUID de la Outbox local.';

create table if not exists public.consultas_clinicas_revisiones (
  id uuid primary key default extensions.gen_random_uuid(),
  consulta_id uuid not null references public.consultas_clinicas(id) on delete restrict,
  version integer not null,
  snapshot jsonb not null,
  motivo text,
  editado_por uuid not null default auth.uid(),
  editado_en timestamptz not null default now()
);

create index if not exists consultas_revisiones_consulta_idx
  on public.consultas_clinicas_revisiones(consulta_id, version desc);

alter table public.pacientes_perfil add column if not exists sync_version bigint not null default 0;
alter table public.pacientes_perfil add column if not exists server_updated_at timestamptz not null default now();
alter table public.consultas_clinicas add column if not exists sync_version bigint not null default 0;
alter table public.consultas_clinicas add column if not exists server_updated_at timestamptz not null default now();
alter table public.consultas_clinicas add column if not exists archived_at timestamptz;
alter table public.pedidos_ventas add column if not exists sync_version bigint not null default 0;
alter table public.pedidos_ventas add column if not exists server_updated_at timestamptz not null default now();
alter table public.inventario add column if not exists sync_version bigint not null default 0;
alter table public.inventario add column if not exists server_updated_at timestamptz not null default now();
alter table public.lista_precios add column if not exists sync_version bigint not null default 0;
alter table public.lista_precios add column if not exists server_updated_at timestamptz not null default now();
alter table public.inventario_movimientos add column if not exists operacion_id uuid;
alter table public.pagos add column if not exists operacion_id uuid;

alter table public.inventario_movimientos drop constraint if exists inventario_movimientos_unico;
create unique index if not exists inventario_movimientos_operacion_unico
  on public.inventario_movimientos(operacion_id, tipo, inventario_id)
  where operacion_id is not null;

drop trigger if exists pedido_items_append_only on public.pedido_items;

alter table public.operaciones_aplicadas enable row level security;
alter table public.consultas_clinicas_revisiones enable row level security;

revoke all on public.operaciones_aplicadas from anon, authenticated;
revoke all on public.consultas_clinicas_revisiones from anon;
grant select on public.consultas_clinicas_revisiones to authenticated;

create index if not exists operaciones_aplicadas_entidad_idx
  on public.operaciones_aplicadas(entidad_id, creada_en desc);
create index if not exists consultas_clinicas_paciente_fecha_idx
  on public.consultas_clinicas(paciente_id, fecha desc, id desc);
create index if not exists pedidos_ventas_paciente_fecha_idx
  on public.pedidos_ventas(paciente_id, fecha desc, id desc);
create index if not exists pagos_pedido_fecha_idx
  on public.pagos(pedido_id, created_at desc);

-- El trigger de 001 se reemplaza para admitir CREATE, EDIT, pago, estado y anulación,
-- pero nunca DML directo del navegador.
create or replace function public.bloquear_escritura_directa_pedidos()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_transaccion text := nullif(current_setting('app.transaccion_pedido', true), '');
  v_campos_financieros text[] := array['abono', 'pago_nota', 'forma_pago', 'comprobante_url'];
  v_campos_sistema text[] := array['abono', 'pago_nota', 'forma_pago', 'comprobante_url', 'sync_version', 'server_updated_at'];
begin
  if tg_op = 'INSERT' and v_transaccion = 'crear_venta' then
    return new;
  end if;

  if tg_op = 'UPDATE' and v_transaccion = 'editar_venta' then
    if (to_jsonb(new) - v_campos_sistema)
       = (to_jsonb(old) - v_campos_sistema) then
      return new;
    end if;
  end if;

  if tg_op = 'UPDATE' and v_transaccion = 'registrar_pago' then
    if (to_jsonb(new) - v_campos_financieros)
       = (to_jsonb(old) - v_campos_financieros) then
      return new;
    end if;
  end if;

  if tg_op = 'UPDATE' and v_transaccion = 'actualizar_estado_venta' then
    if (to_jsonb(new) - 'estado') = (to_jsonb(old) - 'estado') then
      return new;
    end if;
  end if;

  if tg_op = 'UPDATE' and v_transaccion = 'anular_venta' then
    if new.estado = 'Anulado'
       and (to_jsonb(new) - 'estado') = (to_jsonb(old) - 'estado') then
      return new;
    end if;
  end if;

  raise exception 'Escritura directa no permitida. Use aplicar_operaciones.'
    using errcode = '42501';
end;
$function$;

alter table public.inventario add column if not exists client_ref text;
create unique index if not exists inventario_client_ref_unico
  on public.inventario(client_ref)
  where client_ref is not null;
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

    select i.stock into v_stock from public.inventario i where i.id = v_inventario_id;
    select coalesce(i.cantidad, 0) into v_cantidad_anterior
    from public.pedido_items i
    where i.pedido_id = p_venta_id and i.inventario_id = v_inventario_id;

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
      v_item ->> 'precio_unitario', v_item ->> 'codigo'
    )
    on conflict (pedido_id, inventario_id) do update
    set cantidad = excluded.cantidad,
        precio_unitario = excluded.precio_unitario,
        codigo_snapshot = excluded.codigo_snapshot;
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

create or replace function public.upsert_inventario(
  p_inventario_id bigint,
  p_datos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_id bigint;
  v_record public.inventario%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;

  if p_inventario_id is null or p_inventario_id <= 0 then
    insert into public.inventario (
      marca, modelo, color, precio, stock, descripcion, categoria, codigo,
      tipo_armazon, param_horizontal, param_puente, param_vertical, param_diagonal,
      nombre_accesorio, caracteristica, material, material_nota, costo_compra,
      imagen_url, param_frontal, param_varillas, client_ref
    ) values (
      p_datos ->> 'marca', p_datos ->> 'modelo', p_datos ->> 'color', p_datos ->> 'precio',
      coalesce((p_datos ->> 'stock')::integer, 0), p_datos ->> 'descripcion',
      p_datos ->> 'categoria', p_datos ->> 'codigo', p_datos ->> 'tipo_armazon',
      p_datos ->> 'param_horizontal', p_datos ->> 'param_puente', p_datos ->> 'param_vertical',
      p_datos ->> 'param_diagonal', p_datos ->> 'nombre_accesorio', p_datos ->> 'caracteristica',
      p_datos ->> 'material', p_datos ->> 'material_nota', p_datos ->> 'costo_compra',
      p_datos ->> 'imagen_url', p_datos ->> 'param_frontal', p_datos ->> 'param_varillas',
      case when p_inventario_id <= 0 then p_inventario_id::text else null end
    ) returning id into v_id;
  else
    update public.inventario
    set marca = p_datos ->> 'marca',
        modelo = p_datos ->> 'modelo',
        color = p_datos ->> 'color',
        precio = p_datos ->> 'precio',
        stock = coalesce((p_datos ->> 'stock')::integer, stock),
        descripcion = p_datos ->> 'descripcion',
        categoria = p_datos ->> 'categoria',
        codigo = p_datos ->> 'codigo',
        tipo_armazon = p_datos ->> 'tipo_armazon',
        param_horizontal = p_datos ->> 'param_horizontal',
        param_puente = p_datos ->> 'param_puente',
        param_vertical = p_datos ->> 'param_vertical',
        param_diagonal = p_datos ->> 'param_diagonal',
        nombre_accesorio = p_datos ->> 'nombre_accesorio',
        caracteristica = p_datos ->> 'caracteristica',
        material = p_datos ->> 'material',
        material_nota = p_datos ->> 'material_nota',
        costo_compra = p_datos ->> 'costo_compra',
        imagen_url = p_datos ->> 'imagen_url',
        param_frontal = p_datos ->> 'param_frontal',
        param_varillas = p_datos ->> 'param_varillas',
        sync_version = sync_version + 1,
        server_updated_at = now()
    where id = p_inventario_id
    returning id into v_id;

    if v_id is null then
      raise exception 'El producto % no existe.', p_inventario_id using errcode = 'P0002';
    end if;
  end if;

  select * into v_record from public.inventario where id = v_id;
  return jsonb_build_object('servidor_id', v_id, 'inventario', to_jsonb(v_record));
end;
$function$;

create or replace function public.eliminar_inventario(p_inventario_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if auth.uid() is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;
  delete from public.inventario where id = p_inventario_id;
  if not found then
    raise exception 'El producto % no existe.', p_inventario_id using errcode = 'P0002';
  end if;
  return jsonb_build_object('servidor_id', p_inventario_id, 'eliminado', true);
end;
$function$;

create or replace function public.upsert_precio(
  p_precio_id bigint,
  p_datos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_id bigint;
  v_record public.lista_precios%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;

  if p_precio_id is null or p_precio_id <= 0 then
    insert into public.lista_precios (
      tipo_lente, material, tratamiento, rango_medida,
      costo_laboratorio, precio_sugerido, notas
    ) values (
      p_datos ->> 'tipo_lente', p_datos ->> 'material', p_datos ->> 'tratamiento',
      p_datos ->> 'rango_medida', p_datos ->> 'costo_laboratorio',
      p_datos ->> 'precio_sugerido', p_datos ->> 'notas'
    ) returning id into v_id;
  else
    update public.lista_precios
    set tipo_lente = p_datos ->> 'tipo_lente',
        material = p_datos ->> 'material',
        tratamiento = p_datos ->> 'tratamiento',
        rango_medida = p_datos ->> 'rango_medida',
        costo_laboratorio = p_datos ->> 'costo_laboratorio',
        precio_sugerido = p_datos ->> 'precio_sugerido',
        notas = p_datos ->> 'notas',
        sync_version = sync_version + 1,
        server_updated_at = now()
    where id = p_precio_id
    returning id into v_id;
    if v_id is null then
      raise exception 'La tarifa % no existe.', p_precio_id using errcode = 'P0002';
    end if;
  end if;

  select * into v_record from public.lista_precios where id = v_id;
  return jsonb_build_object('servidor_id', v_id, 'precio', to_jsonb(v_record));
end;
$function$;

create or replace function public.eliminar_precio(p_precio_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if auth.uid() is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;
  delete from public.lista_precios where id = p_precio_id;
  if not found then
    raise exception 'La tarifa % no existe.', p_precio_id using errcode = 'P0002';
  end if;
  return jsonb_build_object('servidor_id', p_precio_id, 'eliminado', true);
end;
$function$;

create or replace function public.archivar_consulta(p_consulta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_snapshot jsonb;
  v_version integer;
begin
  if auth.uid() is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;

  select to_jsonb(c), c.sync_version into v_snapshot, v_version
  from public.consultas_clinicas c where c.id = p_consulta_id for update;
  if not found then
    raise exception 'La consulta % no existe.', p_consulta_id using errcode = 'P0002';
  end if;

  insert into public.consultas_clinicas_revisiones (consulta_id, version, snapshot, motivo, editado_por)
  values (p_consulta_id, v_version, v_snapshot, 'Archivo lógico', auth.uid());

  update public.consultas_clinicas
  set archived_at = now(), sync_version = sync_version + 1, server_updated_at = now()
  where id = p_consulta_id;

  return jsonb_build_object('consulta_id', p_consulta_id, 'archivada', true);
end;
$function$;

create or replace function public.aplicar_operaciones(p_operaciones jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_operacion jsonb;
  v_id uuid;
  v_tipo text;
  v_entidad_id text;
  v_payload jsonb;
  v_resultado jsonb;
  v_resultados jsonb := '[]'::jsonb;
  v_claimed uuid;
  v_insertado boolean;
begin
  if auth.uid() is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;
  if p_operaciones is null or jsonb_typeof(p_operaciones) <> 'array' then
    raise exception 'El lote de operaciones es inválido.' using errcode = '22023';
  end if;

  for v_operacion in select value from jsonb_array_elements(p_operaciones) loop
    v_id := nullif(v_operacion ->> 'id', '')::uuid;
    v_tipo := v_operacion ->> 'type';
    v_entidad_id := v_operacion ->> 'entityId';
    v_payload := coalesce(v_operacion -> 'payload', '{}'::jsonb);

    if v_id is null or coalesce(v_tipo, '') = '' then
      v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'status', 'failed', 'error', 'Operación sin id o tipo.'
      ));
      continue;
    end if;

    select o.resultado into v_resultado
    from public.operaciones_aplicadas o
    where o.id = v_id;

    if found then
      v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'status', 'applied', 'result', v_resultado, 'replay', true
      ));
      continue;
    end if;

    begin
      insert into public.operaciones_aplicadas (id, tipo_operacion, entidad_id)
      values (v_id, v_tipo, v_entidad_id)
      on conflict (id) do nothing
      returning id into v_claimed;

      v_insertado := v_claimed is not null;
      if not v_insertado then
        select o.resultado into v_resultado
        from public.operaciones_aplicadas o
        where o.id = v_id;
        v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
          'id', v_id, 'status', 'applied', 'result', v_resultado, 'replay', true
        ));
        continue;
      end if;

      case v_tipo
        when 'GUARDAR_CONSULTA' then
          v_resultado := public.guardar_consulta_clinica(
            (v_payload ->> 'p_consulta_id')::uuid,
            v_payload -> 'p_payload'
          );

        when 'CREAR_VENTA' then
          declare
            v_sale_payload jsonb := v_payload -> 'p_payload';
            v_accessory_ref text;
            v_accessory_id bigint;
          begin
            v_accessory_ref := v_sale_payload -> 'venta' ->> 'accesorio_id';
            if coalesce(v_accessory_ref, '') ~ '^-' then
              select i.id into v_accessory_id from public.inventario i where i.client_ref = v_accessory_ref;
              if v_accessory_id is not null then
                v_sale_payload := jsonb_set(
                  v_sale_payload,
                  '{venta,accesorio_id}',
                  to_jsonb(v_accessory_id::text),
                  true
                );
              end if;
            end if;
            v_resultado := public.crear_venta(
              (v_payload ->> 'p_venta_id')::uuid,
              v_sale_payload
            );
          end;

        when 'EDITAR_VENTA' then
          v_resultado := public.editar_venta(
            (v_payload ->> 'p_venta_id')::uuid,
            v_id,
            nullif(v_operacion ->> 'baseVersion', '')::bigint,
            v_payload -> 'p_payload'
          );

        when 'REGISTRAR_PAGO' then
          v_resultado := public.registrar_pago(
            (v_payload ->> 'p_pedido_id')::uuid,
            (v_payload ->> 'p_idempotency_key')::uuid,
            (v_payload ->> 'p_monto')::numeric,
            v_payload ->> 'p_metodo',
            v_payload ->> 'p_referencia',
            v_payload ->> 'p_comprobante_path'
          );

        when 'CAMBIAR_ESTADO_VENTA' then
          perform public.actualizar_estado_venta(
            (v_payload ->> 'p_venta_id')::uuid,
            v_payload ->> 'p_estado'
          );
          v_resultado := jsonb_build_object(
            'venta_id', v_payload ->> 'p_venta_id',
            'estado', v_payload ->> 'p_estado'
          );

        when 'ANULAR_VENTA' then
          v_resultado := public.anular_venta((v_payload ->> 'p_venta_id')::uuid);

        when 'UPSERT_INVENTARIO' then
          v_resultado := public.upsert_inventario(
            nullif(v_payload ->> 'p_inventario_id', '')::bigint,
            v_payload -> 'p_datos'
          );

        when 'ELIMINAR_INVENTARIO' then
          v_resultado := public.eliminar_inventario((v_payload ->> 'p_inventario_id')::bigint);

        when 'UPSERT_PRECIO' then
          v_resultado := public.upsert_precio(
            nullif(v_payload ->> 'p_precio_id', '')::bigint,
            v_payload -> 'p_datos'
          );

        when 'ELIMINAR_PRECIO' then
          v_resultado := public.eliminar_precio((v_payload ->> 'p_precio_id')::bigint);

        when 'ARCHIVAR_CONSULTA' then
          v_resultado := public.archivar_consulta((v_payload ->> 'p_consulta_id')::uuid);

        else
          raise exception 'Tipo de operación no soportado: %', v_tipo using errcode = '22023';
      end case;

      update public.operaciones_aplicadas
      set resultado = v_resultado, completada_en = now()
      where id = v_id;

      v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'status', 'applied', 'result', v_resultado, 'replay', false
      ));
    exception when others then
      v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
        'id', v_id,
        'status', case
          when sqlstate = '40001' or sqlstate = '23514' or sqlerrm like '%Stock%' then 'conflict'
          else 'failed'
        end,
        'error', sqlerrm,
        'sqlstate', sqlstate
      ));
    end;
  end loop;

  return jsonb_build_object('results', v_resultados, 'processed_at', now());
end;
$function$;

-- Todo el DML de negocio pasa por el Outbox/RPC. authenticated conserva SELECT.
revoke all on table public.inventario from authenticated;
revoke all on table public.lista_precios from authenticated;
grant select on table public.inventario to authenticated;
grant select on table public.lista_precios to authenticated;

revoke all on function public.aplicar_operaciones(jsonb) from public, anon;
revoke all on function public.editar_venta(uuid, uuid, bigint, jsonb) from public, anon;
revoke all on function public.upsert_inventario(bigint, jsonb) from public, anon;
revoke all on function public.eliminar_inventario(bigint) from public, anon;
revoke all on function public.upsert_precio(bigint, jsonb) from public, anon;
revoke all on function public.eliminar_precio(bigint) from public, anon;
revoke all on function public.archivar_consulta(uuid) from public, anon;

grant execute on function public.aplicar_operaciones(jsonb) to authenticated;
grant execute on function public.editar_venta(uuid, uuid, bigint, jsonb) to authenticated;
grant execute on function public.upsert_inventario(bigint, jsonb) to authenticated;
grant execute on function public.eliminar_inventario(bigint) to authenticated;
grant execute on function public.upsert_precio(bigint, jsonb) to authenticated;
grant execute on function public.eliminar_precio(bigint) to authenticated;
grant execute on function public.archivar_consulta(uuid) to authenticated;

comment on function public.aplicar_operaciones(jsonb) is
  'Procesa un lote de comandos de Outbox. Cada UUID se aplica una sola vez.';

commit;

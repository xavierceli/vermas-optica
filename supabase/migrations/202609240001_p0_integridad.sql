-- P0: integridad de consultas, ventas, stock y pagos.
-- Compatible con el esquema público verificado.
-- Ejecutar una sola vez en Supabase SQL Editor, junto con el cambio de React.
--
-- Modelo de autorización Deliberadamente conservado:
-- cualquier usuario autenticado tiene el mismo alcance, como las policies actuales.
-- Antes de multiempresa, sustituir por una autorización por organización/rol.

begin;

-- 0) Preflight: evita desplegar la migración contra otro esquema.
do $$
declare
  v_tipo text;
begin
  if to_regclass('public.pacientes_perfil') is null
     or to_regclass('public.consultas_clinicas') is null
     or to_regclass('public.pedidos_ventas') is null
     or to_regclass('public.inventario') is null then
    raise exception 'Migración P0 abortada: falta una tabla base del esquema verificado.';
  end if;

  select data_type into v_tipo
  from information_schema.columns
  where table_schema = 'public' and table_name = 'inventario' and column_name = 'id';
  if v_tipo <> 'bigint' then
    raise exception 'Migración P0 abortada: inventario.id debe ser bigint, no %', coalesce(v_tipo, 'NULL');
  end if;

  select data_type into v_tipo
  from information_schema.columns
  where table_schema = 'public' and table_name = 'inventario' and column_name = 'stock';
  if v_tipo <> 'integer' then
    raise exception 'Migración P0 abortada: inventario.stock debe ser integer, no %', coalesce(v_tipo, 'NULL');
  end if;

  if to_regclass('public.consultas_clinicas') is not null
     and not exists (
       select 1 from pg_catalog.pg_constraint
       where conrelid = 'public.consultas_clinicas'::regclass and contype = 'p'
     ) then
    raise exception 'Migración P0 abortada: consultas_clinicas necesita primary key.';
  end if;
  if exists (
    select 1
    from public.pacientes_perfil p
    where p.cedula is not null
      and p.cedula <> upper(btrim(p.cedula))
  ) or exists (
    select 1
    from public.pacientes_perfil p
    group by upper(btrim(p.cedula))
    having count(*) > 1
  ) then
    raise exception 'Migración P0 abortada: normalice y deduplique las cédulas antes de continuar.'
      using errcode = '23505';
  end if;
end;
$$;

-- 1) Detalle inmutable de productos vendidos.
create table if not exists public.pedido_items (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references public.pedidos_ventas(id) on delete restrict,
  inventario_id bigint not null references public.inventario(id) on delete restrict,
  cantidad integer not null check (cantidad > 0),
  precio_unitario text,
  codigo_snapshot text,
  created_at timestamptz not null default now(),
  constraint pedido_items_pedido_inventario_unico unique (pedido_id, inventario_id)
);

comment on table public.pedido_items is
  'Detalle inmutable de la venta. Es la fuente para devolver stock al anular.';

-- 2) Ledger append-only de movimientos de inventario.
create table if not exists public.inventario_movimientos (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references public.pedidos_ventas(id) on delete restrict,
  inventario_id bigint not null references public.inventario(id) on delete restrict,
  tipo text not null check (tipo in ('SALIDA', 'DEVOLUCION')),
  cantidad integer not null check (cantidad > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint inventario_movimientos_unico unique (pedido_id, tipo, inventario_id)
);

comment on table public.inventario_movimientos is
  'Ledger append-only de salidas y devoluciones. No se actualiza ni se borra.';

-- 3) Pagos append-only. El saldo de pedidos_ventas es un total derivado, nunca la fuente primaria.
create table if not exists public.pagos (
  id uuid primary key default extensions.gen_random_uuid(),
  idempotency_key uuid not null unique,
  pedido_id uuid not null references public.pedidos_ventas(id) on delete restrict,
  monto numeric(14, 2) not null check (monto > 0),
  metodo text not null check (metodo in ('Efectivo', 'Transferencia', 'Tarjeta')),
  referencia text,
  comprobante_path text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

comment on table public.pagos is
  'Cobros inmutables. Usar registrar_pago; nunca UPDATE/DELETE sobre esta tabla.';

-- 4) RLS de las tablas nuevas. Las funciones SQL de abajo son SECURITY DEFINER y
--    validan auth.uid(); los usuarios solo pueden leer lo que les corresponde.
alter table public.pedido_items enable row level security;
alter table public.inventario_movimientos enable row level security;
alter table public.pagos enable row level security;

drop policy if exists pedido_items_select_authenticated on public.pedido_items;
create policy pedido_items_select_authenticated
  on public.pedido_items for select to authenticated using (true);

drop policy if exists inventario_movimientos_select_authenticated on public.inventario_movimientos;
create policy inventario_movimientos_select_authenticated
  on public.inventario_movimientos for select to authenticated using (true);

drop policy if exists pagos_select_own on public.pagos;
create policy pagos_select_own
  on public.pagos for select to authenticated
  using (created_by = auth.uid());

-- 5) Las tres tablas de evidencia son append-only.
create or replace function public.impedir_mutacion_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception 'La tabla % es append-only: no se permite % ni UPDATE.', tg_table_name, tg_op
    using errcode = '55000';
end;
$function$;

drop trigger if exists pagos_append_only on public.pagos;
create trigger pagos_append_only
  before update or delete on public.pagos
  for each row execute function public.impedir_mutacion_append_only();

drop trigger if exists pedido_items_append_only on public.pedido_items;
create trigger pedido_items_append_only
  before update or delete on public.pedido_items
  for each row execute function public.impedir_mutacion_append_only();

drop trigger if exists inventario_movimientos_append_only on public.inventario_movimientos;
create trigger inventario_movimientos_append_only
  before update or delete on public.inventario_movimientos
  for each row execute function public.impedir_mutacion_append_only();

-- 6) Conversión numérica única y explícita para campos text del esquema existente.
create or replace function public._p0_numero(p_valor text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $function$
begin
  if p_valor is null or btrim(p_valor) = '' then
    return 0;
  end if;
  return btrim(p_valor)::numeric;
exception
  when invalid_text_representation then
    raise exception 'Valor numérico inválido: %', p_valor using errcode = '22023';
end;
$function$;

comment on function public._p0_numero(text) is
  'Conversión numérica interna de la migración P0. No es una API de negocio.';

-- 7) Eliminar el trigger antiguo: permite deducir sin comprobar que el producto exista
--    o que haya stock suficiente. La nueva RPC lo reemplaza.
drop trigger if exists trg_ajustar_stock on public.pedidos_ventas;
drop function if exists public.ajustar_stock_por_venta();

-- 8) Guard de escritura: desde esta migración, pedidos_ventas solo se modifica por RPC.
create or replace function public.bloquear_escritura_directa_pedidos()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_transaccion text := nullif(current_setting('app.transaccion_pedido', true), '');
begin
  if tg_op = 'INSERT' and v_transaccion = 'crear_venta' then
    return new;
  end if;

  if tg_op = 'UPDATE' and v_transaccion = 'registrar_pago' then
    if (to_jsonb(new) - array['abono', 'pago_nota', 'forma_pago', 'comprobante_url'])
       = (to_jsonb(old) - array['abono', 'pago_nota', 'forma_pago', 'comprobante_url']) then
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

  raise exception
    'Escritura directa no permitida sobre pedidos_ventas. Use las RPC de negocio P0.'
    using errcode = '42501';
end;
$function$;

create trigger trg_bloquear_escritura_directa_pedidos
  before insert or update or delete on public.pedidos_ventas
  for each row execute function public.bloquear_escritura_directa_pedidos();

-- 9) RPC atómica para perfil + evaluación clínica.
--    p_consulta_id debe ser estable en reintentos. En una edición, solo se actualizan
--    las claves presentes en p_payload->'consulta'; no se borran midciones omitidas.
create or replace function public.guardar_consulta_clinica(
  p_consulta_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_usuario uuid := auth.uid();
  v_perfil jsonb := case when jsonb_typeof(p_payload -> 'paciente') = 'object'
                        then p_payload -> 'paciente' else '{}'::jsonb end;
  v_consulta jsonb := case when jsonb_typeof(p_payload -> 'consulta') = 'object'
                          then p_payload -> 'consulta' else '{}'::jsonb end;
  v_cedula text;
  v_consulta_id uuid := coalesce(p_consulta_id, extensions.gen_random_uuid());
  v_paciente_id uuid;
  v_paciente_previo uuid;
  v_columnas text;
  v_asignaciones text;
  v_sql text;
  v_creada boolean := false;
begin
  if v_usuario is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload clínico inválido.' using errcode = '22023';
  end if;

  v_cedula := upper(btrim(coalesce(v_perfil ->> 'cedula', '')));
  if v_cedula = '' then
    raise exception 'La cédula del paciente es obligatoria.' using errcode = '22023';
  end if;
  if btrim(coalesce(v_perfil ->> 'nombre', '')) = '' then
    raise exception 'El nombre del paciente es obligatorio.' using errcode = '22023';
  end if;

  -- Upsert por la cédula: nunca cambiar el UUID de un perfil existente.
  insert into public.pacientes_perfil as existente (
    id, cedula, nombre, telefono, correo, fecha_nacimiento, antecedentes, alias
  ) values (
    extensions.gen_random_uuid(),
    v_cedula,
    btrim(v_perfil ->> 'nombre'),
    nullif(btrim(coalesce(v_perfil ->> 'telefono', '')), ''),
    nullif(lower(btrim(coalesce(v_perfil ->> 'correo', ''))), ''),
    nullif(btrim(coalesce(v_perfil ->> 'fecha_nacimiento', '')), ''),
    nullif(btrim(coalesce(v_perfil ->> 'antecedentes', '')), ''),
    nullif(btrim(coalesce(v_perfil ->> 'alias', '')), '')
  )
  on conflict (cedula) do update set
    nombre = coalesce(nullif(btrim(excluded.nombre), ''), existente.nombre),
    telefono = coalesce(nullif(excluded.telefono, ''), existente.telefono),
    correo = coalesce(nullif(excluded.correo, ''), existente.correo),
    fecha_nacimiento = coalesce(nullif(excluded.fecha_nacimiento, ''), existente.fecha_nacimiento),
    antecedentes = coalesce(nullif(excluded.antecedentes, ''), existente.antecedentes),
    alias = coalesce(nullif(excluded.alias, ''), existente.alias)
  returning id into v_paciente_id;

  select c.paciente_id into v_paciente_previo
  from public.consultas_clinicas c
  where c.id = v_consulta_id;

  if found and v_paciente_previo <> v_paciente_id then
    raise exception 'La consulta % pertenece a otro paciente.', v_consulta_id
      using errcode = '23514';
  end if;

  v_consulta := v_consulta
    - array['id', 'paciente_id', 'cedula', 'nombre', 'created_at'];

  if not found then
    v_creada := true;
    v_consulta := jsonb_set(
      v_consulta,
      '{fecha}',
      to_jsonb(coalesce(nullif(btrim(v_consulta ->> 'fecha'), ''), current_date::text))
    );

    select
      string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position),
      null
    into v_columnas, v_asignaciones
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'consultas_clinicas';

    v_sql := format(
      'insert into public.consultas_clinicas (%s)
         select (pg_catalog.jsonb_populate_record(null::public.consultas_clinicas, $1::jsonb)).*',
      v_columnas
    );
    execute v_sql using (
      v_consulta || jsonb_build_object('id', v_consulta_id, 'paciente_id', v_paciente_id)
    )::text;
  elsif v_consulta <> '{}'::jsonb then
    select string_agg(format('%I = r.%I', c.column_name, c.column_name), ', ' order by c.column_name)
    into v_asignaciones
    from jsonb_object_keys(v_consulta) as clave(clave)
    join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = 'consultas_clinicas'
     and c.column_name = clave.clave
    where c.column_name not in ('id', 'paciente_id', 'created_at');

    if v_asignaciones is null then
      raise exception 'La evaluación no contiene columnas clínicas válidas.' using errcode = '22023';
    end if;

    v_sql := format(
      'update public.consultas_clinicas as c
          set %s
        from pg_catalog.jsonb_populate_record(null::public.consultas_clinicas, $1::jsonb) as r
        where c.id = $2 and c.paciente_id = $3',
      v_asignaciones
    );
    execute v_sql using v_consulta::text, v_consulta_id, v_paciente_id;

    if not found then
      raise exception 'No se pudo actualizar la consulta %.', v_consulta_id using errcode = 'P0002';
    end if;
  end if;

  return jsonb_build_object(
    'consulta_id', v_consulta_id,
    'paciente_id', v_paciente_id,
    'creada', v_creada
  );
end;
$function$;

-- 10) RPC atómica de venta.
--    El cliente debe reutilizar p_venta_id cuando reintenta la misma orden.
--    Cada item puede ser {"inventario_id": 12, "cantidad": 1}
--    o {"codigo": "ABC", "cantidad": 1}.
create or replace function public.crear_venta(
  p_venta_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_usuario uuid := auth.uid();
  v_venta jsonb := case when jsonb_typeof(p_payload -> 'venta') = 'object'
                        then p_payload -> 'venta' else '{}'::jsonb end;
  v_items jsonb;
  v_item jsonb;
  v_resultado jsonb;
  v_consulta_id uuid;
  v_consulta jsonb;
  v_venta_existente record;
  v_columnas text;
  v_sql text;
  v_total numeric;
  v_descuento numeric;
  v_inventario_id bigint;
  v_codigo text;
  v_cantidad integer;
  v_cantidad_num numeric;
  v_stock integer;
  v_precio text;
  v_codigo_producto text;
  v_vistos bigint[] := array[]::bigint[];
begin
  if v_usuario is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;
  if p_venta_id is null then
    raise exception 'El UUID de venta es obligatorio.' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload de venta inválido.' using errcode = '22023';
  end if;

  -- Serializa reintentos del mismo pedido, incluso si llegan a la vez.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_venta_id::text)
  );

  select p.id, p.paciente_id, p.consulta_id into v_venta_existente
  from public.pedidos_ventas p
  where p.id = p_venta_id;

  if found then
    return jsonb_build_object(
      'venta_id', v_venta_existente.id,
      'paciente_id', v_venta_existente.paciente_id,
      'consulta_id', v_venta_existente.consulta_id,
      'ya_existia', true
    );
  end if;

  v_consulta := case when jsonb_typeof(p_payload -> 'consulta') = 'object'
                     then p_payload -> 'consulta' else '{}'::jsonb end;
  v_consulta_id := nullif(p_payload ->> 'consulta_id', '')::uuid;

  -- Si ya existe la consulta, valida paciente sin sobrescribir sus valores clínicos.
  -- Si no existe, crea una consulta mínima atómicamente junto con la venta.
  v_resultado := public.guardar_consulta_clinica(
    v_consulta_id,
    jsonb_build_object(
      'paciente', p_payload -> 'paciente',
      'consulta', v_consulta
    )
  );
  v_consulta_id := (v_resultado ->> 'consulta_id')::uuid;

  v_total := public._p0_numero(v_venta ->> 'venta');
  v_descuento := public._p0_numero(v_venta ->> 'descuento');
  if v_total <> round(v_total, 2) or v_descuento <> round(v_descuento, 2) then
    raise exception 'Venta y descuento deben tener como máximo dos decimales.' using errcode = '22023';
  end if;
  if v_total < 0 then
    raise exception 'El total de venta no puede ser negativo.' using errcode = '22023';
  end if;
  if v_descuento < 0 or v_descuento > 100 then
    raise exception 'El descuento debe estar entre 0 y 100.' using errcode = '22023';
  end if;
  if public._p0_numero(v_venta ->> 'abono') <> 0 then
    raise exception 'Una venta nueva no puede incluir abono. Use registrar_pago.'
      using errcode = '22023';
  end if;

  -- Normaliza los campos JSON que el trigger de stock utiliza.
  v_venta := v_venta - array['id', 'paciente_id', 'consulta_id', 'created_at', 'abono'];
  v_venta := v_venta || jsonb_build_object(
    'id', p_venta_id,
    'paciente_id', (v_resultado ->> 'paciente_id')::uuid,
    'consulta_id', v_consulta_id,
    'fecha', coalesce(nullif(btrim(v_venta ->> 'fecha'), ''), current_date::text),
    'venta', v_total::text,
    'abono', '0',
    'descuento', v_descuento::text,
    'forma_pago', coalesce(nullif(btrim(v_venta ->> 'forma_pago'), ''), 'Efectivo'),
    'estado', coalesce(nullif(btrim(v_venta ->> 'estado'), ''), 'En laboratorio'),
    'pago_nota', '',
    'comprobante_url', ''
  );

  select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position)
  into v_columnas
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'pedidos_ventas';

  v_sql := format(
    'insert into public.pedidos_ventas (%s)
       select (pg_catalog.jsonb_populate_record(null::public.pedidos_ventas, $1::jsonb)).*',
    v_columnas
  );

  perform set_config('app.transaccion_pedido', 'crear_venta', true);
  execute v_sql using v_venta::text;

  -- Soporta el payload antiguo durante la transición: código de armazón/accesorio.
  v_items := case when jsonb_typeof(p_payload -> 'items') = 'array'
                  then p_payload -> 'items' else '[]'::jsonb end;
  if jsonb_array_length(v_items) = 0 then
    if nullif(btrim(coalesce(v_venta ->> 'codigo_armazon', '')), '') is not null
       and btrim(v_venta ->> 'codigo_armazon') <> '2905' then
      v_items := v_items || jsonb_build_array(
        jsonb_build_object('codigo', btrim(v_venta ->> 'codigo_armazon'), 'cantidad', 1)
      );
    end if;
    if nullif(btrim(coalesce(v_venta ->> 'accesorio_id', '')), '') is not null then
      v_items := v_items || jsonb_build_array(
        jsonb_build_object(
          'inventario_id', btrim(v_venta ->> 'accesorio_id')::bigint,
          'cantidad', 1
        )
      );
    end if;
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(v_items)
  loop
    v_cantidad_num := public._p0_numero(v_item ->> 'cantidad');
    if v_cantidad_num <> trunc(v_cantidad_num) or v_cantidad_num > 2147483647 then
      raise exception 'La cantidad debe ser un entero positivo.' using errcode = '22023';
    end if;
    v_cantidad := v_cantidad_num::integer;
    v_codigo := nullif(btrim(coalesce(v_item ->> 'codigo', '')), '');
    v_inventario_id := case
      when nullif(btrim(coalesce(v_item ->> 'inventario_id', '')), '') is not null
        then btrim(v_item ->> 'inventario_id')::bigint
      else null
    end;

    if v_inventario_id is null and v_codigo is null then
      raise exception 'Cada item necesita inventario_id o codigo.' using errcode = '22023';
    end if;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad de item inválida.' using errcode = '22023';
    end if;
    if v_codigo = '2905' then
      raise exception 'El código 2905 no consume inventario.' using errcode = '22023';
    end if;

    select i.id, i.stock, i.precio, i.codigo
    into v_inventario_id, v_stock, v_precio, v_codigo_producto
    from public.inventario i
    where (v_inventario_id is not null and i.id = v_inventario_id)
       or (v_codigo is not null and upper(btrim(i.codigo)) = upper(v_codigo))
    for update;

    if not found then
      raise exception 'Producto de inventario inexistente: %.', coalesce(v_codigo, v_inventario_id::text)
        using errcode = 'P0002';
    end if;
    if v_stock is null or v_stock < v_cantidad then
      raise exception 'Stock insuficiente para el producto % (disponible: %, solicitado: %).',
        v_codigo_producto, coalesce(v_stock, 0), v_cantidad using errcode = '23514';
    end if;
    if v_inventario_id = any(v_vistos) then
      raise exception 'El producto % fue enviado duplicado en items. Agrupe las cantidades.',
        v_inventario_id using errcode = '22023';
    end if;
    v_vistos := array_append(v_vistos, v_inventario_id);

    update public.inventario i
    set stock = i.stock - v_cantidad
    where i.id = v_inventario_id;

    insert into public.inventario_movimientos (
      pedido_id, inventario_id, tipo, cantidad, created_by
    ) values (
      p_venta_id, v_inventario_id, 'SALIDA', v_cantidad, v_usuario
    );

    insert into public.pedido_items (
      pedido_id, inventario_id, cantidad, precio_unitario, codigo_snapshot
    ) values (
      p_venta_id, v_inventario_id, v_cantidad, v_precio, v_codigo_producto
    );
  end loop;

  return jsonb_build_object(
    'venta_id', p_venta_id,
    'paciente_id', (v_resultado ->> 'paciente_id')::uuid,
    'consulta_id', v_consulta_id,
    'items', v_items,
    'ya_existia', false
  );
end;
$function$;

-- 11) Pago atómico e idempotente. El bloqueo de la fila de venta serializa cobros
--     simultáneos del mismo pedido; el idempotency_key evita reintentos del mismo cobro.
create or replace function public.registrar_pago(
  p_pedido_id uuid,
  p_idempotency_key uuid,
  p_monto numeric,
  p_metodo text,
  p_referencia text default null,
  p_comprobante_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_usuario uuid := auth.uid();
  v_pedido record;
  v_pago_id uuid;
  v_pago_existente_id uuid;
  v_pedido_existente_id uuid;
  v_monto_existente numeric;
  v_total numeric;
  v_abono numeric;
  v_saldo numeric;
  v_monto numeric;
begin
  if v_usuario is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;
  if p_pedido_id is null or p_idempotency_key is null then
    raise exception 'pedido_id e idempotency_key son obligatorios.' using errcode = '22023';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto <> round(p_monto, 2) then
    raise exception 'El monto debe ser positivo y tener como máximo dos decimales.'
      using errcode = '22023';
  end if;
  if p_metodo not in ('Efectivo', 'Transferencia', 'Tarjeta') then
    raise exception 'Método de pago inválido.' using errcode = '22023';
  end if;
  v_monto := round(p_monto, 2);

  select p.id, p.venta, p.descuento, p.abono, p.estado
  into v_pedido
  from public.pedidos_ventas p
  where p.id = p_pedido_id
  for update;

  if not found then
    raise exception 'El pedido % no existe.', p_pedido_id using errcode = 'P0002';
  end if;
  if v_pedido.estado = 'Anulado' then
    raise exception 'No se pueden registrar pagos en una venta anulada.' using errcode = '23514';
  end if;

  v_total := round(public._p0_numero(v_pedido.venta)
    - public._p0_numero(v_pedido.venta) * public._p0_numero(v_pedido.descuento) / 100, 2);
  v_abono := round(public._p0_numero(v_pedido.abono), 2);
  v_saldo := round(v_total - v_abono, 2);

  select p.id, p.pedido_id, p.monto
  into v_pago_existente_id, v_pedido_existente_id, v_monto_existente
  from public.pagos p
  where p.idempotency_key = p_idempotency_key;

  if found then
    if v_pago_existente_id is null or v_pedido_existente_id <> v_pedido_id then
      raise exception 'La clave de idempotencia ya pertenece a otro pago.'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'pago_id', v_pago_existente_id,
      'pedido_id', v_pedido_existente_id,
      'monto', v_monto_existente,
      'saldo_pendiente', v_saldo,
      'ya_existia', true
    );
  end if;

  if v_saldo <= 0 then
    raise exception 'La venta ya está pagada.' using errcode = '23514';
  end if;
  if v_monto > v_saldo + 0.005 then
    raise exception 'El abono supera el saldo pendiente (saldo: %).', v_saldo
      using errcode = '23514';
  end if;

  insert into public.pagos (
    idempotency_key, pedido_id, monto, metodo, referencia, comprobante_path, created_by
  ) values (
    p_idempotency_key, p_pedido_id, v_monto, p_metodo,
    nullif(btrim(coalesce(p_referencia, '')), ''),
    nullif(btrim(coalesce(p_comprobante_path, '')), ''),
    v_usuario
  )
  on conflict (idempotency_key) do nothing
  returning id into v_pago_id;

  if v_pago_id is null then
    select p.id, p.pedido_id, p.monto
    into v_pago_existente_id, v_pedido_existente_id, v_monto_existente
    from public.pagos p
    where p.idempotency_key = p_idempotency_key;

    if not found or p_pedido_id <> v_pedido_id then
      raise exception 'La clave de idempotencia ya fue usada por otro pago.'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'pago_id', v_pago_existente_id,
      'pedido_id', v_pedido_existente_id,
      'monto', v_monto_existente,
      'saldo_pendiente', v_saldo,
      'ya_existia', true
    );
  end if;

  perform set_config('app.transaccion_pedido', 'registrar_pago', true);
  update public.pedidos_ventas p
  set abono = round(v_abono + v_monto, 2)::text,
      forma_pago = p_metodo,
      pago_nota = concat_ws(
        E'\n',
        nullif(btrim(coalesce(p.pago_nota, '')), ''),
        format('[%s] +%s %s %s',
          to_char(now() at time zone 'America/Guayaquil', 'DD/MM/YYYY'),
          v_monto::text, p_metodo, coalesce(p_referencia, ''))
      ),
      comprobante_url = coalesce(nullif(btrim(coalesce(p_comprobante_path, '')), ''), p.comprobante_url)
  where p.id = p_pedido_id;

  return jsonb_build_object(
    'pago_id', v_pago_id,
    'pedido_id', p_pedido_id,
    'monto', v_monto,
    'saldo_pendiente', round(v_saldo - v_monto, 2),
    'ya_existia', false
  );
end;
$function$;

-- 12) Cambiar estado sin tocar stock ni datos financieros.
create or replace function public.actualizar_estado_venta(p_venta_id uuid, p_estado text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if auth.uid() is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;
  if p_estado not in ('Ninguno', 'En laboratorio', 'Listo para Entrega', 'Entregado') then
    raise exception 'Estado de venta inválido. Use anular_venta para anular.' using errcode = '22023';
  end if;
  perform set_config('app.transaccion_pedido', 'actualizar_estado_venta', true);
  update public.pedidos_ventas set estado = p_estado where id = p_venta_id;
  if not found then
    raise exception 'El pedido % no existe.', p_venta_id using errcode = 'P0002';
  end if;
end;
$function$;

-- 13) Anulación lógica: conserva el histórico y devuelve stock una sola vez.
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

  perform set_config('app.transaccion_pedido', 'anular_venta', true);
  update public.pedidos_ventas set estado = 'Anulado' where id = p_venta_id;

  return jsonb_build_object('venta_id', p_venta_id, 'anulada', true);
end;
$function$;

-- 14) Permisos: la seguridad ya no depende únicamente de RLS.
--     anon no recibe privilegios; authenticated conserva DML de catálogo por ahora.
--     Las escrituras clínicas y de ventas pasan por las RPCs anteriores.
revoke all on table public.pacientes_perfil from anon;
revoke all on table public.consultas_clinicas from anon;
revoke all on table public.pedidos_ventas from anon;
revoke all on table public.inventario from anon;
revoke all on table public.lista_precios from anon;

revoke all on table public.pacientes_perfil from authenticated;
revoke all on table public.consultas_clinicas from authenticated;
revoke all on table public.pedidos_ventas from authenticated;

grant select on table public.pacientes_perfil to authenticated;
grant select on table public.consultas_clinicas to authenticated;
grant select on table public.pedidos_ventas to authenticated;
grant select on table public.inventario to authenticated;
grant select on table public.lista_precios to authenticated;

revoke all on table public.pedido_items from anon, authenticated;
revoke all on table public.inventario_movimientos from anon, authenticated;
revoke all on table public.pagos from anon, authenticated;
grant select on table public.pedido_items to authenticated;
grant select on table public.inventario_movimientos to authenticated;
grant select on table public.pagos to authenticated;

revoke all on table public.vista_pacientes from anon;
revoke all on table public.vista_pacientes_unicos from anon;
grant select on table public.vista_pacientes to authenticated;
grant select on table public.vista_pacientes_unicos to authenticated;

-- Las RPCs existentes ya no se ejecutan por anon.
revoke all on function public.deudas_pacientes() from public, anon;
revoke all on function public.stats_negocio() from public, anon;
grant execute on function public.deudas_pacientes() to authenticated;
grant execute on function public.stats_negocio() to authenticated;

-- Helpers y triggers: sólo el owner de la base puede invocarlos internamente.
revoke all on function public._p0_numero(text) from public, anon;
revoke all on function public.impedir_mutacion_append_only() from public, anon;
revoke all on function public.bloquear_escritura_directa_pedidos() from public, anon;

-- APIs de negocio. No se concedes EXECUTE a anon ni a PUBLIC.
revoke all on function public.guardar_consulta_clinica(uuid, jsonb) from public, anon;
revoke all on function public.crear_venta(uuid, jsonb) from public, anon;
revoke all on function public.registrar_pago(uuid, uuid, numeric, text, text, text) from public, anon;
revoke all on function public.actualizar_estado_venta(uuid, text) from public, anon;
revoke all on function public.anular_venta(uuid) from public, anon;

grant execute on function public.guardar_consulta_clinica(uuid, jsonb) to authenticated;
grant execute on function public.crear_venta(uuid, jsonb) to authenticated;
grant execute on function public.registrar_pago(uuid, uuid, numeric, text, text, text) to authenticated;
grant execute on function public.actualizar_estado_venta(uuid, text) to authenticated;
grant execute on function public.anular_venta(uuid) to authenticated;

comment on function public.guardar_consulta_clinica(uuid, jsonb) is
  'RPC atómica de perfil y evaluación clínica. Reutilice el mismo consulta_id para reintentos.';
comment on function public.crear_venta(uuid, jsonb) is
  'RPC atómica de venta: paciente/consulta, pedido, stock y ledger en una transacción.';
comment on function public.registrar_pago(uuid, uuid, numeric, text, text, text) is
  'RPC idempotente de cobro: bloquea la venta, inserta pago y actualiza el total abonado.';
comment on function public.anular_venta(uuid) is
  'Anula una venta y devuelve stock una sola vez usando el ledger.';

commit;







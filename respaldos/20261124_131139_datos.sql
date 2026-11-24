--
-- PostgreSQL database dump
--

\restrict Tjw3jvazDr588IoFhxY76vypegrGqrh6F0jYm2ifggalPy4LnohmOLMfb6oAHCV

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.12

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: _p0_numero(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._p0_numero(p_valor text) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
begin
  if p_valor is null or btrim(p_valor) = '' then
    return 0;
  end if;
  return btrim(p_valor)::numeric;
exception
  when invalid_text_representation then
    raise exception 'Valor numérico inválido: %', p_valor using errcode = '22023';
end;
$$;


--
-- Name: FUNCTION _p0_numero(p_valor text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public._p0_numero(p_valor text) IS 'Conversión numérica interna de la migración P0. No es una API de negocio.';


--
-- Name: _p0_operacion_sobre_eliminado(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._p0_operacion_sobre_eliminado(p_payload jsonb) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $_$
declare
  v_ids uuid[] := '{}';
  v_texto text;
begin
  foreach v_texto in array array[
    p_payload ->> 'p_consulta_id',
    p_payload ->> 'p_venta_id',
    p_payload ->> 'p_pedido_id',
    p_payload -> 'p_payload' ->> 'consulta_id'
  ] loop
    if v_texto ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_ids := v_ids || v_texto::uuid;
    end if;
  end loop;
  if cardinality(v_ids) = 0 then
    return false;
  end if;
  return exists (
    select 1 from public.registros_eliminados r
    where r.consulta_ids && v_ids or r.pedido_ids && v_ids
  );
end;
$_$;


--
-- Name: actualizar_estado_venta(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.actualizar_estado_venta(p_venta_id uuid, p_estado text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
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
$$;


--
-- Name: anular_venta(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.anular_venta(p_venta_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$ declare
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
    on conflict (operacion_id, tipo, inventario_id) where operacion_id is not null do nothing
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
 $$;


--
-- Name: FUNCTION anular_venta(p_venta_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.anular_venta(p_venta_id uuid) IS 'Anula una venta y devuelve stock una sola vez usando el ledger.';


--
-- Name: aplicar_operaciones(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aplicar_operaciones(p_operaciones jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
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
      v_resultados := v_resultados || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'failed', 'error', 'Operación sin id o tipo.'));
      continue;
    end if;
    select o.resultado into v_resultado from public.operaciones_aplicadas o where o.id = v_id;
    if found then
      v_resultados := v_resultados || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'applied', 'result', v_resultado, 'replay', true));
      continue;
    end if;
    begin
      if v_tipo in ('REEMBOLSAR_PAGO', 'ANULAR_VENTA', 'UPSERT_INVENTARIO', 'ELIMINAR_INVENTARIO', 'UPSERT_PRECIO', 'ELIMINAR_PRECIO') and not public.es_admin() then
        raise exception 'Solo un administrador puede gestionar inventario, precios, reembolsos o anulaciones.' using errcode = '42501';
      end if;
      insert into public.operaciones_aplicadas (id, tipo_operacion, entidad_id) values (v_id, v_tipo, v_entidad_id) on conflict (id) do nothing returning id into v_claimed;
      v_insertado := v_claimed is not null;
      if not v_insertado then
        select o.resultado into v_resultado from public.operaciones_aplicadas o where o.id = v_id;
        v_resultados := v_resultados || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'applied', 'result', v_resultado, 'replay', true));
        continue;
      end if;
      case v_tipo
        when 'GUARDAR_CONSULTA' then
          v_resultado := public.guardar_consulta_clinica((v_payload ->> 'p_consulta_id')::uuid, v_payload -> 'p_payload');
        when 'CREAR_VENTA' then
          declare
            v_sale_payload jsonb := v_payload -> 'p_payload';
          begin
            v_resultado := public.crear_venta((v_payload ->> 'p_venta_id')::uuid, v_sale_payload);
          end;
        when 'EDITAR_VENTA' then
          v_resultado := public.editar_venta((v_payload ->> 'p_venta_id')::uuid, v_id, nullif(v_operacion ->> 'baseVersion', '')::bigint, v_payload -> 'p_payload');
        when 'REGISTRAR_PAGO' then
          v_resultado := public.registrar_pago((v_payload ->> 'p_pedido_id')::uuid, (v_payload ->> 'p_idempotency_key')::uuid, (v_payload ->> 'p_monto')::numeric, v_payload ->> 'p_metodo', v_payload ->> 'p_referencia', v_payload ->> 'p_comprobante_path');
        when 'REEMBOLSAR_PAGO' then
          v_resultado := public.reembolsar_pago((v_payload ->> 'p_pedido_id')::uuid, (v_payload ->> 'p_idempotency_key')::uuid, (v_payload ->> 'p_monto')::numeric, v_payload ->> 'p_metodo', v_payload ->> 'p_referencia');
        when 'CAMBIAR_ESTADO_VENTA' then
          perform public.actualizar_estado_venta((v_payload ->> 'p_venta_id')::uuid, v_payload ->> 'p_estado');
          v_resultado := jsonb_build_object('venta_id', v_payload ->> 'p_venta_id', 'estado', v_payload ->> 'p_estado');
        when 'ANULAR_VENTA' then
          v_resultado := public.anular_venta((v_payload ->> 'p_venta_id')::uuid);
        when 'UPSERT_INVENTARIO' then
          v_resultado := public.upsert_inventario(nullif(v_payload ->> 'p_inventario_id', '')::bigint, v_payload -> 'p_datos');
        when 'ELIMINAR_INVENTARIO' then
          v_resultado := public.eliminar_inventario((v_payload ->> 'p_inventario_id')::bigint);
        when 'UPSERT_PRECIO' then
          v_resultado := public.upsert_precio(nullif(v_payload ->> 'p_precio_id', '')::bigint, v_payload -> 'p_datos');
        when 'ELIMINAR_PRECIO' then
          v_resultado := public.eliminar_precio((v_payload ->> 'p_precio_id')::bigint);
        when 'ARCHIVAR_CONSULTA' then
          v_resultado := public.archivar_consulta((v_payload ->> 'p_consulta_id')::uuid);
        else
          raise exception 'Tipo de operación no soportado: %', v_tipo using errcode = '22023';
      end case;
      update public.operaciones_aplicadas set resultado = v_resultado, completada_en = now() where id = v_id;
      v_resultados := v_resultados || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'applied', 'result', v_resultado, 'replay', false));
    exception when others then
      v_resultados := v_resultados || jsonb_build_array(jsonb_build_object('id', v_id, 'status', case when sqlstate = '40001' or sqlstate = '23514' or sqlerrm like '%Stock%' then 'conflict' else 'failed' end, 'error', sqlerrm, 'sqlstate', sqlstate));
    end;
  end loop;
  return jsonb_build_object('results', v_resultados, 'processed_at', now());
end;
$$;


--
-- Name: FUNCTION aplicar_operaciones(p_operaciones jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.aplicar_operaciones(p_operaciones jsonb) IS 'Procesa un lote de comandos de Outbox. Cada UUID se aplica una sola vez.';


--
-- Name: archivar_consulta(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.archivar_consulta(p_consulta_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
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
$$;


--
-- Name: bloquear_escritura_directa_pedidos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bloquear_escritura_directa_pedidos() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
declare
  v_transaccion text := nullif(current_setting('app.transaccion_pedido', true), '');
  v_campos_financieros text[] := array['abono', 'pago_nota', 'forma_pago', 'comprobante_url'];
  v_campos_sistema text[] := array['abono', 'pago_nota', 'forma_pago', 'comprobante_url', 'sync_version', 'server_updated_at'];
begin
  -- Borrado definitivo de un paciente (eliminar_paciente_definitivo): solo DELETE y solo dentro de esa funcion.
  if tg_op = 'DELETE' and current_setting('app.eliminacion_paciente', true) = 'on' then
    return old;
  end if;
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
$$;


--
-- Name: contar_registros_paciente(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contar_registros_paciente(p_cedula text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
declare
  v_cedula text := regexp_replace(upper(coalesce(p_cedula, '')), '[^0-9A-Z]', '', 'g');
  v_pacientes uuid[];
  v_consultas uuid[];
  v_pedidos uuid[];
begin
  if auth.uid() is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;
  select coalesce(array_agg(p.id), '{}') into v_pacientes from public.pacientes_perfil p where regexp_replace(upper(coalesce(p.cedula, '')), '[^0-9A-Z]', '', 'g') = v_cedula;
  if cardinality(v_pacientes) = 0 then
    return jsonb_build_object('encontrado', false);
  end if;
  select coalesce(array_agg(c.id), '{}') into v_consultas from public.consultas_clinicas c where c.paciente_id = any(v_pacientes);
  select coalesce(array_agg(v.id), '{}') into v_pedidos from public.pedidos_ventas v where v.paciente_id = any(v_pacientes) or v.consulta_id = any(v_consultas);
  return jsonb_build_object(
    'encontrado', true,
    'consultas', cardinality(v_consultas),
    'ventas', cardinality(v_pedidos),
    'cobros', (select count(*) from public.pagos g where g.pedido_id = any(v_pedidos) and g.tipo = 'COBRO'),
    'reembolsos', (select count(*) from public.pagos g where g.pedido_id = any(v_pedidos) and g.tipo = 'REEMBOLSO'),
    'monto_cobrado', (select coalesce(sum(g.monto), 0) from public.pagos g where g.pedido_id = any(v_pedidos) and g.tipo = 'COBRO'),
    'monto_reembolsado', (select coalesce(sum(g.monto), 0) from public.pagos g where g.pedido_id = any(v_pedidos) and g.tipo = 'REEMBOLSO')
  );
end;
$$;


--
-- Name: crear_perfil_nuevo_usuario(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crear_perfil_nuevo_usuario() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  insert into public.perfiles (user_id, rol) values (new.id, 'personal')
  on conflict (user_id) do nothing;
  return new;
end;
$$;


--
-- Name: crear_venta(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crear_venta(p_venta_id uuid, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $_$
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
$_$;


--
-- Name: FUNCTION crear_venta(p_venta_id uuid, p_payload jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.crear_venta(p_venta_id uuid, p_payload jsonb) IS 'RPC atómica de venta: paciente/consulta, pedido, stock y ledger en una transacción.';


--
-- Name: deudas_pacientes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deudas_pacientes() RETURNS TABLE(cedula text, deuda_total numeric)
    LANGUAGE sql
    AS $$   WITH saldos AS (
    SELECT p.cedula,
           (COALESCE(v.venta::numeric,0)
            - COALESCE(v.venta::numeric,0) * COALESCE(v.descuento::numeric,0) / 100
            - COALESCE(v.abono::numeric,0)) AS saldo
    FROM pacientes_perfil p
    JOIN pedidos_ventas v ON v.paciente_id = p.id
    WHERE COALESCE(v.venta::numeric,0) > 0
      AND COALESCE(v.estado,'') <> 'Anulado'
      AND COALESCE(p.cedula,'') <> '9999999999'
  )
  SELECT cedula, SUM(saldo)::numeric AS deuda_total
  FROM saldos
  GROUP BY cedula
  HAVING SUM(saldo) > 0.004;
 $$;


--
-- Name: editar_venta(uuid, uuid, bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.editar_venta(p_venta_id uuid, p_operacion_id uuid, p_base_version bigint, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $_$
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
  v_bruto numeric;
  v_descuento numeric;
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
  -- Mismas reglas que crear_venta. Si el campo no viene en la edicion se usa el valor guardado.
  if p_payload ? 'venta' and jsonb_typeof(p_payload -> 'venta') <> 'object' then
    raise exception 'Datos de venta inválidos.' using errcode = '22023';
  end if;
  v_bruto := public._p0_numero(case when (p_payload -> 'venta') ? 'venta'
    then p_payload -> 'venta' ->> 'venta' else v_venta.venta end);
  v_descuento := public._p0_numero(case when (p_payload -> 'venta') ? 'descuento'
    then p_payload -> 'venta' ->> 'descuento' else v_venta.descuento end);
  if v_bruto <> round(v_bruto, 2) or v_descuento <> round(v_descuento, 2) then
    raise exception 'Venta y descuento deben tener como máximo dos decimales.' using errcode = '22023';
  end if;
  if v_bruto < 0 then
    raise exception 'El total de venta no puede ser negativo.' using errcode = '22023';
  end if;
  if v_descuento < 0 or v_descuento > 100 then
    raise exception 'El descuento debe estar entre 0 y 100.' using errcode = '22023';
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
  v_total := round(v_bruto - v_bruto * v_descuento / 100, 2);
  v_abono := public._p0_numero(v_venta.abono);
  if v_total + 0.005 < v_abono then
    raise exception 'El nuevo total es menor que el abono registrado (%).', v_abono using errcode = '23514';
  end if;
  return jsonb_build_object('venta_id', p_venta_id, 'version', v_venta.sync_version + 1, 'items', v_items);
end;
$_$;


--
-- Name: eliminar_inventario(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.eliminar_inventario(p_inventario_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
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
$$;


--
-- Name: eliminar_paciente_definitivo(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.eliminar_paciente_definitivo(p_cedula text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede borrar un paciente definitivamente.' using errcode = '42501';
  end if;
  return public.eliminar_paciente_definitivo_impl(p_cedula);
end;
$$;


--
-- Name: eliminar_paciente_definitivo_impl(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.eliminar_paciente_definitivo_impl(p_cedula text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
declare
  v_cedula text := regexp_replace(upper(coalesce(p_cedula, '')), '[^0-9A-Z]', '', 'g');
  v_pacientes uuid[];
  v_consultas uuid[];
  v_pedidos uuid[];
  v_archivos text[];
  v_cobros integer;
begin
  if auth.uid() is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;
  if v_cedula = '' then
    raise exception 'La cédula es obligatoria.' using errcode = '22023';
  end if;
  select coalesce(array_agg(p.id), '{}') into v_pacientes from public.pacientes_perfil p where regexp_replace(upper(coalesce(p.cedula, '')), '[^0-9A-Z]', '', 'g') = v_cedula;
  if cardinality(v_pacientes) = 0 then
    return jsonb_build_object('encontrado', false, 'paciente_ids', '[]'::jsonb, 'consulta_ids', '[]'::jsonb, 'pedido_ids', '[]'::jsonb, 'archivos', '[]'::jsonb);
  end if;
  perform 1 from public.pacientes_perfil p where p.id = any(v_pacientes) order by p.id for update;
  select coalesce(array_agg(c.id), '{}') into v_consultas from public.consultas_clinicas c where c.paciente_id = any(v_pacientes);
  select coalesce(array_agg(v.id), '{}') into v_pedidos from public.pedidos_ventas v where v.paciente_id = any(v_pacientes) or v.consulta_id = any(v_consultas);
  perform 1 from public.pedidos_ventas v where v.id = any(v_pedidos) order by v.id for update;
  perform 1 from public.inventario i where i.id in (select m.inventario_id from public.inventario_movimientos m where m.pedido_id = any(v_pedidos)) order by i.id for update;
  perform set_config('app.eliminacion_paciente', 'on', true);
  -- Ventas no entregadas: los productos vuelven al inventario (salidas menos devoluciones). Las entregadas no.
  update public.inventario i
  set stock = i.stock + n.neto, sync_version = i.sync_version + 1, server_updated_at = now()
  from (
    select m.inventario_id, sum(case when m.tipo = 'SALIDA' then m.cantidad else -m.cantidad end) as neto
    from public.inventario_movimientos m
    join public.pedidos_ventas v on v.id = m.pedido_id
    where m.pedido_id = any(v_pedidos) and coalesce(v.estado, '') <> 'Entregado'
    group by m.inventario_id
  ) n
  where i.id = n.inventario_id and n.neto > 0;
  select coalesce(array_agg(distinct x), '{}') into v_archivos from (
    select g.comprobante_path as x from public.pagos g where g.pedido_id = any(v_pedidos) and btrim(coalesce(g.comprobante_path, '')) <> ''
    union
    select v.comprobante_url from public.pedidos_ventas v where v.id = any(v_pedidos) and btrim(coalesce(v.comprobante_url, '')) <> ''
  ) q;
  select count(*) into v_cobros from public.pagos g where g.pedido_id = any(v_pedidos);
  delete from public.consultas_clinicas_revisiones where consulta_id = any(v_consultas);
  delete from public.inventario_movimientos where pedido_id = any(v_pedidos);
  delete from public.pagos where pedido_id = any(v_pedidos);
  delete from public.pedido_items where pedido_id = any(v_pedidos);
  delete from public.pedidos_ventas where id = any(v_pedidos);
  delete from public.consultas_clinicas where id = any(v_consultas);
  delete from public.pacientes_perfil where id = any(v_pacientes);
  insert into public.registros_eliminados (paciente_ids, consulta_ids, pedido_ids, consultas, ventas, cobros)
  values (v_pacientes, v_consultas, v_pedidos, cardinality(v_consultas), cardinality(v_pedidos), v_cobros);
  perform set_config('app.eliminacion_paciente', 'off', true);
  return jsonb_build_object(
    'encontrado', true,
    'paciente_ids', to_jsonb(v_pacientes),
    'consulta_ids', to_jsonb(v_consultas),
    'pedido_ids', to_jsonb(v_pedidos),
    'archivos', to_jsonb(v_archivos),
    'consultas', cardinality(v_consultas),
    'ventas', cardinality(v_pedidos),
    'cobros', v_cobros
  );
end;
$$;


--
-- Name: eliminar_precio(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.eliminar_precio(p_precio_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
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
$$;


--
-- Name: es_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.es_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.perfiles p
    where p.user_id = auth.uid() and p.rol = 'admin'
  );
$$;


--
-- Name: guardar_consulta_clinica(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardar_consulta_clinica(p_consulta_id uuid, p_payload jsonb) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
  select public.guardar_consulta_clinica_v2(
    p_consulta_id,
    p_payload,
    nullif(btrim(coalesce(p_payload ->> 'base_version', '')), '')::bigint
  );
$$;


--
-- Name: FUNCTION guardar_consulta_clinica(p_consulta_id uuid, p_payload jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guardar_consulta_clinica(p_consulta_id uuid, p_payload jsonb) IS 'Envoltorio compatible: toma base_version del payload y delega en guardar_consulta_clinica_v2.';


--
-- Name: guardar_consulta_clinica_v2(uuid, jsonb, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardar_consulta_clinica_v2(p_consulta_id uuid, p_payload jsonb, p_base_version bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $_$
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
  v_actual public.consultas_clinicas;
  v_version_actual bigint := 0;
  v_version_nueva bigint := 0;
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

  -- La version viaja dentro del payload para no cambiar la firma que usan
  -- crear_venta y aplicar_operaciones. El parametro explicito gana si viene.
  if p_base_version is null then
    p_base_version := nullif(btrim(coalesce(p_payload ->> 'base_version', '')), '')::bigint;
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

  -- FOR UPDATE serializa dos equipos que guarden la MISMA consulta a la vez:
  -- el segundo espera, ve la version nueva y (si la suya es vieja) recibe 40001
  -- en vez de pisar el trabajo del primero.
  select c.* into v_actual
  from public.consultas_clinicas c
  where c.id = v_consulta_id
  for update;

  if found then
    v_paciente_previo := v_actual.paciente_id;
    v_version_actual := coalesce(v_actual.sync_version, 0);

    if v_paciente_previo <> v_paciente_id then
      raise exception 'La consulta % pertenece a otro paciente.', v_consulta_id
        using errcode = '23514';
    end if;

    if p_base_version is not null and v_version_actual <> p_base_version then
      raise exception 'La evaluación clínica fue modificada en otro dispositivo (servidor %, local %).',
        v_version_actual, p_base_version
        using errcode = '40001';
    end if;
  end if;

  -- Blindaje: la version la decide SIEMPRE el servidor. Aunque un cliente
  -- antiguo mande estas columnas en el payload, se ignoran.
  v_consulta := v_consulta
    - array['id', 'paciente_id', 'cedula', 'nombre', 'created_at',
            'sync_version', 'server_updated_at', 'sync_version_consulta', 'syncVersion'];

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
      v_consulta || jsonb_build_object(
        'id', v_consulta_id,
        'paciente_id', v_paciente_id,
        -- jsonb_populate_record NO aplica defaults: rellena con NULL lo que
        -- falta. Como sync_version y server_updated_at son NOT NULL desde la
        -- migracion 002, se inyectan aqui para que una consulta NUEVA nunca
        -- falle por dejar esas columnas en NULL.
        'sync_version', 0,
        'server_updated_at', now(),
        -- Mismo motivo: si created_at es NOT NULL y no viene en el payload,
        -- populate_record lo dejaria en NULL.
        'created_at', now()
      )
    )::text;

    -- sync_version arranca en 0 (se inyecto arriba en el JSON del INSERT).
    v_version_nueva := 0;

  elsif v_consulta <> '{}'::jsonb then
    select string_agg(format('%I = r.%I', c.column_name, c.column_name), ', ' order by c.column_name)
    into v_asignaciones
    from jsonb_object_keys(v_consulta) as clave(clave)
    join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = 'consultas_clinicas'
     and c.column_name = clave.clave
    where c.column_name not in ('id', 'paciente_id', 'created_at',
                                'sync_version', 'server_updated_at');

    if v_asignaciones is null then
      raise exception 'La evaluación no contiene columnas clínicas válidas.' using errcode = '22023';
    end if;

    -- Revision previa: la version que va a ser reemplazada queda guardada.
    -- Es la garantia de que "el ultimo gana" nunca destruye informacion.
    insert into public.consultas_clinicas_revisiones
      (consulta_id, version, snapshot, motivo, editado_por)
    values
      (v_consulta_id, v_version_actual, to_jsonb(v_actual), 'edicion', v_usuario);

    v_version_nueva := v_version_actual + 1;

    v_sql := format(
      'update public.consultas_clinicas as c
          set %s,
              sync_version = $4::bigint,
              server_updated_at = now()
        from pg_catalog.jsonb_populate_record(null::public.consultas_clinicas, $1::jsonb) as r
        where c.id = $2 and c.paciente_id = $3',
      v_asignaciones
    );
    execute v_sql using v_consulta::text, v_consulta_id, v_paciente_id, v_version_nueva;

    if not found then
      raise exception 'No se pudo actualizar la consulta %.', v_consulta_id using errcode = 'P0002';
    end if;

  else
    -- Nada que escribir: se devuelve la version actual sin incrementarla.
    v_version_nueva := v_version_actual;
  end if;

  return jsonb_build_object(
    'consulta_id', v_consulta_id,
    'paciente_id', v_paciente_id,
    'creada', v_creada,
    'sync_version', v_version_nueva
  );
end;
$_$;


--
-- Name: FUNCTION guardar_consulta_clinica_v2(p_consulta_id uuid, p_payload jsonb, p_base_version bigint); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guardar_consulta_clinica_v2(p_consulta_id uuid, p_payload jsonb, p_base_version bigint) IS 'Guarda perfil y evaluación clínica con control de versión (40001 si otro equipo editó antes) y revisión previa obligatoria.';


--
-- Name: guardar_revision_consulta(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardar_revision_consulta() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
declare
  v_sistema text[] := array['sync_version', 'server_updated_at', 'archived_at', 'created_at'];
begin
  if (to_jsonb(new) - v_sistema) = (to_jsonb(old) - v_sistema) then
    return null;
  end if;
  insert into public.consultas_clinicas_revisiones (consulta_id, version, snapshot, motivo, editado_por)
  values (
    old.id,
    old.sync_version,
    to_jsonb(old),
    'Edición',
    coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  );
  return null;
end;
$$;


--
-- Name: impedir_mutacion_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.impedir_mutacion_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
begin
  if tg_op = 'DELETE' and current_setting('app.eliminacion_paciente', true) = 'on' then
    return old;
  end if;
  raise exception 'La tabla % es append-only: no se permite % ni UPDATE.', tg_table_name, tg_op
    using errcode = '55000';
end;
$$;


--
-- Name: limitar_usuarios_vermas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limitar_usuarios_vermas() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
declare
  v_total integer;
begin
  select count(*) into v_total from auth.users;
  if v_total >= 3 then
    raise exception 'VER+ admite 3 usuarios como maximo. Elimina un usuario antes de crear otro.';
  end if;
  return new;
end;
$$;


--
-- Name: mi_rol(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mi_rol() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select coalesce(
    (select p.rol from public.perfiles p where p.user_id = auth.uid()),
    'personal'
  );
$$;


--
-- Name: reembolsar_pago(uuid, uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reembolsar_pago(p_pedido_id uuid, p_idempotency_key uuid, p_monto numeric, p_metodo text, p_referencia text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
declare
  v_usuario uuid := auth.uid();
  v_estado text;
  v_abono numeric;
  v_monto numeric := round(p_monto, 2);
  v_saldo numeric;
  v_pago_id uuid;
begin
  if v_usuario is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Falta la clave de idempotencia del reembolso.' using errcode = '22023';
  end if;
  select p.id into v_pago_id from public.pagos p where p.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('pago_id', v_pago_id, 'reembolso', true, 'ya_existia', true);
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto del reembolso debe ser mayor que cero.' using errcode = '22023';
  end if;
  select p.estado, public._p0_numero(p.abono) into v_estado, v_abono from public.pedidos_ventas p where p.id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido % no existe.', p_pedido_id using errcode = 'P0002';
  end if;
  if v_estado = 'Anulado' then
    raise exception 'No se puede reembolsar una venta ya anulada.' using errcode = '23514';
  end if;
  if v_abono <= 0 then
    raise exception 'Esta venta no tiene saldo abonado a devolver.' using errcode = '23514';
  end if;
  if v_monto > v_abono + 0.005 then
    raise exception 'El reembolso (%) supera el abonado (%).', v_monto, v_abono using errcode = '23514';
  end if;
  insert into public.pagos (idempotency_key, pedido_id, monto, metodo, referencia, tipo, created_by) values (p_idempotency_key, p_pedido_id, v_monto, coalesce(nullif(btrim(p_metodo), ''), 'Efectivo'), p_referencia, 'REEMBOLSO', v_usuario) returning id into v_pago_id;
  v_saldo := round(v_abono - v_monto, 2);
  perform set_config('app.transaccion_pedido', 'reembolsar_pago', true);
  update public.pedidos_ventas set abono = v_saldo::text, pago_nota = coalesce(pago_nota, '') || case when coalesce(pago_nota, '') = '' then '' else chr(10) end || '[' || current_date::text || '] -' || v_monto::text || ' ' || coalesce(nullif(btrim(p_metodo), ''), 'Efectivo') where id = p_pedido_id;
  return jsonb_build_object('pago_id', v_pago_id, 'reembolso', true, 'monto', v_monto, 'abono_restante', v_saldo);
end;
$$;


--
-- Name: registrar_pago(uuid, uuid, numeric, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_pago(p_pedido_id uuid, p_idempotency_key uuid, p_monto numeric, p_metodo text, p_referencia text DEFAULT NULL::text, p_comprobante_path text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
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
$$;


--
-- Name: FUNCTION registrar_pago(p_pedido_id uuid, p_idempotency_key uuid, p_monto numeric, p_metodo text, p_referencia text, p_comprobante_path text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.registrar_pago(p_pedido_id uuid, p_idempotency_key uuid, p_monto numeric, p_metodo text, p_referencia text, p_comprobante_path text) IS 'RPC idempotente de cobro: bloquea la venta, inserta pago y actualiza el total abonado.';


--
-- Name: rellenar_campos_sistema(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rellenar_campos_sistema() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$ begin
  if new.sync_version is null then new.sync_version := 0; end if;
  if new.server_updated_at is null then new.server_updated_at := now(); end if;
  if new.created_at is null then new.created_at := now(); end if;
  return new;
end;
 $$;


--
-- Name: revisiones_consulta(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revisiones_consulta(p_consulta_id uuid, p_limite integer DEFAULT 20) RETURNS TABLE(version integer, motivo text, editado_en timestamp with time zone, editado_por text, snapshot jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select
    r.version,
    r.motivo,
    r.editado_en,
    coalesce(u.email::text, '') as editado_por,
    r.snapshot
  from public.consultas_clinicas_revisiones r
  left join auth.users u on u.id = r.editado_por
  where r.consulta_id = p_consulta_id
    and auth.uid() is not null
  order by r.version desc, r.editado_en desc
  limit greatest(1, least(coalesce(p_limite, 20), 50));
$$;


--
-- Name: FUNCTION revisiones_consulta(p_consulta_id uuid, p_limite integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.revisiones_consulta(p_consulta_id uuid, p_limite integer) IS 'Versiones anteriores de una consulta clinica, para el panel de conflictos.';


--
-- Name: stats_negocio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stats_negocio() RETURNS TABLE(ventas_mes numeric, abonos_pendientes numeric, gastos_mes numeric, utilidad_neta numeric, total_pacientes bigint)
    LANGUAGE sql
    AS $$   WITH v AS (
    SELECT
      (COALESCE(venta::numeric,0) - COALESCE(venta::numeric,0) * COALESCE(descuento::numeric,0) / 100) AS vfinal,
      COALESCE(abono::numeric,0) AS abono,
      (COALESCE(costo_lunas_int::numeric,0) + COALESCE(costo_armazon_int::numeric,0) +
       COALESCE(costo_accesorio_int::numeric,0) + COALESCE(costo_tratamientos_int::numeric,0) +
       COALESCE(costo_varios_int::numeric,0)) AS gastos,
      fecha::date AS f
    FROM pedidos_ventas
    WHERE COALESCE(venta::numeric,0) > 0
      AND COALESCE(estado,'') <> 'Anulado'
  )
  SELECT
    COALESCE(SUM(vfinal) FILTER (WHERE f >= date_trunc('month', now())::date), 0)::numeric,
    COALESCE(SUM(GREATEST(vfinal - abono, 0)), 0)::numeric,
    COALESCE(SUM(gastos) FILTER (WHERE f >= date_trunc('month', now())::date), 0)::numeric,
    (COALESCE(SUM(vfinal) FILTER (WHERE f >= date_trunc('month', now())::date), 0)
     - COALESCE(SUM(gastos) FILTER (WHERE f >= date_trunc('month', now())::date), 0))::numeric,
    (SELECT COUNT(*) FROM pacientes_perfil WHERE COALESCE(cedula,'') <> '' AND cedula <> '9999999999')::bigint
  FROM v;
 $$;


--
-- Name: upsert_inventario(bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_inventario(p_inventario_id bigint, p_datos jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
declare
  v_id bigint;
  v_record public.inventario%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Autenticacion requerida.' using errcode = '42501';
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
    -- REGLA: si la clave NO viene en el payload, se conserva el valor actual
    -- en lugar de sobrescribirlo con NULL. Ese era el origen de la perdida.
    update public.inventario
    set stock = case
          when p_datos ? 'stock' and (p_datos ->> 'stock') is not null
            then (p_datos ->> 'stock')::integer
          else stock end,
        marca = case when p_datos ? 'marca' then p_datos ->> 'marca' else marca end,
        modelo = case when p_datos ? 'modelo' then p_datos ->> 'modelo' else modelo end,
        color = case when p_datos ? 'color' then p_datos ->> 'color' else color end,
        precio = case when p_datos ? 'precio' then p_datos ->> 'precio' else precio end,
        descripcion = case when p_datos ? 'descripcion' then p_datos ->> 'descripcion' else descripcion end,
        categoria = case when p_datos ? 'categoria' then p_datos ->> 'categoria' else categoria end,
        codigo = case when p_datos ? 'codigo' then p_datos ->> 'codigo' else codigo end,
        tipo_armazon = case when p_datos ? 'tipo_armazon' then p_datos ->> 'tipo_armazon' else tipo_armazon end,
        param_horizontal = case when p_datos ? 'param_horizontal' then p_datos ->> 'param_horizontal' else param_horizontal end,
        param_puente = case when p_datos ? 'param_puente' then p_datos ->> 'param_puente' else param_puente end,
        param_vertical = case when p_datos ? 'param_vertical' then p_datos ->> 'param_vertical' else param_vertical end,
        param_diagonal = case when p_datos ? 'param_diagonal' then p_datos ->> 'param_diagonal' else param_diagonal end,
        nombre_accesorio = case when p_datos ? 'nombre_accesorio' then p_datos ->> 'nombre_accesorio' else nombre_accesorio end,
        caracteristica = case when p_datos ? 'caracteristica' then p_datos ->> 'caracteristica' else caracteristica end,
        material = case when p_datos ? 'material' then p_datos ->> 'material' else material end,
        material_nota = case when p_datos ? 'material_nota' then p_datos ->> 'material_nota' else material_nota end,
        costo_compra = case when p_datos ? 'costo_compra' then p_datos ->> 'costo_compra' else costo_compra end,
        imagen_url = case when p_datos ? 'imagen_url' then p_datos ->> 'imagen_url' else imagen_url end,
        param_frontal = case when p_datos ? 'param_frontal' then p_datos ->> 'param_frontal' else param_frontal end,
        param_varillas = case when p_datos ? 'param_varillas' then p_datos ->> 'param_varillas' else param_varillas end,
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
$$;


--
-- Name: FUNCTION upsert_inventario(p_inventario_id bigint, p_datos jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.upsert_inventario(p_inventario_id bigint, p_datos jsonb) IS 'Crea o actualiza un producto. Al actualizar solo sobrescribe las columnas cuya clave llega en p_datos; el resto conserva su valor.';


--
-- Name: upsert_precio(bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_precio(p_precio_id bigint, p_datos jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
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
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: consultas_clinicas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultas_clinicas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    paciente_id uuid,
    fecha text,
    notas_clinicas text,
    avsl_od text,
    avsc_od text,
    esfera_od text,
    cilindro_od text,
    eje_od text,
    adicion_od text,
    dnp_od text,
    altura_od text,
    avcl_od text,
    avcc_od text,
    avsl_oi text,
    avsc_oi text,
    esfera_oi text,
    cilindro_oi text,
    eje_oi text,
    adicion_oi text,
    dnp_oi text,
    altura_oi text,
    avcl_oi text,
    avcc_oi text,
    k1_d_od text,
    k2_d_od text,
    k1_mm_od text,
    k2_mm_od text,
    eje_k1_od text,
    eje_k2_od text,
    astig_corneal_od text,
    eje_astig_od text,
    obs_k_od text,
    k1_d_oi text,
    k2_d_oi text,
    k1_mm_oi text,
    k2_mm_oi text,
    eje_k1_oi text,
    eje_k2_oi text,
    astig_corneal_oi text,
    eje_astig_oi text,
    obs_k_oi text,
    auto_esf_od text,
    auto_cil_od text,
    auto_eje_od text,
    auto_esf_oi text,
    auto_cil_oi text,
    auto_eje_oi text,
    auto_esf_od_2 text,
    auto_cil_od_2 text,
    auto_eje_od_2 text,
    auto_esf_oi_2 text,
    auto_cil_oi_2 text,
    auto_eje_oi_2 text,
    lenso_esf_od text,
    lenso_cil_od text,
    lenso_eje_od text,
    lenso_add_od text,
    lenso_avl_od text,
    lenso_avc_od text,
    lenso_esf_oi text,
    lenso_cil_oi text,
    lenso_eje_oi text,
    lenso_add_oi text,
    lenso_avl_oi text,
    lenso_avc_oi text,
    created_at timestamp with time zone DEFAULT now(),
    sync_version bigint DEFAULT 0 NOT NULL,
    server_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone
);


--
-- Name: consultas_clinicas_revisiones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultas_clinicas_revisiones (
    id uuid DEFAULT extensions.gen_random_uuid() NOT NULL,
    consulta_id uuid NOT NULL,
    version integer NOT NULL,
    snapshot jsonb NOT NULL,
    motivo text,
    editado_por uuid DEFAULT auth.uid() NOT NULL,
    editado_en timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventario (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    marca text,
    modelo text,
    color text,
    precio text,
    stock integer DEFAULT 0,
    descripcion text,
    categoria text,
    codigo text,
    tipo_armazon text,
    param_horizontal text,
    param_puente text,
    param_vertical text,
    param_diagonal text,
    nombre_accesorio text,
    caracteristica text,
    material text,
    material_nota text,
    costo_compra text,
    imagen_url text,
    param_frontal text,
    param_varillas text,
    sync_version bigint DEFAULT 0 NOT NULL,
    server_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_ref text
);


--
-- Name: inventario_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.inventario ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.inventario_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inventario_movimientos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventario_movimientos (
    id bigint NOT NULL,
    pedido_id uuid NOT NULL,
    inventario_id bigint NOT NULL,
    tipo text NOT NULL,
    cantidad integer NOT NULL,
    created_by uuid DEFAULT auth.uid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    operacion_id uuid,
    CONSTRAINT inventario_movimientos_cantidad_check CHECK ((cantidad > 0)),
    CONSTRAINT inventario_movimientos_tipo_check CHECK ((tipo = ANY (ARRAY['SALIDA'::text, 'DEVOLUCION'::text])))
);


--
-- Name: TABLE inventario_movimientos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inventario_movimientos IS 'Ledger append-only de salidas y devoluciones. No se actualiza ni se borra.';


--
-- Name: inventario_movimientos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.inventario_movimientos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.inventario_movimientos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: lista_precios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lista_precios (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tipo_lente text,
    material text,
    tratamiento text,
    rango_medida text,
    costo_laboratorio text,
    precio_sugerido text,
    notas text,
    sync_version bigint DEFAULT 0 NOT NULL,
    server_updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lista_precios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.lista_precios ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.lista_precios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: operaciones_aplicadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operaciones_aplicadas (
    id uuid NOT NULL,
    tipo_operacion text NOT NULL,
    entidad_id text,
    resultado jsonb,
    aplicada_por uuid DEFAULT auth.uid() NOT NULL,
    creada_en timestamp with time zone DEFAULT now() NOT NULL,
    completada_en timestamp with time zone
);


--
-- Name: TABLE operaciones_aplicadas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.operaciones_aplicadas IS 'Registro durable de comandos aplicada. La clave id es el UUID de la Outbox local.';


--
-- Name: pacientes_perfil; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pacientes_perfil (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cedula text,
    nombre text,
    telefono text,
    correo text,
    fecha_nacimiento text,
    antecedentes text,
    created_at timestamp with time zone DEFAULT now(),
    alias text,
    sync_version bigint DEFAULT 0 NOT NULL,
    server_updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pacientes_archivados; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.pacientes_archivados WITH (security_invoker='on') AS
 SELECT DISTINCT upper(btrim(cedula)) AS cedula
   FROM public.pacientes_perfil p
  WHERE ((cedula IS NOT NULL) AND (btrim(cedula) <> ''::text) AND (EXISTS ( SELECT 1
           FROM public.consultas_clinicas c
          WHERE ((c.paciente_id = p.id) AND (c.archived_at IS NOT NULL)))) AND (NOT (EXISTS ( SELECT 1
           FROM public.consultas_clinicas v
          WHERE ((v.paciente_id = p.id) AND (v.archived_at IS NULL))))));


--
-- Name: pagos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pagos (
    id uuid DEFAULT extensions.gen_random_uuid() NOT NULL,
    idempotency_key uuid NOT NULL,
    pedido_id uuid NOT NULL,
    monto numeric(14,2) NOT NULL,
    metodo text NOT NULL,
    referencia text,
    comprobante_path text,
    created_by uuid DEFAULT auth.uid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    operacion_id uuid,
    tipo text DEFAULT 'COBRO'::text NOT NULL,
    CONSTRAINT pagos_metodo_check CHECK ((metodo = ANY (ARRAY['Efectivo'::text, 'Transferencia'::text, 'Tarjeta'::text]))),
    CONSTRAINT pagos_monto_check CHECK ((monto > (0)::numeric)),
    CONSTRAINT pagos_tipo_valido CHECK ((tipo = ANY (ARRAY['COBRO'::text, 'REEMBOLSO'::text])))
);


--
-- Name: TABLE pagos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pagos IS 'Cobros inmutables. Usar registrar_pago; nunca UPDATE/DELETE sobre esta tabla.';


--
-- Name: pedido_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedido_items (
    id bigint NOT NULL,
    pedido_id uuid NOT NULL,
    inventario_id bigint NOT NULL,
    cantidad integer NOT NULL,
    precio_unitario text,
    codigo_snapshot text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pedido_items_cantidad_check CHECK ((cantidad > 0))
);


--
-- Name: TABLE pedido_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pedido_items IS 'Detalle inmutable de la venta. Es la fuente para devolver stock al anular.';


--
-- Name: pedido_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pedido_items ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pedido_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pedidos_ventas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedidos_ventas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    paciente_id uuid,
    consulta_id uuid,
    fecha text,
    venta text,
    abono text,
    descuento text,
    forma_pago text,
    pago_nota text,
    estado text,
    notas text,
    codigo_armazon text,
    tipo_armazon text,
    param_horizontal text,
    param_puente text,
    param_vertical text,
    param_diagonal text,
    tipo_lente text,
    material_lente text,
    material_nota text,
    accesorio_id text,
    tratam_ninguno text,
    tratam_ar text,
    tratam_ar_azul text,
    tratam_azul text,
    tratam_tinturado text,
    tratam_tinturado_nota text,
    tratam_foto text,
    tratam_foto_nota text,
    tratam_trans text,
    tratam_trans_nota text,
    costo_armazon_int text,
    costo_lunas_int text,
    costo_accesorio_int text,
    costo_tratamientos_int text,
    costo_varios_int text,
    created_at timestamp with time zone DEFAULT now(),
    comprobante_url text,
    sync_version bigint DEFAULT 0 NOT NULL,
    server_updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: perfiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.perfiles (
    user_id uuid NOT NULL,
    rol text DEFAULT 'personal'::text NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT perfiles_rol_valido CHECK ((rol = ANY (ARRAY['admin'::text, 'personal'::text])))
);


--
-- Name: registros_eliminados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registros_eliminados (
    id uuid DEFAULT extensions.gen_random_uuid() NOT NULL,
    paciente_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    consulta_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    pedido_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    consultas integer DEFAULT 0 NOT NULL,
    ventas integer DEFAULT 0 NOT NULL,
    cobros integer DEFAULT 0 NOT NULL,
    eliminado_por uuid DEFAULT auth.uid(),
    eliminado_en timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE registros_eliminados; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.registros_eliminados IS 'Bitacora minima de borrados definitivos: solo codigos aleatorios, cantidades, fecha y usuario. Los equipos la leen para limpiar su copia local.';


--
-- Name: vista_pacientes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vista_pacientes WITH (security_invoker='on') AS
 SELECT c.id,
    p.id AS paciente_id,
    v.id AS pedido_id,
    p.cedula,
    p.nombre,
    p.telefono,
    p.correo,
    p.fecha_nacimiento,
    p.antecedentes,
    c.fecha,
    c.notas_clinicas,
    c.avsl_od,
    c.avsc_od,
    c.esfera_od,
    c.cilindro_od,
    c.eje_od,
    c.adicion_od,
    c.dnp_od,
    c.altura_od,
    c.avcl_od,
    c.avcc_od,
    c.avsl_oi,
    c.avsc_oi,
    c.esfera_oi,
    c.cilindro_oi,
    c.eje_oi,
    c.adicion_oi,
    c.dnp_oi,
    c.altura_oi,
    c.avcl_oi,
    c.avcc_oi,
    c.k1_d_od,
    c.k2_d_od,
    c.k1_mm_od,
    c.k2_mm_od,
    c.eje_k1_od,
    c.eje_k2_od,
    c.astig_corneal_od,
    c.eje_astig_od,
    c.obs_k_od,
    c.k1_d_oi,
    c.k2_d_oi,
    c.k1_mm_oi,
    c.k2_mm_oi,
    c.eje_k1_oi,
    c.eje_k2_oi,
    c.astig_corneal_oi,
    c.eje_astig_oi,
    c.obs_k_oi,
    c.auto_esf_od,
    c.auto_cil_od,
    c.auto_eje_od,
    c.auto_esf_oi,
    c.auto_cil_oi,
    c.auto_eje_oi,
    c.auto_esf_od_2,
    c.auto_cil_od_2,
    c.auto_eje_od_2,
    c.auto_esf_oi_2,
    c.auto_cil_oi_2,
    c.auto_eje_oi_2,
    c.lenso_esf_od,
    c.lenso_cil_od,
    c.lenso_eje_od,
    c.lenso_add_od,
    c.lenso_avl_od,
    c.lenso_avc_od,
    c.lenso_esf_oi,
    c.lenso_cil_oi,
    c.lenso_eje_oi,
    c.lenso_add_oi,
    c.lenso_avl_oi,
    c.lenso_avc_oi,
    COALESCE(v.venta, ''::text) AS venta,
    COALESCE(v.abono, ''::text) AS abono,
    COALESCE(v.descuento, '0'::text) AS descuento,
    COALESCE(v.forma_pago, 'Efectivo'::text) AS forma_pago,
    COALESCE(v.pago_nota, ''::text) AS pago_nota,
    COALESCE(v.estado, 'Ninguno'::text) AS estado,
    COALESCE(v.notas, ''::text) AS notas,
    COALESCE(v.codigo_armazon, ''::text) AS codigo_armazon,
    COALESCE(v.tipo_armazon, ''::text) AS tipo_armazon,
    COALESCE(v.param_horizontal, ''::text) AS param_horizontal,
    COALESCE(v.param_puente, ''::text) AS param_puente,
    COALESCE(v.param_vertical, ''::text) AS param_vertical,
    COALESCE(v.param_diagonal, ''::text) AS param_diagonal,
    COALESCE(v.tipo_lente, ''::text) AS tipo_lente,
    COALESCE(v.material_lente, ''::text) AS material_lente,
    COALESCE(v.material_nota, ''::text) AS material_nota,
    COALESCE(v.accesorio_id, ''::text) AS accesorio_id,
    COALESCE(v.tratam_ninguno, 'NO'::text) AS tratam_ninguno,
    COALESCE(v.tratam_ar, 'NO'::text) AS tratam_ar,
    COALESCE(v.tratam_ar_azul, 'NO'::text) AS tratam_ar_azul,
    COALESCE(v.tratam_azul, 'NO'::text) AS tratam_azul,
    COALESCE(v.tratam_tinturado, 'NO'::text) AS tratam_tinturado,
    COALESCE(v.tratam_tinturado_nota, ''::text) AS tratam_tinturado_nota,
    COALESCE(v.tratam_foto, 'NO'::text) AS tratam_foto,
    COALESCE(v.tratam_foto_nota, ''::text) AS tratam_foto_nota,
    COALESCE(v.tratam_trans, 'NO'::text) AS tratam_trans,
    COALESCE(v.tratam_trans_nota, ''::text) AS tratam_trans_nota,
    COALESCE(v.costo_armazon_int, ''::text) AS costo_armazon_int,
    COALESCE(v.costo_lunas_int, ''::text) AS costo_lunas_int,
    COALESCE(v.costo_accesorio_int, ''::text) AS costo_accesorio_int,
    COALESCE(v.costo_tratamientos_int, ''::text) AS costo_tratamientos_int,
    COALESCE(v.costo_varios_int, ''::text) AS costo_varios_int,
    COALESCE(v.comprobante_url, ''::text) AS comprobante_url,
    p.alias,
    COALESCE(v.fecha, c.fecha) AS fecha_venta
   FROM ((public.consultas_clinicas c
     JOIN public.pacientes_perfil p ON ((c.paciente_id = p.id)))
     LEFT JOIN public.pedidos_ventas v ON ((c.id = v.consulta_id)));


--
-- Name: vista_pacientes_unicos; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vista_pacientes_unicos WITH (security_invoker='on') AS
 SELECT DISTINCT ON (cedula) id,
    paciente_id,
    pedido_id,
    cedula,
    nombre,
    telefono,
    correo,
    fecha_nacimiento,
    antecedentes,
    fecha,
    notas_clinicas,
    avsl_od,
    avsc_od,
    esfera_od,
    cilindro_od,
    eje_od,
    adicion_od,
    dnp_od,
    altura_od,
    avcl_od,
    avcc_od,
    avsl_oi,
    avsc_oi,
    esfera_oi,
    cilindro_oi,
    eje_oi,
    adicion_oi,
    dnp_oi,
    altura_oi,
    avcl_oi,
    avcc_oi,
    k1_d_od,
    k2_d_od,
    k1_mm_od,
    k2_mm_od,
    eje_k1_od,
    eje_k2_od,
    astig_corneal_od,
    eje_astig_od,
    obs_k_od,
    k1_d_oi,
    k2_d_oi,
    k1_mm_oi,
    k2_mm_oi,
    eje_k1_oi,
    eje_k2_oi,
    astig_corneal_oi,
    eje_astig_oi,
    obs_k_oi,
    auto_esf_od,
    auto_cil_od,
    auto_eje_od,
    auto_esf_oi,
    auto_cil_oi,
    auto_eje_oi,
    auto_esf_od_2,
    auto_cil_od_2,
    auto_eje_od_2,
    auto_esf_oi_2,
    auto_cil_oi_2,
    auto_eje_oi_2,
    lenso_esf_od,
    lenso_cil_od,
    lenso_eje_od,
    lenso_add_od,
    lenso_avl_od,
    lenso_avc_od,
    lenso_esf_oi,
    lenso_cil_oi,
    lenso_eje_oi,
    lenso_add_oi,
    lenso_avl_oi,
    lenso_avc_oi,
    venta,
    abono,
    descuento,
    forma_pago,
    pago_nota,
    estado,
    notas,
    codigo_armazon,
    tipo_armazon,
    param_horizontal,
    param_puente,
    param_vertical,
    param_diagonal,
    tipo_lente,
    material_lente,
    material_nota,
    accesorio_id,
    tratam_ninguno,
    tratam_ar,
    tratam_ar_azul,
    tratam_azul,
    tratam_tinturado,
    tratam_tinturado_nota,
    tratam_foto,
    tratam_foto_nota,
    tratam_trans,
    tratam_trans_nota,
    costo_armazon_int,
    costo_lunas_int,
    costo_accesorio_int,
    costo_tratamientos_int,
    costo_varios_int,
    comprobante_url,
    alias,
    fecha_venta
   FROM public.vista_pacientes
  ORDER BY cedula, fecha DESC, id DESC;


--
-- Name: vista_pacientes_versionada; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vista_pacientes_versionada WITH (security_invoker='on') AS
 SELECT v.id,
    v.paciente_id,
    v.pedido_id,
    v.cedula,
    v.nombre,
    v.telefono,
    v.correo,
    v.fecha_nacimiento,
    v.antecedentes,
    v.fecha,
    v.notas_clinicas,
    v.avsl_od,
    v.avsc_od,
    v.esfera_od,
    v.cilindro_od,
    v.eje_od,
    v.adicion_od,
    v.dnp_od,
    v.altura_od,
    v.avcl_od,
    v.avcc_od,
    v.avsl_oi,
    v.avsc_oi,
    v.esfera_oi,
    v.cilindro_oi,
    v.eje_oi,
    v.adicion_oi,
    v.dnp_oi,
    v.altura_oi,
    v.avcl_oi,
    v.avcc_oi,
    v.k1_d_od,
    v.k2_d_od,
    v.k1_mm_od,
    v.k2_mm_od,
    v.eje_k1_od,
    v.eje_k2_od,
    v.astig_corneal_od,
    v.eje_astig_od,
    v.obs_k_od,
    v.k1_d_oi,
    v.k2_d_oi,
    v.k1_mm_oi,
    v.k2_mm_oi,
    v.eje_k1_oi,
    v.eje_k2_oi,
    v.astig_corneal_oi,
    v.eje_astig_oi,
    v.obs_k_oi,
    v.auto_esf_od,
    v.auto_cil_od,
    v.auto_eje_od,
    v.auto_esf_oi,
    v.auto_cil_oi,
    v.auto_eje_oi,
    v.auto_esf_od_2,
    v.auto_cil_od_2,
    v.auto_eje_od_2,
    v.auto_esf_oi_2,
    v.auto_cil_oi_2,
    v.auto_eje_oi_2,
    v.lenso_esf_od,
    v.lenso_cil_od,
    v.lenso_eje_od,
    v.lenso_add_od,
    v.lenso_avl_od,
    v.lenso_avc_od,
    v.lenso_esf_oi,
    v.lenso_cil_oi,
    v.lenso_eje_oi,
    v.lenso_add_oi,
    v.lenso_avl_oi,
    v.lenso_avc_oi,
    v.venta,
    v.abono,
    v.descuento,
    v.forma_pago,
    v.pago_nota,
    v.estado,
    v.notas,
    v.codigo_armazon,
    v.tipo_armazon,
    v.param_horizontal,
    v.param_puente,
    v.param_vertical,
    v.param_diagonal,
    v.tipo_lente,
    v.material_lente,
    v.material_nota,
    v.accesorio_id,
    v.tratam_ninguno,
    v.tratam_ar,
    v.tratam_ar_azul,
    v.tratam_azul,
    v.tratam_tinturado,
    v.tratam_tinturado_nota,
    v.tratam_foto,
    v.tratam_foto_nota,
    v.tratam_trans,
    v.tratam_trans_nota,
    v.costo_armazon_int,
    v.costo_lunas_int,
    v.costo_accesorio_int,
    v.costo_tratamientos_int,
    v.costo_varios_int,
    v.comprobante_url,
    v.alias,
    v.fecha_venta,
    c.sync_version AS sync_version_consulta
   FROM (public.vista_pacientes v
     LEFT JOIN public.consultas_clinicas c ON ((c.id = v.id)));


--
-- Name: VIEW vista_pacientes_versionada; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.vista_pacientes_versionada IS 'vista_pacientes + sync_version de la consulta. LEFT JOIN: nunca oculta filas del historial.';


--
-- Data for Name: consultas_clinicas; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.consultas_clinicas (id, paciente_id, fecha, notas_clinicas, avsl_od, avsc_od, esfera_od, cilindro_od, eje_od, adicion_od, dnp_od, altura_od, avcl_od, avcc_od, avsl_oi, avsc_oi, esfera_oi, cilindro_oi, eje_oi, adicion_oi, dnp_oi, altura_oi, avcl_oi, avcc_oi, k1_d_od, k2_d_od, k1_mm_od, k2_mm_od, eje_k1_od, eje_k2_od, astig_corneal_od, eje_astig_od, obs_k_od, k1_d_oi, k2_d_oi, k1_mm_oi, k2_mm_oi, eje_k1_oi, eje_k2_oi, astig_corneal_oi, eje_astig_oi, obs_k_oi, auto_esf_od, auto_cil_od, auto_eje_od, auto_esf_oi, auto_cil_oi, auto_eje_oi, auto_esf_od_2, auto_cil_od_2, auto_eje_od_2, auto_esf_oi_2, auto_cil_oi_2, auto_eje_oi_2, lenso_esf_od, lenso_cil_od, lenso_eje_od, lenso_add_od, lenso_avl_od, lenso_avc_od, lenso_esf_oi, lenso_cil_oi, lenso_eje_oi, lenso_add_oi, lenso_avl_oi, lenso_avc_oi, created_at, sync_version, server_updated_at, archived_at) FROM stdin;
7570dbe1-b762-4e51-bffa-b440704a42cb	dec33667-b6a4-46df-b2e1-d8896c5de648	2025-08-02	\N	20/20	0.75	+0.25	-0.50	170	0	33	\N	20/20	0.50	20/20-1	0.75	+0.25	-0.50	180	0	32	\N	20/20	0.50	42.00	43.00	8.04	7.85	3	90	1.00	3	\N	42.25	43.25	7.99	7.80	7	140	1.00	7	\N	+0.75	-0.50	170	\N	\N	\N	+1.00	-0.75	180	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-23 15:59:12.791083+00	0	2026-09-25 04:01:08.563489+00	\N
11385f77-6fbc-4367-8a4d-d6013f565f08	4e16173a-be7f-4bb6-9660-32694e37e8d3	2025-08-26	\N	20/125	0.50	-2.75	-0.50	160	0	31	\N	20/20	0.50	20/80	0.50	-2.00	-1.50	175	0	31	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	-2.75	-0.50	160	\N	20/20	0.50	-2.00	-1.50	170	\N	20/20-1	0.50	2026-08-23 16:04:19.668607+00	0	2026-09-25 04:01:08.563489+00	\N
483a781f-6d04-490d-b793-3505040dc84b	278c5259-5231-4294-b542-8ffdec86f5cd	2026-08-04	\N	20/20-2	2.00	0.50	-0.50	5	2.25	30	0	20/20	0.50	20/100	CUENTA DEDOS	2.50	-2.50	0	2.25	30	0	20/40	1.25	42.51	42.99	7.94	7.85	175	85	0.48	175	\N	40.23	45.24	8.39	7.46	3	93	5.01	3	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-18 21:27:36.353383+00	0	2026-09-25 04:01:08.563489+00	\N
a4080b50-8b7e-4525-9003-d1759d9a9f25	b19da452-cf26-4828-9566-9ab8c9198168	2025-04-11	\N	20/60	0.50	-2.25	0	0	0	30	\N	20/20	0.50	20/60	0.50	-2.25	-0.25	130	0	30	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	-1.75	-0.25	30	\N	20/20	0.50	-2.00	-0.50	100	\N	20/20	0.50	2026-08-23 15:48:58.611979+00	0	2026-09-25 04:01:08.563489+00	\N
63f20092-1733-4d27-b270-c11ebad3069a	40ca4d68-081e-4adc-8296-05ccb75400b9	2025-02-11	\N	20/25	0.50	N	-1.00	175	0	30	0	20/20	0.50	20/25	0.50	N	-1.00	180	0	30	0	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-23 14:03:24.297491+00	0	2026-09-25 04:01:08.563489+00	\N
79bc7f47-c8d6-4210-a167-6abe47caaecb	69cee6ee-1ac4-4336-b8c8-bbb850603fca	2025-04-02	\N	20/60	2.00	+1.50	0	0	+1.25	32	\N	20/20	0.50	20/60-1	2.00	+2.00	0	0	+1.25	33	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	+1.25	-0.25	100	2	20/20	0.50	+1.75	-0.25	105	2	20/20	0.50	2026-08-23 15:53:45.568976+00	0	2026-09-25 04:01:08.563489+00	\N
5c9a101e-c78c-43ff-bef1-4efd4853f90e	c2c8bdfe-5cd1-458a-96f3-ffa81f36f54f	2025-09-10	\N	20/20-2	0.50	N	-0.25	175	0	32	\N	20/20	0.50	20/20-3	0.50	+0.25	-0.25	10	0	33	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-23 16:21:26.589018+00	0	2026-09-25 04:01:08.563489+00	\N
38036109-09f5-45fd-a704-a18d2f20587a	8b947ab9-c6fa-4c14-9826-14316af1a4c1	2025-05-08	\N	20/400	0.50	-2.75	-3.25	7	0	31	\N	20/20	0.50	20/400	0.50	-2.00	-4.00	177	0	31	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	-2.50	-2.75	5	\N	20/30	0.50	-2.00	-3.25	180	\N	20/30	0.50	2026-08-23 23:52:48.029258+00	0	2026-09-25 04:01:08.563489+00	\N
b6d0abfc-f350-43eb-a257-8a38e2e995b7	f924d048-f1c5-45c9-b305-a1a6f2f7a1d1	2026-01-07	\N	20/30	0.75	+0.75	-1.50	172	0	30	\N	20/20	0.50	20/25	0.50	0	0	0	0	31	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-24 00:56:00.602684+00	0	2026-09-25 04:01:08.563489+00	\N
03bd91b0-b986-454a-9558-5689d3421587	f924d048-f1c5-45c9-b305-a1a6f2f7a1d1	2025-10-16	*ARMAZON + PLASTICO AR/FA $35	20/30	0.75	+0.50	-1.25	175	0	30	\N	20/20	0.50	20/25	0.50	0	-0.25	170	0	31	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-24 00:56:00.602684+00	0	2026-09-25 04:01:08.563489+00	\N
49e7f682-dfa9-427f-84c3-db660eb97e08	963f4c4a-6b1f-4274-a93f-ede829241fe0	2026-01-03	\N	20/25	0.50	0.50	-0.50	5	0	30	\N	20/20	0.50	20/25	0.50	0.50	-0.50	175	0	30	\N	20/20	0.50	40.50	41.50	8.33	8.13	7	100	1.00	7	\N	40.75	41.75	8.28	8.08	7	100	1.00	7	\N	+1.25	-0.75	3	+1.25	-1.00	177	+1.25	-0.75	5	+1.25	-1.00	176	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-25 01:53:24.186023+00	0	2026-09-25 04:01:08.563489+00	\N
dad4cfd1-ecc4-4a9d-a94f-d49192cebf15	9e03646c-e81e-45dc-a063-756d916b5923	2025-10-31	*ARMAZON + PLASTICO AR/FA $60 / SOLO PAGO $30	20/60	2.00	0	-1.00	20	0	30	\N	20/30	0.50	20/20-2	0.50	+0.25	-0.50	180	0	30	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-25 02:51:59.218317+00	0	2026-09-25 04:01:08.563489+00	\N
f2761e28-4bbd-4857-9c51-9013c0c52d02	49cb62f0-8f71-4aaa-b1c4-e80a826344fa	2025-10-31	\N	20/25	2.00	-0.75	0	0	0	32	\N	20/20	0.50	20/50	0.50	+1.50	-3.00	15	0	32	\N	20/25	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-25 03:21:05.591437+00	0	2026-09-25 04:01:08.563489+00	\N
2d9de3a4-5057-46ab-8050-c554d5e768de	12803b5c-bd33-4eb9-9321-c0a9c40c6441	2026-01-03	\N	20/25	2.00	+1.50	-0.75	170	1.75	31	\N	20/20	0.50	20/25	2.00	+1.50	-0.75	15	1.75	31	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	+2.25	-0.75	175	+2.50	-0.50	14	+2.25	-0.75	170	+2.25	-0.75	15	2	\N	\N	\N	\N	1.00	2	\N	\N	\N	\N	1.00	2026-08-27 18:12:42.643763+00	0	2026-09-25 04:01:08.563489+00	\N
8368c2ab-ed4c-491b-bba2-fcab1ef13c5f	12803b5c-bd33-4eb9-9321-c0a9c40c6441	2026-08-04	\N	20/25	1.75	+1.25	-0.75	170	1.50	31	\N	20/20	0.50	20/25	1.75	+1.25	-0.75	5	1.50	31	\N	20/20	0.50	43.50	45.00	7.76	7.50	1	91	1.50	1	\N	42.25	43.50	7.99	7.76	3	93	1.25	3	\N	+2.00	-0.75	173	+2.00	-0.25	167	+2.00	-1.00	171	+2.50	-1.00	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-27 18:16:09.389407+00	0	2026-09-25 04:01:08.563489+00	\N
c7756b0c-3a8f-4f0d-93e2-8905b3135a14	2b28985c-4f9c-49bb-8719-e29dc7964434	2026-01-03	\N	20/20-2	0.50	0	-0.50	150	0	32	\N	20/20	0.50	20/20-2	0.50	0	-0.50	20	0	32	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	-0.50	-0.50	148	-0.50	-0.75	19	-1.00	-0.50	153	-0.75	-0.75	18	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-27 18:34:03.535044+00	0	2026-09-25 04:01:08.563489+00	\N
2eb60704-a8ac-4bf6-b026-6e871a62078a	2b28985c-4f9c-49bb-8719-e29dc7964434	2026-08-04	*ARMAZON + PLASTICO AR 	20/25	0.50	0	-0.50	145	0	32	\N	20/20	0.50	20/25	0.50	0	-0.50	30	0	32	\N	20/20	0.50	42.25	43.50	7.99	7.76	134	44	1.25	134	\N	42.25	43.50	7.99	7.76	37	127	1.25	37	\N	0	-0.50	144	+0.25	-0.50	36	-0.25	-0.50	144	0	-0.50	31	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-27 18:37:29.429886+00	0	2026-09-25 04:01:08.563489+00	\N
16c83f83-16d0-4bb3-83db-bae1c149439b	373094c9-08a2-4481-924c-0f93b4712f38	2026-02-10 10:24	*ARMAZON + POLICARBONATO AR  $80	CUENTA DEDOS	1.50	-3.75	-1.00	10	0	29	0	20/20	0.50	CUENTA DEDOS	1.00	-3.25	-1.25	5	0	29	0	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	-4.00	-2.00	12	0	20/20	0.50	-3.50	-1.75	159	0	20/20	0.50	2026-10-04 15:24:34.767921+00	0	2026-10-04 15:24:34.767921+00	\N
7cc9f53d-b2c9-45dd-bfb6-af92228048d7	bff1ff63-6659-4b10-9a54-cc7a1e2d37ce	2026-06-15 10:24	*ARMAZON + PLASTICO AR $50 - HIJA DE JESSY METRORED QUISUR  * TRASPASO ARMAZON $15	20/40	0.75	-1.00	-0.75	30	0	29	\N	20/20	0.50	20/25	0.50	-0.75	-0.50	180	0	29	\N	20/20	0.50	43.89	45.49	7.69	7.42	22	112	1.60	22	\N	42.99	44.76	7.85	7.54	2	92	1.77	2	\N	-1.50	-0.75	33	-1.00	-0.50	180	-1.25	-1.00	31	-1.00	-0.75	179	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-25 04:11:07.543953+00	0	2026-09-25 04:01:08.563489+00	\N
2f319e6b-d016-4380-8f6b-5a28a86c6268	3ca6aea7-d1dc-458b-a72b-cca1efb6c6c9	2026-03-31	*ARMAZON + PLASTICO AR $60	20/20	0.50	-0.25	-0.25	0	0	32	\N	20/20	0.50	20/30	0.50	-0.25	-0.25	180	0	32	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	-0.50	-0.75	173	-0.50	-1.25	178	-0.75	-1.25	1	-0.50	-0.75	176	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-31 19:42:10.09903+00	0	2026-09-25 04:01:08.563489+00	\N
8e8e4824-8c56-4630-9b4e-479e4deaa4e3	a80654bf-78c8-46b0-b387-ad279a0a427f	2026-07-01	* SOLO LUNAS PLAST. AR $30 LENTE DE LECTURA  * SOLO LUNAS PLAST. AR $30 LENTE DE LEJOS	20/20	CUENTA DEDOS	0.75	-0.75	90	1.75	32	\N	20/20	0.50	20/25	1.75	0.75	-0.75	90	1.75	32	\N	20/20	0.50	43.50	43.50	7.76	7.76	97	7	0.00	97	\N	43.50	43.50	7.76	7.76	63	153	0.00	63	\N	+1.25	-1.25	93	+1.50	-1.25	90	+1.25	-1.00	87	+1.00	-1.00	85	+1.75	\N	\N	\N	\N	0.75	+1.75	\N	\N	\N	\N	0.75	2026-08-25 04:06:10.341514+00	0	2026-09-25 04:01:08.563489+00	\N
cc9b3bc6-5ccd-4c1f-8ec3-4a4386bd01b7	8edb8aa0-c6da-49b4-94da-33b5e5eb5c7c	2026-08-22	\N	20/30-1	0.75	N	-1.25	10	0	31	0	20/20	0.50	20/40-2	0.75	+0.25	-1.75	180	0	31	0	20/20	0.50	41.37	43.75	8.16	7.71	2	92	2.38	2	\N	40.25	43.12	8.39	7.83	176	86	2.87	176	\N	+0.75	-1.25	11	+1.00	-1.75	3	+1.00	-3.00	26	+1.25	-2.00	3	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-22 19:05:29.582962+00	0	2026-09-25 04:01:08.563489+00	\N
e4bec1bd-b81f-441d-afbc-77c5702b1556	d19efb70-785b-43a3-829b-3f6c21bb5ae5	2025-11-06	*ARMAZON + PLASTICO AR $30 - PAPA DE GENO METRORED	20/32	TITULO	+1.50	-0.50	80	2	34	\N	20/20	0.50	20/20-3	TITULO	+1.50	-0.75	10	2	33	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	+2.25	-0.75	74	+3.00	-1.50	7	+2.25	-0.75	80	+3.00	-1.50	13	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-25 03:46:21.855622+00	0	2026-09-25 04:01:08.563489+00	\N
5c351a18-464a-4576-bca6-aa5020d82402	dbe0668b-320e-4c0e-9c11-beca2197e7e9	2025-11-03	*ARMAZON + PLASTICO FOTO/AR $80 - GENO METRORED	20/20	0.50	0	-0.25	180	0	35	\N	20/20	0.50	20/20	0.50	0	-0.25	20	0	34	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-25 03:31:49.282582+00	0	2026-09-25 04:01:08.563489+00	\N
28975789-fc9c-4e43-aff8-97e2fc121e4f	49cb62f0-8f71-4aaa-b1c4-e80a826344fa	2026-07-03	*ARMAZON + PLASTICO AR $60	20/25	0.50	-0.75	-0.25	125	0	32.50	\N	20/20	0.50	20/50	2	+1.75	-3.25	15	0	32.50	\N	20/25	0.50	42.61	42.99	7.92	7.85	163	73	0.38	163	\N	41.51	44.23	8.13	7.63	16	106	2.72	16	\N	-1.00	-0.25	128	+3.00	-3.75	18	-0.25	-0.25	130	+2.50	-3.75	17	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-25 03:26:13.567282+00	0	2026-09-25 04:01:08.563489+00	\N
57a54f14-7a0c-47c6-801c-a807822a224c	e6da2925-6edb-4cfd-8de9-f473f6a1974e	2025-09-29	*ARMAZON + PLASTICO AR LENTE DE LECTURA $20	20/50-1	TITULO BORROSO	+2.75	-0.75	105	+2.75	28	\N	20/25	0.75	20/50-1	TITULO BORROSO	+2.50	-0.25	100	+2.75	28	\N	20/25	0.75	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	4.00	\N	\N	\N	\N	0.75	4.00	\N	\N	\N	\N	0.75	2026-08-25 02:46:47.024454+00	0	2026-09-25 04:01:08.563489+00	\N
51f96e24-71e0-4af4-908f-20f6ce4625c6	b1d3f813-a5b7-4f0c-ba1a-ab382b117763	2026-03-05	\N	20/80	0.75	-2.25	-1.25	25	1.50	32.50	\N	20/20	0.50	20/80	1.00	-2.50	-1.25	165	1.50	32.50	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	-2.50	-1.25	22	-2.50	-1.50	177	-2.50	-1.25	25	-2.25	-1.50	174	-2.25	-1.25	25	1.50	20/20	1.00	-2.50	-1.00	165	1.50	20/25	1.00	2026-08-25 03:54:57.59335+00	0	2026-09-25 04:01:08.563489+00	\N
ade955e0-6559-46b0-901f-267e0f506bd3	d0001f6d-b895-4c17-ab39-71345b2c2f24	2026-08-18	\N	20/25	0.50	0	-0.75	180	0	32.50	0	20/20	0.50	20/25	0.50	0	-0.75	10	0	32.50	0	20/20	0.50	40.25	41.5	8.39	8.13	10	100	1.25	10	\N	40.25	41.75	8.39	8.08	177	87	1.5	177	\N	+0.25	-1.00	1	+0.25	-0.75	3	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-25 04:22:03.790914+00	0	2026-09-25 04:01:08.563489+00	\N
31aca2e2-4ff7-458f-ad34-e2ca10f9d0f1	cf63e290-ee4b-4ce6-9f8a-1d0b50fb1c35	2026-10-07 18:14	\N	20/70	1.25	-0.50	-2.50	10	0	32	0	20/20	0.50	20/70	0.75	-0.50	-1.75	5	0	32	0	20/25-	0.63	42.00	45.00	\N	\N	10	100	\N	\N	\N	42.25	44.25	\N	\N	2	92	\N	\N	\N	-0.75	-3.00	11	-0.75	-1.50	6	-0.50	-3.00	11	-0.75	-1.75	4	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-10-07 23:14:17.978748+00	0	2026-10-07 23:14:17.978748+00	\N
8c039b08-9737-4ab1-9836-26a564dc54a9	8b9320df-847a-45d8-8878-62dbe3cf8244	2025-02-03	\N	20/60	0.75	0	-2.75	5	0	32	\N	20/20	0.50	20/60	0.75	0	-2.75	180	0	32	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	-2.75	15	0	20/20	0.50	0	-2.75	175	0	20/20	0.50	2026-08-31 20:20:04.638044+00	0	2026-09-25 04:01:08.563489+00	\N
3ce9ca5b-56ac-4e74-9c9f-0a94a9aabd13	3c1c077d-46d6-4d5d-a0f0-4f300f118c89	2026-04-30	*ARMAZON DEPORTIVO 1.59 AR $160 (EL PACIENTE NO SE SINTIO BIEN REFIERE MALESTAR Y DISTORCION DEBIDO A LA CURVATURA ) , SE REALIZO CORRECION (1.56 Y SE BAJO LA MEDIDA, PERO IGUAL EL PACIENTE INDICO QUE NO VE BIEN )	20/50	1.75	-0.75	-4.25	20	0	33.50	\N	20/20	0.50	20/60	1.75	-0.75	-3.50	170	0	33.50	\N	20/20	0.50	43.25	48.00	7.80	7.03	19	109	4.75	19	\N	42.75	47.00	7.89	7.18	169	79	4.25	169	\N	-0.25	-4.50	19	-0.50	-3.50	172	-0.25	-4.50	20	-1.25	-3.25	171	-0.50	-4.00	18	0	20/20	0.50	-0.50	-3.50	168	0	20/20	0.50	2026-08-31 20:00:32.930307+00	0	2026-09-25 04:01:08.563489+00	\N
918b092a-29cb-4e6c-99ed-abdf802a2d10	b3f7acae-1649-4f8c-821e-eec1023857eb	2026-05-20	*ARMAZON + PLASTICO AR $60	20/50	2.00	0.50	-2.00	180	0	35	\N	20/20	0.50	20/25	0.50	0	-1.00	175	0	35	\N	20/20	0.50	42.25	45.00	7.99	7.50	177	87	2.75	177	\N	43.50	45.00	7.76	7.50	178	88	1.50	178	\N	+1.00	-3.75	2	N	-1.75	177	+1.00	-3.50	2	+0.25	-1.50	180	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-09-01 03:04:19.225001+00	0	2026-09-25 04:01:08.563489+00	\N
88262d44-f418-44ae-b1cb-6671322d1b0a	425c31b4-c897-4096-8757-64afd690eb4f	2026-10-06	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-10-06 22:10:52.14243+00	0	2026-10-06 22:10:52.14243+00	\N
97ac523e-91aa-4022-adaa-edca347dc0d5	de4f73b9-331a-4d03-99e4-0e5ec2b0e03b	2026-10-20 12:59	*ARMAZON + PLASTICO PROGRESIVO $150	20/25	TITULO BORROSO	0	-0.75	30	3	32	0	20/20	0.50	20/20-1	TITULO BORROSO	0	-0.25	50	3	32	0	20/20	0.50	44.25	46.00	\N	\N	5	95	\N	\N	\N	43.87	45.50	\N	\N	6	96	\N	\N	\N	+0.25	-0.75	30	+0.25	-0.25	49	+0.25	-0.75	40	+0.25	-0.25	52	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-10-20 17:59:11.375099+00	0	2026-10-20 17:59:11.375099+00	\N
19587552-e26f-4e1a-b6a2-f635ec135550	a6d757c7-2ee8-498b-b080-c8b2bdc2e8ae	2026-01-03	\N	20/20-2	0.50	0	-0.50	15	0	30	\N	20/20	0.50	20/20-2	0.50	0	-0.50	160	0	30	\N	20/20	0.50	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-27 20:46:49.123771+00	0	2026-09-25 04:01:08.563489+00	\N
f76ea360-9fc8-4325-a838-c454e19b7edb	425c31b4-c897-4096-8757-64afd690eb4f	2026-09-26	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-09-26 17:30:53.163595+00	0	2026-09-26 17:30:53.163595+00	\N
\.


--
-- Data for Name: consultas_clinicas_revisiones; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.consultas_clinicas_revisiones (id, consulta_id, version, snapshot, motivo, editado_por, editado_en) FROM stdin;
4af50c65-6c4a-42d2-9afe-19c5b59c7d1e	7cc9f53d-b2c9-45dd-bfb6-af92228048d7	0	{"id": "7cc9f53d-b2c9-45dd-bfb6-af92228048d7", "fecha": "2026-06-15", "dnp_od": "29", "dnp_oi": "29", "eje_od": "30", "eje_oi": "180", "avcc_od": "0.50", "avcc_oi": "0.50", "avcl_od": "20/20", "avcl_oi": "20/20", "avsc_od": "0.75", "avsc_oi": "0.50", "avsl_od": "20/40", "avsl_oi": "20/25", "k1_d_od": "43.89", "k1_d_oi": "42.99", "k2_d_od": "45.49", "k2_d_oi": "44.76", "k1_mm_od": "7.69", "k1_mm_oi": "7.85", "k2_mm_od": "7.42", "k2_mm_oi": "7.54", "obs_k_od": null, "obs_k_oi": null, "altura_od": null, "altura_oi": null, "eje_k1_od": "22", "eje_k1_oi": "2", "eje_k2_od": "112", "eje_k2_oi": "92", "esfera_od": "-1.00", "esfera_oi": "-0.75", "adicion_od": "0", "adicion_oi": "0", "created_at": "2026-08-25T04:11:07.543953+00:00", "archived_at": null, "auto_cil_od": "-0.75", "auto_cil_oi": "-0.50", "auto_eje_od": "33", "auto_eje_oi": "180", "auto_esf_od": "-1.50", "auto_esf_oi": "-1.00", "cilindro_od": "-0.75", "cilindro_oi": "-0.50", "paciente_id": "bff1ff63-6659-4b10-9a54-cc7a1e2d37ce", "eje_astig_od": "22", "eje_astig_oi": "2", "lenso_add_od": null, "lenso_add_oi": null, "lenso_avc_od": null, "lenso_avc_oi": null, "lenso_avl_od": null, "lenso_avl_oi": null, "lenso_cil_od": null, "lenso_cil_oi": null, "lenso_eje_od": null, "lenso_eje_oi": null, "lenso_esf_od": null, "lenso_esf_oi": null, "sync_version": 0, "auto_cil_od_2": "-1.00", "auto_cil_oi_2": "-0.75", "auto_eje_od_2": "31", "auto_eje_oi_2": "179", "auto_esf_od_2": "-1.25", "auto_esf_oi_2": "-1.00", "notas_clinicas": "*ARMAZON + PLASTICO AR $50 - HIJA DE JESSY METRORED QUISUR  * TRASPASO ARMAZON $15", "astig_corneal_od": "1.60", "astig_corneal_oi": "1.77", "server_updated_at": "2026-09-25T04:01:08.563489+00:00"}	Edición	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 15:24:57.033633+00
\.


--
-- Data for Name: inventario; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inventario (id, created_at, marca, modelo, color, precio, stock, descripcion, categoria, codigo, tipo_armazon, param_horizontal, param_puente, param_vertical, param_diagonal, nombre_accesorio, caracteristica, material, material_nota, costo_compra, imagen_url, param_frontal, param_varillas, sync_version, server_updated_at, client_ref) FROM stdin;
21	2026-09-02 01:04:12.659696+00	\N	\N	\N	20	1	CAREY (TONOS MARRÓN Y ÁMBAR), RECTANGULAR	Armazon	DXCC0001	Completo	58	15	37	50	\N	\N	PLASTICO	\N	10	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788311052534_GeminiGeneratedImage87dnjy87dnjy87dn.png	140	144	0	2026-09-25 04:01:08.563489+00	\N
4	2026-08-23 01:58:21.590623+00	\N	\N	\N	3	4	\N	Accesorio	\N	\N	\N	\N	\N	\N	ESTUCHE GAFA	\N	\N	\N	\N	\N	\N	\N	1	2026-10-04 14:08:59.224909+00	\N
7	2026-09-01 16:09:12.448415+00	\N	\N	\N	25	1	NEGRO	Armazon	VICTORVISION VV135	Completo	52	17	38	52	\N	\N	PLASTICO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788278952269_GeminiGeneratedImage1o6hki1o6hki1o6h.jpg	134	144	0	2026-09-25 04:01:08.563489+00	\N
8	2026-09-01 16:27:30.16596+00	\N	\N	\N	25	1	ROSA TRASLUCIDO CON VARILLAS TIPO PRINT(CAREY) - AGATADO	Armazon	KROKET RY9803	Completo	51	17	38	47	\N	\N	ACETATO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788280050164_GeminiGeneratedImage93s4nd93s4nd93s4.jpg	133	138	0	2026-09-25 04:01:08.563489+00	\N
9	2026-09-01 17:01:19.989772+00	\N	\N	\N	35	1	Lila con varillas doradas (detalles decorativos en lila y blanco), plaquetas	Armazon	ATENEA CH9025	Completo	53	17	47	52	\N	\N	METAL CON TERMINALES DE PLASTICO	\N	20	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788282080041_GeminiGeneratedImagey4hhmey4hhmey4hh.png	134	148	0	2026-09-25 04:01:08.563489+00	\N
10	2026-09-01 17:43:32.485902+00	\N	\N	\N	30	1	Negro con varillas gris oscuro y linea blanca, HEXAGONAL	Armazon	FLOWERS FW230613	Completo	51	18	42	49	\N	\N	PLASTICO/VARILLAS DE METAL	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788284612592_GeminiGeneratedImagei2zvv7i2zvv7i2zv.png	133	142	0	2026-09-25 04:01:08.563489+00	\N
11	2026-09-01 20:36:23.766399+00	\N	\N	\N	25	1	Rojo oscuro traslúcido rectangular/ Niño	Armazon	GOOLKIDS GKP214	Completo	49	16	33	47	\N	\N	PLASTICO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788294983538_GeminiGeneratedImage2a0de62a0de62a0d.png	129	139	0	2026-09-25 04:01:08.563489+00	\N
12	2026-09-01 20:45:04.321341+00	\N	\N	\N	35	1	Oro rosado con detalles superiores en lila y varillas con bloques de color (rosa, lila, crema).	Armazon	GAMMA FEMME GFS3818	Completo	53	17	44	52	\N	\N	METAL/TERMINALES DE PLASTICO	\N	20	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788295504501_GeminiGeneratedImageugyfq0ugyfq0ugyf.png	130	140	0	2026-09-25 04:01:08.563489+00	\N
13	2026-09-01 20:54:23.011789+00	\N	\N	\N	30	1	Rojo vino traslúcido con detalle dorado en las bisagras	Armazon	MA GIC EYEWEAR SMA01	Completo	52	16	39	49	\N	\N	ACETATO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788296061333_GeminiGeneratedImageqa7ardqa7ardqa7a.png	135	137	0	2026-09-25 04:01:08.563489+00	\N
16	2026-09-01 21:35:20.08138+00	\N	\N	\N	35	1	Oro rosado con borde superior y terminales color vino, detalle circular azul con pedrería en las varillas, AGATADO	Armazon	RENACER MG39120	Semi al Aire	55	17	42	55	\N	\N	METAL/TERMINAL DE PLASTICO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788298520308_GeminiGeneratedImagev33vmmv33vmmv33v.png	137	139	0	2026-09-25 04:01:08.563489+00	\N
17	2026-09-01 21:47:10.355702+00	\N	\N	\N	30	1	Rojo oscuro en degradado a rosa pálido traslúcido, con varillas doradas (detalle de pedrería) y terminales rojo oscuro, AGATADO	Armazon	KARO KIDS KA188	Completo	47	16	37	45	\N	\N	TR90/VARILLAS DE METAL TERMINALES DE PLASTICO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788299230522_GeminiGeneratedImage7dreyj7dreyj7dre.png	120	133	0	2026-09-25 04:01:08.563489+00	\N
18	2026-09-01 21:54:13.808922+00	\N	\N	\N	30	1	Oro rosado con borde superior dorado y terminales transparentes, CUADRADO	Armazon	BREZZY EYEWEAR NM1203	Completo	50	18	37	49	\N	\N	METAL/TERMINALES DE PLASTICO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788299653787_GeminiGeneratedImageavahkiavahkiavah.png	128	135	0	2026-09-25 04:01:08.563489+00	\N
19	2026-09-01 21:59:40.597217+00	\N	\N	\N	30	1	Gris metálico con borde superior color morado y terminales transparentes con detalle rojo, CUADRADO	Armazon	BREZZY EYEWEAR NM1203X	Completo	50	18	37	49	\N	\N	METAL/TERMINALES DE PLASTICO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788299981050_GeminiGeneratedImage91hsbz91hsbz91hs.png	127	130	0	2026-09-25 04:01:08.563489+00	\N
20	2026-09-01 22:06:33.77759+00	\N	\N	\N	30	1	Rojo oscuro en degradado a rosa traslúcido, con varillas doradas (detalle de pedrería) y terminales rojo oscuro, AGATADO	Armazon	KARO KIDS KA184	Completo	48	16	39	49	\N	\N	PLASTICO(FRENTE CON VARILLAS DE METAL Y TERMINALES DE PLASTICO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788300393824_GeminiGeneratedImagei3mvn0i3mvn0i3mv.png	126	130	0	2026-09-25 04:01:08.563489+00	\N
24	2026-09-06 01:13:14.12207+00	\N	\N	\N	35	1	DORADO CON BORDE SUPERIOR Y DETALLES EN VARILLAS TIPO CAREY, TERMINALES TRANSPARENTES CAREY	Armazon	DXCC7146	Completo	52	17	45	56	\N	\N	METAL/TERMINALES PLASTICAS	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788657193557_GeminiGeneratedImageqis4mtqis4mtqis4.png	138	142	0	2026-09-25 04:01:08.563489+00	\N
25	2026-09-06 01:25:59.332527+00	\N	\N	\N	30	1	GRIS OSCURO CON DETALLE DE RAYAS (AZUL, BLANCO, BEIGE, ROJO) EN LAS VARILLAS Y TERMINALES GRIS TRASLÚCIDO, CUADRADO	Armazon	DULONTTI RYB9917	Completo	50	18	45	51	\N	\N	METAL/TERMINALES PLASTICAS	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788657958400_GeminiGeneratedImagev05la2v05la2v05l.png	130	140	0	2026-09-25 04:01:08.563489+00	\N
26	2026-09-06 01:34:49.90527+00	\N	\N	\N	35	1	DORADO ROSADO CON BORDE SUPERIOR Y TERMINALES CON DISEÑO TIPO CAREY GRIS, AGATADO	Armazon	DXCC0003	Completo	56	17	46	56	\N	\N	TR90	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788658488768_GeminiGeneratedImagexzr5t1xzr5t1xzr5.png	138	144	0	2026-09-25 04:01:08.563489+00	\N
22	2026-09-02 20:54:55.021755+00	\N	\N	\N	25	1	GRIS TRASLÚCIDO CON VARILLAS PLATEADAS Y TERMINALES COLOR NARANJA BRILLANTE, DOBLE PUENTE, AVIADOR	Armazon	DXCC0002	Completo	60	15	42	58	\N	\N	PLASTICO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788382495483_GeminiGeneratedImagekb1navkb1navkb1n.png	150	148	0	2026-09-25 04:01:08.563489+00	\N
2	2026-08-23 01:18:46.57939+00	\N	\N	\N	45	0	\N	Armazon	XC95826	Completo	54	17	46	55	\N	\N	TR90	\N	0	\N	\N	\N	8	2026-10-20 15:59:05.114459+00	\N
23	2026-09-06 01:04:40.238796+00	\N	\N	\N	35	1	ORO ROSADO CON BORDE SUPERIOR ROJO Y TERMINALES TIPO CAREY, HEXAGONAL	Armazon	DXCC0573	Completo	50	14	45	51	\N	\N	METAL/TERMINALES DE PLASTICO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788656679488_GeminiGeneratedImage8myuii8myuii8myu.png	130	137	0	2026-09-25 04:01:08.563489+00	\N
6	2026-09-01 15:41:31.431373+00	\N	\N	\N	25	1	NEGRO CON DORADO Y PLAQUETAS	Armazon	DXCC101963	Completo	52	19	42	53	\N	\N	METAL	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788277291740_GeminiGeneratedImage1rni3b1rni3b1rni.png	143	140	0	2026-09-25 04:01:08.563489+00	\N
15	2026-09-01 21:23:43.33289+00	\N	\N	\N	35	1	Dorado con borde superior negro, varillas negras y detalle gris azulado, AGATADO	Armazon	GAMMA FEMME GFS3818 C1	Completo	53	17	44	52	\N	\N	METAL/TERMINALES DE PLASTICO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788297823014_GeminiGeneratedImagesx330tsx330tsx33.png	131	137	0	2026-09-25 04:01:08.563489+00	\N
3	2026-08-23 01:58:00.586537+00	\N	\N	\N	1	7	\N	Accesorio	\N	\N	\N	\N	\N	\N	ESTUCHE NORMAL	\N	\N	\N	0	\N	\N	\N	1	2026-10-20 15:59:05.114459+00	\N
14	2026-09-01 21:04:22.727202+00	\N	\N	\N	30	1	Negro brillante con detalle dorado y pedrería en las varillas	Armazon	OZZIE GALLE 2206	Completo	52	19	41	52	\N	\N	PLASTICO	\N	15	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/inventario_imagenes/1788296663139_GeminiGeneratedImage3fb6fu3fb6fu3fb6.png	139	139	0	2026-09-25 04:01:08.563489+00	\N
28	2026-10-07 23:19:55.409587+00	\N	\N	\N	30	0	DORADO CON TERMINAL NEGRO Y PLAQUETAS	Armazon	DXCC1234 	Al Aire	55	20	35	56	\N	\N	METAL / TERMINALES DE PLASTICO	\N	5.25	producto_1791427001918_22024d13.jpg	135	145	1	2026-10-08 02:36:43.384673+00	-1791415194498
\.


--
-- Data for Name: inventario_movimientos; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inventario_movimientos (id, pedido_id, inventario_id, tipo, cantidad, created_by, created_at, operacion_id) FROM stdin;
610	4928c3f1-a8b5-413d-804e-6d6730df4854	2	DEVOLUCION	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 23:03:50.151387+00	\N
611	81c14cf6-2629-4a45-a74a-6382a3c7791d	3	SALIDA	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-08 03:25:56.018305+00	\N
612	81c14cf6-2629-4a45-a74a-6382a3c7791d	28	SALIDA	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-08 03:25:56.018305+00	\N
578	43d0d876-0ee8-4363-918b-5d4c627fe16b	4	SALIDA	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 22:39:54.034397+00	\N
579	43d0d876-0ee8-4363-918b-5d4c627fe16b	6	SALIDA	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 22:39:54.034397+00	\N
580	43d0d876-0ee8-4363-918b-5d4c627fe16b	4	DEVOLUCION	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 22:41:29.018311+00	\N
581	43d0d876-0ee8-4363-918b-5d4c627fe16b	6	DEVOLUCION	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 22:41:29.018311+00	\N
604	4928c3f1-a8b5-413d-804e-6d6730df4854	2	SALIDA	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 22:10:52.14243+00	\N
615	62eae686-fa33-47dc-aee9-340f406e1567	2	SALIDA	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 15:59:05.114459+00	532d03f0-df02-4853-9a85-a6eb24d77172
616	62eae686-fa33-47dc-aee9-340f406e1567	3	SALIDA	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 15:59:05.114459+00	532d03f0-df02-4853-9a85-a6eb24d77172
\.


--
-- Data for Name: lista_precios; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lista_precios (id, created_at, tipo_lente, material, tratamiento, rango_medida, costo_laboratorio, precio_sugerido, notas, sync_version, server_updated_at) FROM stdin;
3	2026-09-24 23:56:33.382645+00	CALCULO	Plástico	Ninguno	BASE	0	20	Precio base usado por el sistema	0	2026-09-25 04:01:08.563489+00
4	2026-09-24 23:56:33.382645+00	CALCULO	Policarbonato	Ninguno	BASE	0	30	Precio base usado por el sistema	0	2026-09-25 04:01:08.563489+00
5	2026-09-24 23:56:33.382645+00	CALCULO	Reducido	Ninguno	BASE	0	50	Precio base usado por el sistema	0	2026-09-25 04:01:08.563489+00
6	2026-09-24 23:56:33.382645+00	CALCULO	Hiperreducido	Ninguno	BASE	0	70	Precio base usado por el sistema	0	2026-09-25 04:01:08.563489+00
7	2026-09-24 23:56:33.382645+00	CALCULO	AR Verde	Ninguno	BASE	0	20	Precio base usado por el sistema	0	2026-09-25 04:01:08.563489+00
8	2026-09-24 23:56:33.382645+00	CALCULO	AR Azul	Ninguno	BASE	0	20	Precio base usado por el sistema	0	2026-09-25 04:01:08.563489+00
9	2026-09-24 23:56:33.382645+00	CALCULO	Filtro Azul	Ninguno	BASE	0	35	Precio base usado por el sistema	0	2026-09-25 04:01:08.563489+00
10	2026-09-24 23:56:33.382645+00	CALCULO	Tinturado	Ninguno	BASE	0	20	Precio base usado por el sistema	0	2026-09-25 04:01:08.563489+00
11	2026-09-24 23:56:33.382645+00	CALCULO	Fotocromático	Ninguno	BASE	0	55	Precio base usado por el sistema	0	2026-09-25 04:01:08.563489+00
12	2026-09-24 23:56:33.382645+00	CALCULO	Transition	Ninguno	BASE	0	100	Precio base usado por el sistema	0	2026-09-25 04:01:08.563489+00
13	2026-10-04 14:30:27.160802+00	Monofocal	Policarbonato	Antirreflejo Verde	-0.75 -4.00	4.49	20	TECNILENS	1	2026-10-04 14:38:05.031726+00
14	2026-10-04 14:38:43.784015+00	Monofocal	Policarbonato	Antirreflejo Verde	-0.75 -3.50	4.49	20	TECNILENS	0	2026-10-04 14:38:43.784015+00
15	2026-10-07 20:40:20.743034+00	Monofocal	Reducido (1.61/1.67)	Antirreflejo Verde	1.56 | Esf ±2.00 a ±3.00 | Cil hasta -3.00 (Pot. máx ±4.50)	2.5	20	Índice 1.56 - Resina media	0	2026-10-07 20:40:20.743034+00
16	2026-10-20 21:10:56.828887+00	COMBO	PLÁSTICO	Combo	COMBO: ARMAZON + ANTIREFLEJO	0	35	{"v":1,"tratamientos":["tratam_ar"],"topeArmazon":null,"tipoLente":"Monofocal","materialLente":"Plástico","nota":"INCLUYE ESTUCHE"}	0	2026-10-20 21:10:56.828887+00
17	2026-10-20 21:13:18.946711+00	COMBO	PLÁSTICO	Combo	COMBO: ARMAZON + FOTOSENSIBLE + ANTIREFLEJO	0	60	{"v":1,"tratamientos":["tratam_ar","tratam_foto"],"topeArmazon":null,"tipoLente":"Monofocal","materialLente":"Plástico","nota":"INCLUYE ESTUCHE"}	0	2026-10-20 21:13:18.946711+00
18	2026-10-20 21:15:03.237305+00	COMBO	PLÁSTICO	Combo	COMBO: ARMAZON + ANTIREFLEJO + FILTRO AZUL	0	50	{"v":1,"tratamientos":["tratam_ar","tratam_azul"],"topeArmazon":null,"tipoLente":"Monofocal","materialLente":"Plástico","nota":"INCLUYE ESTUCHE"}	0	2026-10-20 21:15:03.237305+00
19	2026-10-20 21:15:52.067018+00	COMBO	PLÁSTICO	Combo	COMBO: ARMAZON + ANTIREFLEJO + FILTRO AZUL + FOTOCROMATICO	0	80	{"v":1,"tratamientos":["tratam_ar","tratam_azul","tratam_foto"],"topeArmazon":null,"tipoLente":"Monofocal","materialLente":"Plástico","nota":"INCLUYE ESTUCHE"}	0	2026-10-20 21:15:52.067018+00
20	2026-10-20 21:17:11.478428+00	COMBO	PLÁSTICO	Combo	COMBO: ARMAZON + LUNAS BLANCAS	0	25	{"v":1,"tratamientos":[],"topeArmazon":null,"tipoLente":"Monofocal","materialLente":"Plástico","nota":"INCLUYE ESTUCHE"}	0	2026-10-20 21:17:11.478428+00
21	2026-10-20 21:21:54.268513+00	COMBO	POLICARBONATO	Combo	COMBO: ARMAZON + ANTIREFLEJO + POLICARBONATO	0	35	{"v":1,"tratamientos":["tratam_ar"],"topeArmazon":null,"tipoLente":"Monofocal","materialLente":"Policarbonato","nota":"INCLUYE ESTUCHE"}	0	2026-10-20 21:21:54.268513+00
22	2026-10-20 21:22:43.617328+00	COMBO	POLICARBONATO	Combo	COMBO: ARMAZON + ANTIREFLEJO + FILTRO AZUL	0	55	{"v":1,"tratamientos":["tratam_ar","tratam_azul"],"topeArmazon":null,"tipoLente":"Monofocal","materialLente":"Policarbonato","nota":"INCLUYE ESTUCHE"}	0	2026-10-20 21:22:43.617328+00
23	2026-10-20 21:23:37.376677+00	COMBO	POLICARBONATO	Combo	COMBO: ARMAZON + POLICARBONATO + ANTIREFLEJO + FILTRO AZUL	0	55	{"v":1,"tratamientos":["tratam_ar","tratam_azul"],"topeArmazon":null,"tipoLente":"Monofocal","materialLente":"Policarbonato","nota":"INCLUYE ESTUCHE"}	0	2026-10-20 21:23:37.376677+00
24	2026-10-20 21:24:54.793737+00	COMBO	REDUCIDO (1.61/1.67)	Combo	COMBO: ARMAZON + ANTIREFLEJO + REDUCIDO 1.67	0	90	{"v":1,"tratamientos":["tratam_ar"],"topeArmazon":null,"tipoLente":"Monofocal","materialLente":"Reducido (1.61/1.67)","nota":"INCLUYE ESTUCHE"}	0	2026-10-20 21:24:54.793737+00
25	2026-10-20 21:25:46.500739+00	COMBO	POLICARBONATO	Combo	COMBO: ARMAZON + ANTIREFLEJO + FOTOSENSIBLE + POLICARBONATO	0	90	{"v":1,"tratamientos":["tratam_ar","tratam_foto"],"topeArmazon":null,"tipoLente":"Monofocal","materialLente":"Policarbonato","nota":"INCLUYE ESTUCHE"}	0	2026-10-20 21:25:46.500739+00
26	2026-10-20 21:28:38.243086+00	COMBO	PLÁSTICO	Combo	COMBO: ARMAZON + LUNAS BLANCAS FLAT TOP	0	45	{"v":1,"tratamientos":[],"topeArmazon":null,"tipoLente":"Bifocal","materialLente":"Plástico","nota":"INCLUYE ESTUCHE"}	0	2026-10-20 21:28:38.243086+00
27	2026-10-20 21:29:54.272601+00	COMBO	PLÁSTICO	Combo	COMBO: ARMAZON + ANTIREFLEJO + PROGRESIVO INNOVA	0	125	{"v":1,"tratamientos":["tratam_ar"],"topeArmazon":null,"tipoLente":"Progresivo","materialLente":"Plástico","nota":"INCLUYE ESTUCHE"}	0	2026-10-20 21:29:54.272601+00
28	2026-10-20 21:36:46.811208+00	COMBO	PLÁSTICO	Combo	COMBO: ARMAZON + ANTIREFLEJO + FOTOSENSIBLE + PROGRESIVO INNOVA	0	200	{"v":1,"tratamientos":["tratam_ar","tratam_foto"],"topeArmazon":null,"tipoLente":"Progresivo","materialLente":"Plástico","nota":""}	0	2026-10-20 21:36:46.811208+00
\.


--
-- Data for Name: operaciones_aplicadas; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.operaciones_aplicadas (id, tipo_operacion, entidad_id, resultado, aplicada_por, creada_en, completada_en) FROM stdin;
3b63dbee-3a43-475b-b1ae-a3fe70957530	GUARDAR_CONSULTA	25157037-d81e-4776-be3d-273914f0da98	{"creada": true, "consulta_id": "25157037-d81e-4776-be3d-273914f0da98", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 02:17:49.807368+00	2026-09-26 02:17:49.807368+00
ba8ccc07-fe7d-4d1c-9fc1-97cec2b21e84	CREAR_VENTA	4b1cff39-ffe5-4934-831e-3890c6066929	{"items": [{"codigo": "XC95826", "cantidad": 1, "inventory_id": 2}], "venta_id": "4b1cff39-ffe5-4934-831e-3890c6066929", "ya_existia": false, "consulta_id": "25157037-d81e-4776-be3d-273914f0da98", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 02:17:49.807368+00	2026-09-26 02:17:49.807368+00
b95aa76a-1665-4658-bd32-2e2a5f74e866	REGISTRAR_PAGO	429937af-f654-4d4d-933f-467ff5795ba3	{"monto": 20.00, "pago_id": "0822a237-fffc-44ff-b69c-b76ffdbcb4c7", "pedido_id": "4b1cff39-ffe5-4934-831e-3890c6066929", "ya_existia": false, "saldo_pendiente": 25.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 02:17:49.807368+00	2026-09-26 02:17:49.807368+00
1a104323-9054-4b43-a35d-729b5346abd6	REEMBOLSAR_PAGO	9f72466e-8600-4f55-9805-4e915ecfe9b2	{"monto": 20.00, "pago_id": "c8c77d15-23cf-406b-a037-75235f31e934", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 02:17:49.807368+00	2026-09-26 02:17:49.807368+00
0ca87fc6-e366-459d-9cac-746e1eba9192	UPSERT_INVENTARIO	2	{"inventario": {"id": 2, "color": null, "marca": null, "stock": 1, "codigo": "XC95826", "modelo": null, "precio": "45", "material": "TR90", "categoria": "Armazon", "client_ref": null, "created_at": "2026-08-23T01:18:46.57939+00:00", "imagen_url": null, "descripcion": null, "costo_compra": "0", "param_puente": "17", "sync_version": 1, "tipo_armazon": "Completo", "material_nota": null, "param_frontal": null, "caracteristica": null, "param_diagonal": "55", "param_varillas": null, "param_vertical": "46", "nombre_accesorio": null, "param_horizontal": "54", "server_updated_at": "2026-09-26T01:09:56.18058+00:00"}, "servidor_id": 2}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 01:09:56.18058+00	2026-09-26 01:09:56.18058+00
456d1e9f-c235-4b72-9e31-7e3e5259ecf2	ARCHIVAR_CONSULTA	84deef12-d2af-4a7d-9d2e-b32c1e6b5de2	{"archivada": true, "consulta_id": "84deef12-d2af-4a7d-9d2e-b32c1e6b5de2"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 16:53:02.198121+00	2026-09-28 16:53:02.198121+00
8bbbd8db-4738-4a82-8ea0-fb0b9db24ba0	GUARDAR_CONSULTA	d7cf3787-16f6-4a73-ad66-316f04d41684	{"creada": true, "consulta_id": "d7cf3787-16f6-4a73-ad66-316f04d41684", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:12:37.498984+00	2026-09-28 17:12:37.498984+00
5fee28c2-5dca-4120-a96a-4d4b9d616618	GUARDAR_CONSULTA	19587552-e26f-4e1a-b6a2-f635ec135550	{"creada": false, "consulta_id": "19587552-e26f-4e1a-b6a2-f635ec135550", "paciente_id": "a6d757c7-2ee8-498b-b080-c8b2bdc2e8ae"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-27 23:45:29.261393+00	2026-09-27 23:45:29.261393+00
9a8fbee8-8f7c-4edf-9e09-a6a9950dc08c	ARCHIVAR_CONSULTA	d7cf3787-16f6-4a73-ad66-316f04d41684	{"archivada": true, "consulta_id": "d7cf3787-16f6-4a73-ad66-316f04d41684"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:27:01.915493+00	2026-09-28 17:27:01.915493+00
386882eb-91bd-45f8-98e1-314e0bf5b907	GUARDAR_CONSULTA	e88b1880-77b1-4f8b-99ef-4e37dd0f645f	{"creada": true, "consulta_id": "e88b1880-77b1-4f8b-99ef-4e37dd0f645f", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:37:43.817406+00	2026-09-28 17:37:43.817406+00
e654ac01-2963-4966-a2c0-7e996bf9a268	GUARDAR_CONSULTA	15f74df4-568e-477c-9d58-a85a630735ff	{"creada": true, "consulta_id": "15f74df4-568e-477c-9d58-a85a630735ff", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:39:26.188121+00	2026-09-28 17:39:26.188121+00
cf60fd2d-5117-47a5-a34c-dc5a2cfead1e	REEMBOLSAR_PAGO	69ad7e54-774c-40fa-ab0e-d6e3d768effb	{"monto": 10.00, "pago_id": "1fa1387e-486f-405c-99a1-c74900afb2a9", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:40:45.413115+00	2026-09-28 17:40:45.413115+00
0f1adf15-84b9-4686-9643-82a4ab8a75b5	ANULAR_VENTA	1ec5a2c9-9643-4735-ab9c-4d01a6087441	{"anulada": true, "venta_id": "1ec5a2c9-9643-4735-ab9c-4d01a6087441"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:40:45.413115+00	2026-09-28 17:40:45.413115+00
234cd5d6-332d-414d-ad6c-ac3f1e71b51f	ANULAR_VENTA	4b1cff39-ffe5-4934-831e-3890c6066929	{"anulada": true, "venta_id": "4b1cff39-ffe5-4934-831e-3890c6066929"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 03:04:41.702685+00	2026-09-26 03:04:41.702685+00
e728015b-420b-42f1-afa4-b33d58919051	ANULAR_VENTA	4b1cff39-ffe5-4934-831e-3890c6066929	{"anulada": true, "venta_id": "4b1cff39-ffe5-4934-831e-3890c6066929"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 03:04:41.702685+00	2026-09-26 03:04:41.702685+00
58c7dd45-61fb-4ba2-956f-43b1dd6622e7	CREAR_VENTA	7085d157-a66e-43c8-bc60-f6e7613ffa5a	{"items": [], "venta_id": "7085d157-a66e-43c8-bc60-f6e7613ffa5a", "ya_existia": false, "consulta_id": "f76ea360-9fc8-4325-a838-c454e19b7edb", "paciente_id": "425c31b4-c897-4096-8757-64afd690eb4f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 17:30:53.163595+00	2026-09-26 17:30:53.163595+00
6efb7af1-cbf3-49d1-9e8c-1587e7b2ab2f	REGISTRAR_PAGO	fb488621-b9ac-4756-8917-112ccc1021e1	{"monto": 10.00, "pago_id": "80428b85-e6c0-4807-93e4-49347cd81d21", "pedido_id": "7085d157-a66e-43c8-bc60-f6e7613ffa5a", "ya_existia": false, "saldo_pendiente": 10.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 17:30:53.163595+00	2026-09-26 17:30:53.163595+00
b0113109-b35b-420c-a90d-4be3588e7d4e	EDITAR_VENTA	7085d157-a66e-43c8-bc60-f6e7613ffa5a	{"items": [], "version": 1, "venta_id": "7085d157-a66e-43c8-bc60-f6e7613ffa5a"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 17:31:08.340925+00	2026-09-26 17:31:08.340925+00
59cb6ead-9564-46a3-9306-4632b2e56d84	REGISTRAR_PAGO	6f88a7b5-9626-4342-83f5-d079cf018a75	{"monto": 3.00, "pago_id": "bfd85905-5acb-463e-8027-159f1b61e3b9", "pedido_id": "7085d157-a66e-43c8-bc60-f6e7613ffa5a", "ya_existia": false, "saldo_pendiente": 7.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 17:31:08.340925+00	2026-09-26 17:31:08.340925+00
40e384c9-51e3-4c4c-8083-d16c2ca8fef1	REEMBOLSAR_PAGO	7845cd18-cef9-41de-b0ee-6a3e5e4b838e	{"monto": 13.00, "pago_id": "98f41538-e67e-4009-bbdf-6dfd044feb3b", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 18:18:15.542745+00	2026-09-26 18:18:15.542745+00
47a4ff34-2555-41a3-a149-e2245980d6b7	ANULAR_VENTA	7085d157-a66e-43c8-bc60-f6e7613ffa5a	{"anulada": true, "venta_id": "7085d157-a66e-43c8-bc60-f6e7613ffa5a"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 18:18:15.542745+00	2026-09-26 18:18:15.542745+00
e5d64467-d22f-453e-a841-9deaf8972f0a	ARCHIVAR_CONSULTA	25157037-d81e-4776-be3d-273914f0da98	{"archivada": true, "consulta_id": "25157037-d81e-4776-be3d-273914f0da98"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 18:59:34.765119+00	2026-09-26 18:59:34.765119+00
28105f4f-be3b-438b-a026-df09b6738ee4	GUARDAR_CONSULTA	1a0298a0-a710-4f11-a7a1-75f092a151e6	{"creada": true, "consulta_id": "1a0298a0-a710-4f11-a7a1-75f092a151e6", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 19:01:37.667691+00	2026-09-26 19:01:37.667691+00
412c5f8f-c282-49b4-bdfa-1ae3fccb75bb	ARCHIVAR_CONSULTA	15f74df4-568e-477c-9d58-a85a630735ff	{"archivada": true, "consulta_id": "15f74df4-568e-477c-9d58-a85a630735ff"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:40:55.185708+00	2026-09-28 17:40:55.185708+00
3b7ee16a-2cf2-441f-86a6-627d0b581800	GUARDAR_CONSULTA	616393cb-7352-4f70-a344-d77801f594d7	{"creada": true, "consulta_id": "616393cb-7352-4f70-a344-d77801f594d7", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 19:40:46.934603+00	2026-09-28 19:40:46.934603+00
6638cb4d-e8a4-45ed-9556-1a55ee25f6ca	CREAR_VENTA	027f35e8-1218-4bb7-98fe-59e22edd87bc	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}, {"codigo": null, "cantidad": 1, "inventario_id": 4}], "venta_id": "027f35e8-1218-4bb7-98fe-59e22edd87bc", "ya_existia": false, "consulta_id": "616393cb-7352-4f70-a344-d77801f594d7", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 19:42:53.985086+00	2026-09-28 19:42:53.985086+00
f697d3b1-e66a-42a0-8289-a6dede74f344	ARCHIVAR_CONSULTA	1a0298a0-a710-4f11-a7a1-75f092a151e6	{"archivada": true, "consulta_id": "1a0298a0-a710-4f11-a7a1-75f092a151e6"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 19:03:09.484159+00	2026-09-26 19:03:09.484159+00
cc955dbe-b13c-47be-ace4-91069bd7c2c5	GUARDAR_CONSULTA	bb6e094c-7b90-4eb0-b5c1-70665e1351f3	{"creada": true, "consulta_id": "bb6e094c-7b90-4eb0-b5c1-70665e1351f3", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 22:43:55.077912+00	2026-09-30 22:43:55.077912+00
7528865b-6680-4f05-a1a8-91b139aaaf3e	GUARDAR_CONSULTA	84deef12-d2af-4a7d-9d2e-b32c1e6b5de2	{"creada": true, "consulta_id": "84deef12-d2af-4a7d-9d2e-b32c1e6b5de2", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 16:52:09.087945+00	2026-09-28 16:52:09.087945+00
4925f297-cae0-4d17-b8f7-99a6db345d4f	GUARDAR_CONSULTA	d7cf3787-16f6-4a73-ad66-316f04d41684	{"creada": false, "consulta_id": "d7cf3787-16f6-4a73-ad66-316f04d41684", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:13:06.880043+00	2026-09-28 17:13:06.880043+00
40eb2874-0d90-4850-a319-1c96b0a2b971	CREAR_VENTA	ea2ccfc3-c3cf-4922-9f8e-6d4243122b4d	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}, {"codigo": null, "cantidad": 1, "inventario_id": 4}], "venta_id": "ea2ccfc3-c3cf-4922-9f8e-6d4243122b4d", "ya_existia": false, "consulta_id": "d7cf3787-16f6-4a73-ad66-316f04d41684", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:24:54.986163+00	2026-09-28 17:24:54.986163+00
0cb3fe55-d00a-4954-8e68-c3960551eced	REGISTRAR_PAGO	846f8bc6-6df8-4da4-a0f7-0fbc0804691a	{"monto": 20.00, "pago_id": "91110d42-5bc5-46e1-afd3-2b085699e20a", "pedido_id": "ea2ccfc3-c3cf-4922-9f8e-6d4243122b4d", "ya_existia": false, "saldo_pendiente": 59.20}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:24:54.986163+00	2026-09-28 17:24:54.986163+00
7b90513c-d1b0-4916-9d46-e917eecfb249	REEMBOLSAR_PAGO	604e76ed-9a76-45ca-9014-f053494b3389	{"monto": 20.00, "pago_id": "8e237803-6574-407e-9af1-a5e42e065f40", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:26:19.883256+00	2026-09-28 17:26:19.883256+00
d51bb641-48ed-4e52-b82e-a9a06945e750	ANULAR_VENTA	ea2ccfc3-c3cf-4922-9f8e-6d4243122b4d	{"anulada": true, "venta_id": "ea2ccfc3-c3cf-4922-9f8e-6d4243122b4d"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:26:19.883256+00	2026-09-28 17:26:19.883256+00
5ff0f9e2-d598-4825-b6c7-d02ada0e293f	ARCHIVAR_CONSULTA	1a0298a0-a710-4f11-a7a1-75f092a151e6	{"archivada": true, "consulta_id": "1a0298a0-a710-4f11-a7a1-75f092a151e6"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 16:32:02.24942+00	2026-09-28 16:32:02.24942+00
906248f3-49b5-417b-b214-81714a73f899	ARCHIVAR_CONSULTA	25157037-d81e-4776-be3d-273914f0da98	{"archivada": true, "consulta_id": "25157037-d81e-4776-be3d-273914f0da98"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 16:32:36.491694+00	2026-09-28 16:32:36.491694+00
87c1414e-a43d-47f5-b1ba-49d032458e42	ARCHIVAR_CONSULTA	e88b1880-77b1-4f8b-99ef-4e37dd0f645f	{"archivada": true, "consulta_id": "e88b1880-77b1-4f8b-99ef-4e37dd0f645f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:38:41.493033+00	2026-09-28 17:38:41.493033+00
2ce28238-6825-44b1-bb4b-6236be1dbbcc	CREAR_VENTA	1ec5a2c9-9643-4735-ab9c-4d01a6087441	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 6}], "venta_id": "1ec5a2c9-9643-4735-ab9c-4d01a6087441", "ya_existia": false, "consulta_id": "15f74df4-568e-477c-9d58-a85a630735ff", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:40:28.957139+00	2026-09-28 17:40:28.957139+00
2db6a817-9a63-45de-ba22-49d2da54c49f	REGISTRAR_PAGO	f333ba76-123f-4a2d-9b3c-b8daba119174	{"monto": 10.00, "pago_id": "47ebd7c4-2134-4638-8677-5d9e66d0bebb", "pedido_id": "1ec5a2c9-9643-4735-ab9c-4d01a6087441", "ya_existia": false, "saldo_pendiente": 15.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 17:40:28.957139+00	2026-09-28 17:40:28.957139+00
56c13c19-4542-4c68-b8b5-4f136e8c3441	ARCHIVAR_CONSULTA	e88b1880-77b1-4f8b-99ef-4e37dd0f645f	{"archivada": true, "consulta_id": "e88b1880-77b1-4f8b-99ef-4e37dd0f645f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 19:23:48.467011+00	2026-09-28 19:23:48.467011+00
5f14ccf5-3da9-4888-834d-38faa81b3cca	REGISTRAR_PAGO	54402193-88b0-4b28-9aa5-bff06aca02b1	{"monto": 10.00, "pago_id": "231c273c-e9da-423c-a6bd-64c615d8fc69", "pedido_id": "027f35e8-1218-4bb7-98fe-59e22edd87bc", "ya_existia": false, "saldo_pendiente": 69.20}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 19:42:53.985086+00	2026-09-28 19:42:53.985086+00
21baf16e-f056-4a28-aaa9-0c105fe40dfd	REEMBOLSAR_PAGO	e5833df0-bcd4-45c0-bb96-79cb8e4e3b48	{"monto": 10.00, "pago_id": "bf64689c-1a4a-4011-b93c-1ebd5301f37c", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 19:45:49.316075+00	2026-09-28 19:45:49.316075+00
a39c3a3e-e313-46b6-abdf-223b23ecf9ef	ANULAR_VENTA	027f35e8-1218-4bb7-98fe-59e22edd87bc	{"anulada": true, "venta_id": "027f35e8-1218-4bb7-98fe-59e22edd87bc"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 19:45:49.316075+00	2026-09-28 19:45:49.316075+00
d873d5a7-a0eb-4a44-a7a9-df47eec85cf8	ARCHIVAR_CONSULTA	616393cb-7352-4f70-a344-d77801f594d7	{"archivada": true, "consulta_id": "616393cb-7352-4f70-a344-d77801f594d7"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-28 19:45:54.029218+00	2026-09-28 19:45:54.029218+00
23ff7784-e8ea-417f-9b13-6a4983d520c2	GUARDAR_CONSULTA	152ae3d6-c221-48ac-8a74-369f40230cb8	{"creada": true, "consulta_id": "152ae3d6-c221-48ac-8a74-369f40230cb8", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 16:49:09.793822+00	2026-09-30 16:49:09.793822+00
3ec99fc2-b44e-409b-9296-53f658a1a24d	CREAR_VENTA	56ac8599-334e-47da-a52d-e487f4a7487b	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 4}], "venta_id": "56ac8599-334e-47da-a52d-e487f4a7487b", "ya_existia": false, "consulta_id": "152ae3d6-c221-48ac-8a74-369f40230cb8", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 16:49:09.793822+00	2026-09-30 16:49:09.793822+00
3e339c34-e75b-4f5a-ba58-42f0290f8a33	REGISTRAR_PAGO	9f03fcf7-3cca-4d89-8451-00aa120e54a9	{"monto": 2.00, "pago_id": "c452fa78-9109-4ddf-82a9-c715dcc9ed08", "pedido_id": "56ac8599-334e-47da-a52d-e487f4a7487b", "ya_existia": false, "saldo_pendiente": 1.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 16:49:09.793822+00	2026-09-30 16:49:09.793822+00
cd5c5d29-92a7-43de-b55c-2c3e05a25853	REEMBOLSAR_PAGO	169cdc18-c048-49a8-8524-321cc34dd752	{"monto": 2.00, "pago_id": "e1dfbb95-f7df-4029-8fe0-d3a29634712b", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 16:54:09.636928+00	2026-09-30 16:54:09.636928+00
d8aa6489-19b1-4c18-b757-e907c8d72c3b	ANULAR_VENTA	56ac8599-334e-47da-a52d-e487f4a7487b	{"anulada": true, "venta_id": "56ac8599-334e-47da-a52d-e487f4a7487b"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 16:54:09.636928+00	2026-09-30 16:54:09.636928+00
3d7052fc-9c38-4a7c-b975-4b0dd6310cdf	ARCHIVAR_CONSULTA	152ae3d6-c221-48ac-8a74-369f40230cb8	{"archivada": true, "consulta_id": "152ae3d6-c221-48ac-8a74-369f40230cb8"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 16:54:15.058427+00	2026-09-30 16:54:15.058427+00
3ba1ba94-ac66-4d3b-9e18-dc77c12c1c79	GUARDAR_CONSULTA	6d1e61a9-0765-40a0-9284-b13934351bde	{"creada": true, "consulta_id": "6d1e61a9-0765-40a0-9284-b13934351bde", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 17:44:32.052295+00	2026-09-30 17:44:32.052295+00
b6866ec7-70f1-46fa-a5f3-94525e50f1de	CREAR_VENTA	fb08938f-72fb-429f-8fe8-1377d9d7e463	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}, {"codigo": null, "cantidad": 1, "inventario_id": 4}], "venta_id": "fb08938f-72fb-429f-8fe8-1377d9d7e463", "ya_existia": false, "consulta_id": "6d1e61a9-0765-40a0-9284-b13934351bde", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 17:44:32.052295+00	2026-09-30 17:44:32.052295+00
84623422-8b22-4332-a59f-3e74fad11b69	REGISTRAR_PAGO	9efda878-8d39-445a-97c6-b787ae5292a2	{"monto": 20.00, "pago_id": "65d51e8e-a907-4038-8d9c-1c17e6963355", "pedido_id": "fb08938f-72fb-429f-8fe8-1377d9d7e463", "ya_existia": false, "saldo_pendiente": 48.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 17:44:32.052295+00	2026-09-30 17:44:32.052295+00
9ab034df-530c-420b-b4e9-51a71caee156	GUARDAR_CONSULTA	55732b48-be95-41b8-abc9-04960c51a16d	{"creada": true, "consulta_id": "55732b48-be95-41b8-abc9-04960c51a16d", "paciente_id": "69852ef5-5110-4750-9bef-62f4c776b85f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 17:44:32.052295+00	2026-09-30 17:44:32.052295+00
c7616b3b-2903-44c4-93a6-9f8971e1fe45	CREAR_VENTA	ee93af73-6bf0-4e68-9045-4d04b8ceb72a	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 6}], "venta_id": "ee93af73-6bf0-4e68-9045-4d04b8ceb72a", "ya_existia": false, "consulta_id": "55732b48-be95-41b8-abc9-04960c51a16d", "paciente_id": "69852ef5-5110-4750-9bef-62f4c776b85f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 17:44:32.052295+00	2026-09-30 17:44:32.052295+00
d0ad84e3-1721-4701-906c-56ebd73ec543	REGISTRAR_PAGO	6542462e-c4d2-487a-9f64-43aeb590ba27	{"monto": 50.00, "pago_id": "3e9cc77e-2b09-43c3-bcb2-e971d53f7545", "pedido_id": "ee93af73-6bf0-4e68-9045-4d04b8ceb72a", "ya_existia": false, "saldo_pendiente": 25.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 17:44:32.052295+00	2026-09-30 17:44:32.052295+00
19908c1e-c3be-4b80-ade8-1fece50a642b	REEMBOLSAR_PAGO	5d628e09-3b54-4f7f-b812-e76afdd2849f	{"monto": 50.00, "pago_id": "0953ea89-54b6-4d48-b939-0b58847f9b96", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 17:47:14.441513+00	2026-09-30 17:47:14.441513+00
6b57ca03-1dff-44e4-b805-96cfe54fc68c	ANULAR_VENTA	ee93af73-6bf0-4e68-9045-4d04b8ceb72a	{"anulada": true, "venta_id": "ee93af73-6bf0-4e68-9045-4d04b8ceb72a"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 17:47:14.441513+00	2026-09-30 17:47:14.441513+00
8b6acefa-7e8f-4dd3-8616-97ed0e16a3be	ARCHIVAR_CONSULTA	55732b48-be95-41b8-abc9-04960c51a16d	{"archivada": true, "consulta_id": "55732b48-be95-41b8-abc9-04960c51a16d"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 17:47:17.039667+00	2026-09-30 17:47:17.039667+00
9e72ea6a-9582-484c-9f46-a6829d79cdab	REEMBOLSAR_PAGO	1fd58d60-0d47-4403-bea6-5368a0476585	{"monto": 20.00, "pago_id": "51f5debd-d3d8-4668-abb8-dc3a0bc7fd8a", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 21:00:43.170271+00	2026-09-30 21:00:43.170271+00
5dda826f-1052-4b62-87ef-ae3d9490fb02	ANULAR_VENTA	fb08938f-72fb-429f-8fe8-1377d9d7e463	{"anulada": true, "venta_id": "fb08938f-72fb-429f-8fe8-1377d9d7e463"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 21:00:43.170271+00	2026-09-30 21:00:43.170271+00
b036ba22-354f-40cc-8b28-ad91358caf9c	ARCHIVAR_CONSULTA	55732b48-be95-41b8-abc9-04960c51a16d	{"archivada": true, "consulta_id": "55732b48-be95-41b8-abc9-04960c51a16d"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 21:00:48.340764+00	2026-09-30 21:00:48.340764+00
3ca69e4d-8d80-488d-83e1-78efb2c2e45b	ARCHIVAR_CONSULTA	6d1e61a9-0765-40a0-9284-b13934351bde	{"archivada": true, "consulta_id": "6d1e61a9-0765-40a0-9284-b13934351bde"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 21:00:49.921405+00	2026-09-30 21:00:49.921405+00
db2ad401-f55d-4e4f-b2de-2364b2072abe	GUARDAR_CONSULTA	6f3804d3-aece-40f0-96d0-fe0cdc01bb08	{"creada": true, "consulta_id": "6f3804d3-aece-40f0-96d0-fe0cdc01bb08", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 21:05:02.997025+00	2026-09-30 21:05:02.997025+00
4445e9a7-5f3f-48f8-a559-d70f174501e2	CREAR_VENTA	d66d13a3-97ce-463a-89bf-16115c83f6ef	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}, {"codigo": null, "cantidad": 1, "inventario_id": 4}], "venta_id": "d66d13a3-97ce-463a-89bf-16115c83f6ef", "ya_existia": false, "consulta_id": "6f3804d3-aece-40f0-96d0-fe0cdc01bb08", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 21:06:10.76463+00	2026-09-30 21:06:10.76463+00
9eecd0e3-7d0e-4c12-9245-5b03363686cb	REGISTRAR_PAGO	dc18f06a-bc9c-4b18-9447-0bb825e7643e	{"monto": 20.00, "pago_id": "2e315427-cae6-414d-abdc-dab8f78a3de5", "pedido_id": "d66d13a3-97ce-463a-89bf-16115c83f6ef", "ya_existia": false, "saldo_pendiente": 58.40}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-30 21:06:10.76463+00	2026-09-30 21:06:10.76463+00
8b8218c7-73e1-423a-9db0-57160dc0e775	ARCHIVAR_CONSULTA	bb6e094c-7b90-4eb0-b5c1-70665e1351f3	{"archivada": true, "consulta_id": "bb6e094c-7b90-4eb0-b5c1-70665e1351f3"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 00:06:32.350695+00	2026-10-01 00:06:32.350695+00
cf58c8cc-c13f-4ced-98ff-9107dd01bc24	ANULAR_VENTA	fb08938f-72fb-429f-8fe8-1377d9d7e463	{"anulada": true, "venta_id": "fb08938f-72fb-429f-8fe8-1377d9d7e463"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 00:15:00.92413+00	2026-10-01 00:15:00.92413+00
d697dbc7-edb6-4e4c-8e0c-f4b1f10de3da	ARCHIVAR_CONSULTA	55732b48-be95-41b8-abc9-04960c51a16d	{"archivada": true, "consulta_id": "55732b48-be95-41b8-abc9-04960c51a16d"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 01:41:45.768097+00	2026-10-01 01:41:45.768097+00
d31877ee-b4af-4009-aeb0-53a112da8642	GUARDAR_CONSULTA	cf66ce98-e330-468c-bc05-627242f5e256	{"creada": true, "consulta_id": "cf66ce98-e330-468c-bc05-627242f5e256", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 19:56:36.711181+00	2026-10-01 19:56:36.711181+00
90fa92a1-4a29-486f-8c32-c86855e12d74	UPSERT_INVENTARIO	2	{"inventario": {"id": 2, "color": null, "marca": null, "stock": 1, "codigo": "XC95826", "modelo": null, "precio": "45", "material": "TR90", "categoria": "Armazon", "client_ref": null, "created_at": "2026-08-23T01:18:46.57939+00:00", "imagen_url": null, "descripcion": null, "costo_compra": "0", "param_puente": "17", "sync_version": 2, "tipo_armazon": "Completo", "material_nota": null, "param_frontal": null, "caracteristica": null, "param_diagonal": "55", "param_varillas": null, "param_vertical": "46", "nombre_accesorio": null, "param_horizontal": "54", "server_updated_at": "2026-10-01T19:56:55.761767+00:00"}, "servidor_id": 2}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 19:56:55.761767+00	2026-10-01 19:56:55.761767+00
c5c7237c-2362-4d00-8b82-13a6029b47e2	CREAR_VENTA	3943a5ac-a66c-4976-a88b-fada1582ed82	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}, {"codigo": null, "cantidad": 1, "inventario_id": 4}], "venta_id": "3943a5ac-a66c-4976-a88b-fada1582ed82", "ya_existia": false, "consulta_id": "cf66ce98-e330-468c-bc05-627242f5e256", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 19:58:12.29939+00	2026-10-01 19:58:12.29939+00
898c9746-4ac7-4023-a718-aba887b4a0bb	REGISTRAR_PAGO	9c078a8d-f7fb-44a5-8be0-2f01e8767980	{"monto": 20.00, "pago_id": "5e47336c-17d6-4326-99be-c819801e6244", "pedido_id": "3943a5ac-a66c-4976-a88b-fada1582ed82", "ya_existia": false, "saldo_pendiente": 68.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 19:58:12.29939+00	2026-10-01 19:58:12.29939+00
00492673-1adf-4684-9e12-78597ecd92cd	REEMBOLSAR_PAGO	fee4ccc8-1dc8-491d-b018-f2263a41a1f5	{"monto": 20.00, "pago_id": "65b222ef-7276-415b-a3a9-9ac1dbecadd0", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 19:59:34.267547+00	2026-10-01 19:59:34.267547+00
0d1d5374-723e-4cdd-ac82-5566051c33fb	ANULAR_VENTA	3943a5ac-a66c-4976-a88b-fada1582ed82	{"anulada": true, "venta_id": "3943a5ac-a66c-4976-a88b-fada1582ed82"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 19:59:34.267547+00	2026-10-01 19:59:34.267547+00
df086b57-91f4-4b1a-af01-4780c5f875ce	ARCHIVAR_CONSULTA	cf66ce98-e330-468c-bc05-627242f5e256	{"archivada": true, "consulta_id": "cf66ce98-e330-468c-bc05-627242f5e256"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 19:59:40.01625+00	2026-10-01 19:59:40.01625+00
6758e88c-0a96-4e2c-8e7a-1523f464f744	GUARDAR_CONSULTA	d5bbe1a5-6a6a-4dec-86f1-afe8b2b57e3f	{"creada": true, "consulta_id": "d5bbe1a5-6a6a-4dec-86f1-afe8b2b57e3f", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 21:06:22.733092+00	2026-10-01 21:06:22.733092+00
914da37e-8358-4a61-b810-f86169f1c5f3	CREAR_VENTA	46ddcaea-ec12-441d-8ec8-8f0d86886d03	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 4}, {"codigo": null, "cantidad": 1, "inventario_id": 2}], "venta_id": "46ddcaea-ec12-441d-8ec8-8f0d86886d03", "ya_existia": false, "consulta_id": "d5bbe1a5-6a6a-4dec-86f1-afe8b2b57e3f", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 21:22:58.365991+00	2026-10-01 21:22:58.365991+00
61d42326-c1c9-4a51-b693-21e38c19dffe	REGISTRAR_PAGO	0804c9fe-a765-4f7b-bdfc-2476ebf62061	{"monto": 10.00, "pago_id": "9cacd22e-700d-4e80-a7ad-6009ea66cd70", "pedido_id": "46ddcaea-ec12-441d-8ec8-8f0d86886d03", "ya_existia": false, "saldo_pendiente": 88.40}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 21:22:58.365991+00	2026-10-01 21:22:58.365991+00
08d9ed95-a34b-4566-b0a2-59fbde0f7485	REGISTRAR_PAGO	09d0addd-dde0-40aa-b5df-bfe9d5043ba6	{"monto": 88.40, "pago_id": "f048e6dd-1887-42d4-93a9-d768293a0313", "pedido_id": "46ddcaea-ec12-441d-8ec8-8f0d86886d03", "ya_existia": false, "saldo_pendiente": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-01 23:14:57.223145+00	2026-10-01 23:14:57.223145+00
5c327d88-513d-4fc9-9add-73d69c83dc8d	REEMBOLSAR_PAGO	8a04e629-99ff-457a-af51-066c016f9021	{"monto": 98.40, "pago_id": "c355f4e7-d88d-4a0f-9ce4-8e6abf17f905", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 02:28:54.189676+00	2026-10-02 02:28:54.189676+00
94f07585-677e-4d36-a342-267e76915477	ANULAR_VENTA	46ddcaea-ec12-441d-8ec8-8f0d86886d03	{"anulada": true, "venta_id": "46ddcaea-ec12-441d-8ec8-8f0d86886d03"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 02:28:54.189676+00	2026-10-02 02:28:54.189676+00
680f4814-742f-4da5-a8e0-900e9aae163e	ARCHIVAR_CONSULTA	d5bbe1a5-6a6a-4dec-86f1-afe8b2b57e3f	{"archivada": true, "consulta_id": "d5bbe1a5-6a6a-4dec-86f1-afe8b2b57e3f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 02:29:10.521788+00	2026-10-02 02:29:10.521788+00
1512617e-c642-4855-b038-3f53cbbb1fca	GUARDAR_CONSULTA	6dfda4e0-7339-435a-8205-ee406157fe5d	{"creada": true, "consulta_id": "6dfda4e0-7339-435a-8205-ee406157fe5d", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 03:48:38.057297+00	2026-10-02 03:48:38.057297+00
1cf2f29e-c8a4-4e1d-8763-c31ded0a6e88	GUARDAR_CONSULTA	6dfda4e0-7339-435a-8205-ee406157fe5d	{"creada": false, "consulta_id": "6dfda4e0-7339-435a-8205-ee406157fe5d", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 03:49:01.527618+00	2026-10-02 03:49:01.527618+00
aaaa7857-88d3-41ba-9112-1e1e959079f4	GUARDAR_CONSULTA	6dfda4e0-7339-435a-8205-ee406157fe5d	{"creada": false, "consulta_id": "6dfda4e0-7339-435a-8205-ee406157fe5d", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 03:49:41.039202+00	2026-10-02 03:49:41.039202+00
589ca88a-a130-49f3-9470-89ab23892770	GUARDAR_CONSULTA	6dfda4e0-7339-435a-8205-ee406157fe5d	{"creada": false, "consulta_id": "6dfda4e0-7339-435a-8205-ee406157fe5d", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 03:50:08.750767+00	2026-10-02 03:50:08.750767+00
b92f3015-0339-44f1-85da-6421fe46dca6	ARCHIVAR_CONSULTA	d5bbe1a5-6a6a-4dec-86f1-afe8b2b57e3f	{"archivada": true, "consulta_id": "d5bbe1a5-6a6a-4dec-86f1-afe8b2b57e3f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 04:09:44.428539+00	2026-10-02 04:09:44.428539+00
0c5a16ce-5679-449b-a9d0-8ff5d452a2bb	GUARDAR_CONSULTA	5f7af29e-1ef9-485b-ab20-d4d634912777	{"creada": true, "consulta_id": "5f7af29e-1ef9-485b-ab20-d4d634912777", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 04:10:13.088138+00	2026-10-02 04:10:13.088138+00
c5c33c7e-8b4a-416b-afd8-563d71818981	GUARDAR_CONSULTA	5f7af29e-1ef9-485b-ab20-d4d634912777	{"creada": false, "consulta_id": "5f7af29e-1ef9-485b-ab20-d4d634912777", "paciente_id": "4d371576-01e5-41ec-bc61-72a32e87db68"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 04:10:35.971824+00	2026-10-02 04:10:35.971824+00
c9f42aa6-1fe2-451f-bf0a-251053cf7ee6	GUARDAR_CONSULTA	dd3ffe12-eded-4bba-917e-5cfff2a75f6c	{"creada": true, "consulta_id": "dd3ffe12-eded-4bba-917e-5cfff2a75f6c", "paciente_id": "77d4ec0e-55ac-4825-9769-4208418d2276"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 14:20:42.727408+00	2026-10-02 14:20:42.727408+00
85185e54-9de0-4479-a448-cac2b5e72d74	GUARDAR_CONSULTA	dd3ffe12-eded-4bba-917e-5cfff2a75f6c	{"creada": false, "consulta_id": "dd3ffe12-eded-4bba-917e-5cfff2a75f6c", "paciente_id": "77d4ec0e-55ac-4825-9769-4208418d2276"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 14:21:07.085312+00	2026-10-02 14:21:07.085312+00
9a98b768-e7c8-4ff3-b44e-57951d344d54	GUARDAR_CONSULTA	dd3ffe12-eded-4bba-917e-5cfff2a75f6c	{"creada": false, "consulta_id": "dd3ffe12-eded-4bba-917e-5cfff2a75f6c", "paciente_id": "77d4ec0e-55ac-4825-9769-4208418d2276"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 14:30:48.516156+00	2026-10-02 14:30:48.516156+00
c244350c-9377-482c-b82c-cb2e43260ed7	GUARDAR_CONSULTA	dd3ffe12-eded-4bba-917e-5cfff2a75f6c	{"creada": false, "consulta_id": "dd3ffe12-eded-4bba-917e-5cfff2a75f6c", "paciente_id": "77d4ec0e-55ac-4825-9769-4208418d2276"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 14:34:24.367057+00	2026-10-02 14:34:24.367057+00
032dc39b-e7e7-4ddb-92b1-7655dfc7f65e	GUARDAR_CONSULTA	dd3ffe12-eded-4bba-917e-5cfff2a75f6c	{"creada": false, "consulta_id": "dd3ffe12-eded-4bba-917e-5cfff2a75f6c", "paciente_id": "77d4ec0e-55ac-4825-9769-4208418d2276"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 14:34:49.52248+00	2026-10-02 14:34:49.52248+00
ad688f26-d029-4e63-b6de-05d28f371fed	GUARDAR_CONSULTA	dd3ffe12-eded-4bba-917e-5cfff2a75f6c	{"creada": false, "consulta_id": "dd3ffe12-eded-4bba-917e-5cfff2a75f6c", "paciente_id": "77d4ec0e-55ac-4825-9769-4208418d2276"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 14:43:27.158712+00	2026-10-02 14:43:27.158712+00
32e2da5f-0bd7-4fbd-9bc5-4acdea419251	GUARDAR_CONSULTA	dd3ffe12-eded-4bba-917e-5cfff2a75f6c	{"creada": false, "consulta_id": "dd3ffe12-eded-4bba-917e-5cfff2a75f6c", "paciente_id": "77d4ec0e-55ac-4825-9769-4208418d2276"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 14:45:37.522809+00	2026-10-02 14:45:37.522809+00
213d5e69-7840-40f7-b2f3-52e4485a2609	GUARDAR_CONSULTA	dd3ffe12-eded-4bba-917e-5cfff2a75f6c	{"creada": false, "consulta_id": "dd3ffe12-eded-4bba-917e-5cfff2a75f6c", "paciente_id": "77d4ec0e-55ac-4825-9769-4208418d2276"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 15:25:14.455817+00	2026-10-02 15:25:14.455817+00
7a9ce541-c3aa-4c24-a8a3-b0631b1d4344	GUARDAR_CONSULTA	dd3ffe12-eded-4bba-917e-5cfff2a75f6c	{"creada": false, "consulta_id": "dd3ffe12-eded-4bba-917e-5cfff2a75f6c", "paciente_id": "77d4ec0e-55ac-4825-9769-4208418d2276"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 15:25:35.650969+00	2026-10-02 15:25:35.650969+00
81fa8417-672f-4415-bfb9-00117b6b2e39	GUARDAR_CONSULTA	dd3ffe12-eded-4bba-917e-5cfff2a75f6c	{"creada": false, "consulta_id": "dd3ffe12-eded-4bba-917e-5cfff2a75f6c", "paciente_id": "77d4ec0e-55ac-4825-9769-4208418d2276"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 17:27:33.565002+00	2026-10-02 17:27:33.565002+00
d71bce4e-e269-4912-8563-6cf501b7b254	GUARDAR_CONSULTA	55732b48-be95-41b8-abc9-04960c51a16d	{"creada": false, "consulta_id": "55732b48-be95-41b8-abc9-04960c51a16d", "paciente_id": "69852ef5-5110-4750-9bef-62f4c776b85f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 17:36:12.412667+00	2026-10-02 17:36:12.412667+00
5a5ce242-4136-4de5-b86b-efafca7f08f8	GUARDAR_CONSULTA	5efce7d9-d79f-49d5-9ca6-2a66132d97d9	{"creada": true, "consulta_id": "5efce7d9-d79f-49d5-9ca6-2a66132d97d9", "paciente_id": "57a0540c-9d44-4a96-999f-609bb8574646"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 18:01:31.710726+00	2026-10-02 18:01:31.710726+00
257601b9-eddf-4224-a721-bce19515e4b0	GUARDAR_CONSULTA	1df443bc-104a-4d40-b4d2-cd93e489e33d	{"creada": true, "consulta_id": "1df443bc-104a-4d40-b4d2-cd93e489e33d", "paciente_id": "57a0540c-9d44-4a96-999f-609bb8574646"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 18:02:06.275042+00	2026-10-02 18:02:06.275042+00
318dd5c4-6b91-4482-a2c9-82b4096f37ad	GUARDAR_CONSULTA	1ab32a86-5fa7-4f50-b2eb-5a1e0bc494f1	{"creada": true, "consulta_id": "1ab32a86-5fa7-4f50-b2eb-5a1e0bc494f1", "paciente_id": "57a0540c-9d44-4a96-999f-609bb8574646"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 18:05:39.429357+00	2026-10-02 18:05:39.429357+00
f9e1338e-dce2-4d28-b87f-6405c5d4bd3f	CREAR_VENTA	f30df89c-bfb3-407d-8886-c8ca5d44822f	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}, {"codigo": null, "cantidad": 1, "inventario_id": 3}], "venta_id": "f30df89c-bfb3-407d-8886-c8ca5d44822f", "ya_existia": false, "consulta_id": "1ab32a86-5fa7-4f50-b2eb-5a1e0bc494f1", "paciente_id": "57a0540c-9d44-4a96-999f-609bb8574646"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 18:07:53.474732+00	2026-10-02 18:07:53.474732+00
38a7ec2c-728f-4fe9-ae20-bdd9ba983ff1	REGISTRAR_PAGO	bd090b2e-5e28-4de6-9d7d-ef375eb99067	{"monto": 20.00, "pago_id": "bbe6cbcf-b29e-4ed4-a6eb-d0e81d84249e", "pedido_id": "f30df89c-bfb3-407d-8886-c8ca5d44822f", "ya_existia": false, "saldo_pendiente": 66.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 18:07:53.474732+00	2026-10-02 18:07:53.474732+00
d953c9e5-6f3d-4f61-80eb-3b3627b40cd2	CREAR_VENTA	43d0d876-0ee8-4363-918b-5d4c627fe16b	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 4}, {"codigo": null, "cantidad": 1, "inventario_id": 6}], "venta_id": "43d0d876-0ee8-4363-918b-5d4c627fe16b", "ya_existia": false, "consulta_id": "ade955e0-6559-46b0-901f-267e0f506bd3", "paciente_id": "d0001f6d-b895-4c17-ab39-71345b2c2f24"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 22:39:54.034397+00	2026-10-02 22:39:54.034397+00
48c40332-eafc-4684-8db7-425dcfaf0ff4	REGISTRAR_PAGO	d9796828-a8d1-4d37-9935-5c4c31a81767	{"monto": 20.00, "pago_id": "71313617-5a90-4041-a9c0-a08a70a81da2", "pedido_id": "43d0d876-0ee8-4363-918b-5d4c627fe16b", "ya_existia": false, "saldo_pendiente": 48.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 22:39:54.034397+00	2026-10-02 22:39:54.034397+00
e8a77df1-4416-4d41-b041-7dc391d28ac3	REEMBOLSAR_PAGO	71153a6d-5f3b-49f0-8030-ba5ba5db5115	{"monto": 20.00, "pago_id": "2f82402b-20af-4cd6-9c35-1db245da37de", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 22:41:29.018311+00	2026-10-02 22:41:29.018311+00
80685165-7787-4dd2-9e0a-46074408d23f	ANULAR_VENTA	43d0d876-0ee8-4363-918b-5d4c627fe16b	{"anulada": true, "venta_id": "43d0d876-0ee8-4363-918b-5d4c627fe16b"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 22:41:29.018311+00	2026-10-02 22:41:29.018311+00
ddbb3aec-5e04-4ace-b4f1-43cf7db07773	GUARDAR_CONSULTA	ffdd5b19-dc27-46b9-9fa8-78c60ff27d1a	{"creada": true, "consulta_id": "ffdd5b19-dc27-46b9-9fa8-78c60ff27d1a", "paciente_id": "272880f8-becf-4061-9128-32952ffce92f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-03 05:03:07.994121+00	2026-10-03 05:03:07.994121+00
c186efa0-3ff7-4141-a8f0-84a2260d60cb	GUARDAR_CONSULTA	5e1a6b10-9e9e-4f8f-9c1d-9a07b430b188	{"creada": true, "consulta_id": "5e1a6b10-9e9e-4f8f-9c1d-9a07b430b188", "paciente_id": "272880f8-becf-4061-9128-32952ffce92f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-03 11:08:11.119145+00	2026-10-03 11:08:11.119145+00
f35ff632-653d-4f5b-bf56-4e89d7962338	GUARDAR_CONSULTA	5e1a6b10-9e9e-4f8f-9c1d-9a07b430b188	{"creada": false, "consulta_id": "5e1a6b10-9e9e-4f8f-9c1d-9a07b430b188", "paciente_id": "272880f8-becf-4061-9128-32952ffce92f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-03 11:13:55.73189+00	2026-10-03 11:13:55.73189+00
040e0dee-2132-4820-9f87-5db37df48934	UPSERT_INVENTARIO	2	{"inventario": {"id": 2, "color": null, "marca": null, "stock": 1, "codigo": "XC95826", "modelo": null, "precio": "45", "material": "TR90", "categoria": "Armazon", "client_ref": null, "created_at": "2026-08-23T01:18:46.57939+00:00", "imagen_url": null, "descripcion": null, "costo_compra": "0", "param_puente": "17", "sync_version": 3, "tipo_armazon": "Completo", "material_nota": null, "param_frontal": null, "caracteristica": null, "param_diagonal": "55", "param_varillas": null, "param_vertical": "46", "nombre_accesorio": null, "param_horizontal": "54", "server_updated_at": "2026-10-04T03:40:30.101098+00:00"}, "servidor_id": 2}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 03:40:30.101098+00	2026-10-04 03:40:30.101098+00
ae52ba79-c917-42f9-b5c6-6638e8096974	GUARDAR_CONSULTA	0cff833d-a6e8-460e-827e-d11978bb7065	{"creada": true, "consulta_id": "0cff833d-a6e8-460e-827e-d11978bb7065", "paciente_id": "12db56da-e9e6-4119-b76a-456954eb3750"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 03:41:02.179616+00	2026-10-04 03:41:02.179616+00
216b1f20-2a11-4db3-bc8f-75f79df43abe	CREAR_VENTA	538e9847-1016-41b8-80fe-7ed9bd3ece1a	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}], "venta_id": "538e9847-1016-41b8-80fe-7ed9bd3ece1a", "ya_existia": false, "consulta_id": "0cff833d-a6e8-460e-827e-d11978bb7065", "paciente_id": "12db56da-e9e6-4119-b76a-456954eb3750"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 03:41:39.181887+00	2026-10-04 03:41:39.181887+00
6f6f0521-5a41-4605-9eb1-5d61de8a0d98	REGISTRAR_PAGO	8b89a535-c4a8-4f04-914d-0ace0243d729	{"monto": 10.00, "pago_id": "53dbfe6d-431b-4e0e-a09c-d16d1f59173c", "pedido_id": "538e9847-1016-41b8-80fe-7ed9bd3ece1a", "ya_existia": false, "saldo_pendiente": 35.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 03:41:39.181887+00	2026-10-04 03:41:39.181887+00
f81106e8-fd7f-487f-b025-5045ff6c1e99	GUARDAR_CONSULTA	d5082fbb-a49d-4276-bc9b-9a2b77e2009b	{"creada": true, "consulta_id": "d5082fbb-a49d-4276-bc9b-9a2b77e2009b", "paciente_id": "12db56da-e9e6-4119-b76a-456954eb3750"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 03:42:00.225812+00	2026-10-04 03:42:00.225812+00
e17512d5-d090-4844-8e61-2b2bdcf75573	GUARDAR_CONSULTA	239ba530-486a-4823-8dd3-82467dce3065	{"creada": true, "consulta_id": "239ba530-486a-4823-8dd3-82467dce3065", "paciente_id": "9d6b6aed-d20c-4e60-8f39-8501a064f191"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 13:39:13.04661+00	2026-10-04 13:39:13.04661+00
6f66b4b0-3a06-4ffb-9e8d-d63d99043154	GUARDAR_CONSULTA	eb7e59f8-5b1a-4086-884e-62c8b7e06ec9	{"creada": true, "consulta_id": "eb7e59f8-5b1a-4086-884e-62c8b7e06ec9", "paciente_id": "57e635ff-c985-4e17-b1c3-b0fcb096035a"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 13:40:24.204735+00	2026-10-04 13:40:24.204735+00
bc7cad1a-ce96-4b16-8739-f5ffe0c44e34	GUARDAR_CONSULTA	f1401ff9-5c3a-448a-bbd1-ad8629b8a340	{"creada": true, "consulta_id": "f1401ff9-5c3a-448a-bbd1-ad8629b8a340", "paciente_id": "b087f112-1782-472d-9921-f7ae7c66fd58"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:05:52.258023+00	2026-10-04 14:05:52.258023+00
5b8040a5-cbe6-4d8b-85a6-d2e89cbd5004	CREAR_VENTA	17b668b0-fd98-4045-8f98-70d8600848dc	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 4}, {"codigo": null, "cantidad": 1, "inventario_id": 2}], "venta_id": "17b668b0-fd98-4045-8f98-70d8600848dc", "ya_existia": false, "consulta_id": "f1401ff9-5c3a-448a-bbd1-ad8629b8a340", "paciente_id": "b087f112-1782-472d-9921-f7ae7c66fd58"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:06:47.535342+00	2026-10-04 14:06:47.535342+00
f57f8192-629a-44ea-b45c-7118b1619efe	REGISTRAR_PAGO	6244f3d3-6cd2-4ff6-b046-05197890e1db	{"monto": 20.00, "pago_id": "9fcb45cc-13b5-40bf-91d8-936b32aaf779", "pedido_id": "17b668b0-fd98-4045-8f98-70d8600848dc", "ya_existia": false, "saldo_pendiente": 38.80}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:06:47.535342+00	2026-10-04 14:06:47.535342+00
b070b055-76ba-4e4f-8ca0-b35f47ef76cc	GUARDAR_CONSULTA	5b159aa5-24a7-4c78-b49c-29b51eeff29f	{"creada": true, "consulta_id": "5b159aa5-24a7-4c78-b49c-29b51eeff29f", "paciente_id": "abb6b620-2c2a-45c2-86c9-2a3242c94cc7"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:10:10.716351+00	2026-10-04 14:10:10.716351+00
34e00664-6a1f-4337-a4bb-f076d2a85a46	UPSERT_PRECIO	-1791124227213	{"precio": {"id": 13, "notas": "TECNILENS", "material": "Policarbonato", "created_at": "2026-10-04T14:30:27.160802+00:00", "tipo_lente": "Monofocal", "tratamiento": "Antirreflejo Verde", "rango_medida": "-0.75 -4.00", "sync_version": 0, "precio_sugerido": "40", "costo_laboratorio": "8.97", "server_updated_at": "2026-10-04T14:30:27.160802+00:00"}, "servidor_id": 13}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:30:27.160802+00	2026-10-04 14:30:27.160802+00
68c0f4ea-f76c-4acc-8a0b-eecaf11247cd	CREAR_VENTA	63df3c7c-3b5e-47da-ade6-5ef78dd3942e	{"items": [], "venta_id": "63df3c7c-3b5e-47da-ade6-5ef78dd3942e", "ya_existia": false, "consulta_id": "3ce9ca5b-56ac-4e74-9c9f-0a94a9aabd13", "paciente_id": "3c1c077d-46d6-4d5d-a0f0-4f300f118c89"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:34:26.101779+00	2026-10-04 14:34:26.101779+00
15706609-c8a9-46d0-94c6-2df5f1d15a69	REGISTRAR_PAGO	f3b7ed90-501a-4d83-afa8-f0fb45e940b8	{"monto": 60.00, "pago_id": "f37e305c-544e-49d3-97e7-f7d328530de6", "pedido_id": "63df3c7c-3b5e-47da-ade6-5ef78dd3942e", "ya_existia": false, "saldo_pendiente": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:34:26.101779+00	2026-10-04 14:34:26.101779+00
a25c0d94-06ed-4b29-a6e9-7d700ed0a4a5	UPSERT_PRECIO	13	{"precio": {"id": 13, "notas": "TECNILENS", "material": "Policarbonato", "created_at": "2026-10-04T14:30:27.160802+00:00", "tipo_lente": "Monofocal", "tratamiento": "Antirreflejo Verde", "rango_medida": "-0.75 -4.00", "sync_version": 1, "precio_sugerido": "20", "costo_laboratorio": "4.49", "server_updated_at": "2026-10-04T14:38:05.031726+00:00"}, "servidor_id": 13}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:38:05.031726+00	2026-10-04 14:38:05.031726+00
f1cac661-7a85-43b4-85ff-b42d6309c798	UPSERT_PRECIO	-1791124723877	{"precio": {"id": 14, "notas": "TECNILENS", "material": "Policarbonato", "created_at": "2026-10-04T14:38:43.784015+00:00", "tipo_lente": "Monofocal", "tratamiento": "Antirreflejo Verde", "rango_medida": "-0.75 -3.50", "sync_version": 0, "precio_sugerido": "20", "costo_laboratorio": "4.49", "server_updated_at": "2026-10-04T14:38:43.784015+00:00"}, "servidor_id": 14}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:38:43.784015+00	2026-10-04 14:38:43.784015+00
0cf9da90-1865-4e79-a32e-8ab218d9cde6	GUARDAR_CONSULTA	16c83f83-16d0-4bb3-83db-bae1c149439b	{"creada": true, "consulta_id": "16c83f83-16d0-4bb3-83db-bae1c149439b", "paciente_id": "373094c9-08a2-4481-924c-0f93b4712f38"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 15:24:34.767921+00	2026-10-04 15:24:34.767921+00
e8a52376-9435-4da9-aa79-66a1d8c795c4	GUARDAR_CONSULTA	7cc9f53d-b2c9-45dd-bfb6-af92228048d7	{"creada": false, "consulta_id": "7cc9f53d-b2c9-45dd-bfb6-af92228048d7", "paciente_id": "bff1ff63-6659-4b10-9a54-cc7a1e2d37ce"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 15:24:57.033633+00	2026-10-04 15:24:57.033633+00
62707941-ed52-48b0-a439-8ac5bc900bde	GUARDAR_CONSULTA	0dd3c00d-ce97-4efd-be6e-ae892ef9e552	{"creada": true, "consulta_id": "0dd3c00d-ce97-4efd-be6e-ae892ef9e552", "paciente_id": "a692cab2-aaaa-456b-ac84-aa091199496d"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 23:31:19.321835+00	2026-10-04 23:31:19.321835+00
79d33b5a-8ea5-4654-8c58-dc64055b731d	CREAR_VENTA	2754dfe3-6ea9-4e63-95b4-5e2d65a0e873	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}], "venta_id": "2754dfe3-6ea9-4e63-95b4-5e2d65a0e873", "ya_existia": false, "consulta_id": "0dd3c00d-ce97-4efd-be6e-ae892ef9e552", "paciente_id": "a692cab2-aaaa-456b-ac84-aa091199496d"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 23:37:54.159491+00	2026-10-04 23:37:54.159491+00
aac1ffc8-c1cd-483e-89a4-a1a47ec5e411	REGISTRAR_PAGO	47be8953-98be-4932-b0cb-b352d18e0dc7	{"monto": 10.00, "pago_id": "f3b2db67-07ee-4fb9-8c8c-fae357aa3cd2", "pedido_id": "2754dfe3-6ea9-4e63-95b4-5e2d65a0e873", "ya_existia": false, "saldo_pendiente": 135.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 23:37:54.159491+00	2026-10-04 23:37:54.159491+00
38fc70a9-f658-44ad-a588-58fbc1ee49ca	EDITAR_VENTA	2754dfe3-6ea9-4e63-95b4-5e2d65a0e873	{"items": [{"codigo": null, "cantidad": 1, "inventory_id": 2}], "version": 1, "venta_id": "2754dfe3-6ea9-4e63-95b4-5e2d65a0e873"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 23:38:10.918467+00	2026-10-04 23:38:10.918467+00
7dbfccb9-25fe-4a4a-8d7d-49ec4cc7bc61	GUARDAR_CONSULTA	7436eeee-88c1-4585-b788-79f3b196d9bc	{"creada": true, "consulta_id": "7436eeee-88c1-4585-b788-79f3b196d9bc", "paciente_id": "735a3603-c7f5-4d61-82d0-d62124197fbf"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 03:49:26.235441+00	2026-10-06 03:49:26.235441+00
2fcbf32b-e8fb-4f7b-abf9-48527af8344b	CREAR_VENTA	6c6d870b-f35f-4ce5-a987-360917e6558c	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 3}, {"codigo": null, "cantidad": 1, "inventario_id": 2}], "venta_id": "6c6d870b-f35f-4ce5-a987-360917e6558c", "ya_existia": false, "consulta_id": "7436eeee-88c1-4585-b788-79f3b196d9bc", "paciente_id": "735a3603-c7f5-4d61-82d0-d62124197fbf"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 03:51:27.84851+00	2026-10-06 03:51:27.84851+00
8afe0ffc-e5ea-449a-a571-45b4247ffee5	REGISTRAR_PAGO	7b472441-808a-4dd3-b0a1-c02371c67826	{"monto": 50.00, "pago_id": "1775dfed-1f80-4684-bf14-fef5337f38af", "pedido_id": "6c6d870b-f35f-4ce5-a987-360917e6558c", "ya_existia": false, "saldo_pendiente": 26.80}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 03:51:27.84851+00	2026-10-06 03:51:27.84851+00
18954214-a29c-4a3e-84ac-35f07d5dfdae	REGISTRAR_PAGO	520214c3-b869-4c9c-9fa6-bc55b0a2a23a	{"monto": 26.80, "pago_id": "f3582fb8-7a77-4ccb-848f-3ab652a6833e", "pedido_id": "6c6d870b-f35f-4ce5-a987-360917e6558c", "ya_existia": false, "saldo_pendiente": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 04:49:09.623936+00	2026-10-06 04:49:09.623936+00
ed526060-a1b8-4c7f-aabc-0c96b60b8dab	CAMBIAR_ESTADO_VENTA	6c6d870b-f35f-4ce5-a987-360917e6558c	{"estado": "Entregado", "venta_id": "6c6d870b-f35f-4ce5-a987-360917e6558c"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 04:49:51.708692+00	2026-10-06 04:49:51.708692+00
80bb410f-1f1e-43b0-895e-fbb805f7e09c	REEMBOLSAR_PAGO	eca8aa0e-9231-4009-9b80-0c8d5bdf4a09	{"monto": 76.80, "pago_id": "edb7639c-1fdd-40b0-96d8-0b16c67377f7", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 04:51:08.471628+00	2026-10-06 04:51:08.471628+00
99b067a4-afd3-40e8-88b3-8697f17b0458	ANULAR_VENTA	6c6d870b-f35f-4ce5-a987-360917e6558c	{"anulada": true, "venta_id": "6c6d870b-f35f-4ce5-a987-360917e6558c"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 04:51:08.471628+00	2026-10-06 04:51:08.471628+00
f98ba14f-a991-4f1c-b3bd-16d1ff00de35	GUARDAR_CONSULTA	fa39f268-70fc-4919-a432-aa742f44aa8a	{"creada": true, "consulta_id": "fa39f268-70fc-4919-a432-aa742f44aa8a", "paciente_id": "735a3603-c7f5-4d61-82d0-d62124197fbf"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 04:55:59.795597+00	2026-10-06 04:55:59.795597+00
edf7c084-39e8-4c41-a695-14695c0558a5	GUARDAR_CONSULTA	da9f330c-c89c-49e3-b08e-37ff506fb3ed	{"creada": true, "consulta_id": "da9f330c-c89c-49e3-b08e-37ff506fb3ed", "paciente_id": "380b4ef3-aa60-41ab-88a0-1ab27cfbfd96"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 14:35:27.749209+00	2026-10-06 14:35:27.749209+00
532a30d8-971d-418c-8b61-20bb24f3f2ba	GUARDAR_CONSULTA	3875cde6-84e9-4ae3-b219-3f08f17d5f76	{"creada": true, "consulta_id": "3875cde6-84e9-4ae3-b219-3f08f17d5f76", "paciente_id": "380b4ef3-aa60-41ab-88a0-1ab27cfbfd96"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 15:45:04.985966+00	2026-10-06 15:45:04.985966+00
71e1dbce-d977-440c-9a93-3658834cc7bb	GUARDAR_CONSULTA	2b2368ea-0d53-49f4-8d62-52e2336a5edf	{"creada": true, "consulta_id": "2b2368ea-0d53-49f4-8d62-52e2336a5edf", "paciente_id": "380b4ef3-aa60-41ab-88a0-1ab27cfbfd96"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 15:46:31.97039+00	2026-10-06 15:46:31.97039+00
a8f8256d-e3c7-4e46-823b-cd1e43296e29	CREAR_VENTA	f7823284-3d70-4901-9d22-104a8aee010e	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}, {"codigo": null, "cantidad": 1, "inventario_id": 3}], "venta_id": "f7823284-3d70-4901-9d22-104a8aee010e", "ya_existia": false, "consulta_id": "3875cde6-84e9-4ae3-b219-3f08f17d5f76", "paciente_id": "380b4ef3-aa60-41ab-88a0-1ab27cfbfd96"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 16:04:20.064928+00	2026-10-06 16:04:20.064928+00
ec266fcd-24f4-42ca-b46a-27ab513e10b1	REGISTRAR_PAGO	c8b87459-6edb-4b5e-be5d-b3910cf5cdf1	{"monto": 30.00, "pago_id": "71777ac0-4754-430a-996b-2b0a65b178e7", "pedido_id": "f7823284-3d70-4901-9d22-104a8aee010e", "ya_existia": false, "saldo_pendiente": 38.80}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 16:04:20.064928+00	2026-10-06 16:04:20.064928+00
1af2b1aa-22eb-4a96-84a9-6ec41d8c1a08	REGISTRAR_PAGO	427b3fa8-ba39-4e85-b9dd-64a5d1a54a08	{"monto": 38.80, "pago_id": "ac3e1f3f-69ab-463a-b68c-96e632414016", "pedido_id": "f7823284-3d70-4901-9d22-104a8aee010e", "ya_existia": false, "saldo_pendiente": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 16:05:30.979931+00	2026-10-06 16:05:30.979931+00
8d026935-ce03-4b64-976c-6f1af1b9dd8d	REEMBOLSAR_PAGO	42f05748-dc3f-4697-bc0b-1359c7814214	{"monto": 68.80, "pago_id": "20a7a435-0ea6-49ef-8991-b1c1bd91fbdf", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 16:08:09.610198+00	2026-10-06 16:08:09.610198+00
d4cff66b-06b8-4456-a98d-25e2228417c7	ANULAR_VENTA	f7823284-3d70-4901-9d22-104a8aee010e	{"anulada": true, "venta_id": "f7823284-3d70-4901-9d22-104a8aee010e"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 16:08:09.610198+00	2026-10-06 16:08:09.610198+00
0e1fce7d-6486-4d36-a55a-0ced929ad060	CREAR_VENTA	073aead6-11c1-4fe1-8b8a-5ee5efc1bc52	{"items": [], "venta_id": "073aead6-11c1-4fe1-8b8a-5ee5efc1bc52", "ya_existia": false, "consulta_id": "3875cde6-84e9-4ae3-b219-3f08f17d5f76", "paciente_id": "380b4ef3-aa60-41ab-88a0-1ab27cfbfd96"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 16:40:58.517594+00	2026-10-06 16:40:58.517594+00
65885fc4-2b6a-4822-9570-81d7c0411702	REGISTRAR_PAGO	d0f756e0-7255-47d2-8b76-d7d14358c552	{"monto": 4.96, "pago_id": "9a702fb7-e57a-441d-8118-ec167ee5b66a", "pedido_id": "073aead6-11c1-4fe1-8b8a-5ee5efc1bc52", "ya_existia": false, "saldo_pendiente": 15.04}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 16:40:58.517594+00	2026-10-06 16:40:58.517594+00
5c17702c-b0c4-4cd0-8878-bd2d9e2e1292	REEMBOLSAR_PAGO	37bb8a92-ca09-4092-9721-afd6f49396bb	{"monto": 4.96, "pago_id": "1c2235e6-b818-4292-bf19-76f2d8754edc", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 16:42:24.680269+00	2026-10-06 16:42:24.680269+00
36479a4b-9b4e-483c-91d1-817d8aee3c17	GUARDAR_CONSULTA	ceda1f8e-adfd-419c-abb0-6a40f62a36b1	{"creada": true, "consulta_id": "ceda1f8e-adfd-419c-abb0-6a40f62a36b1", "paciente_id": "fa95e96b-eadf-4a37-832e-0251c96a8921"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 19:21:51.367221+00	2026-10-06 19:21:51.367221+00
482a8f64-038b-45fd-9260-2757d4493dc4	CREAR_VENTA	1bc119a2-1001-4472-b67a-9e2a3a9785ce	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}, {"codigo": null, "cantidad": 1, "inventario_id": 3}], "venta_id": "1bc119a2-1001-4472-b67a-9e2a3a9785ce", "ya_existia": false, "consulta_id": "ceda1f8e-adfd-419c-abb0-6a40f62a36b1", "paciente_id": "fa95e96b-eadf-4a37-832e-0251c96a8921"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 19:24:50.626798+00	2026-10-06 19:24:50.626798+00
db1cf84c-31be-4b72-9a10-cfb2926ddcba	REGISTRAR_PAGO	0398a27b-58ab-40b5-9d3e-0b50d2fae3e3	{"monto": 10.00, "pago_id": "220b3790-e4bb-41a0-ad20-3c8ea356e5f9", "pedido_id": "1bc119a2-1001-4472-b67a-9e2a3a9785ce", "ya_existia": false, "saldo_pendiente": 58.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 19:24:50.626798+00	2026-10-06 19:24:50.626798+00
c882a317-6811-425a-b182-74740cd907ef	REGISTRAR_PAGO	c78c3327-628f-4397-aa84-c10731e12358	{"monto": 58.00, "pago_id": "0525039a-d07e-4463-a948-635451913fb2", "pedido_id": "1bc119a2-1001-4472-b67a-9e2a3a9785ce", "ya_existia": false, "saldo_pendiente": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 19:25:25.693023+00	2026-10-06 19:25:25.693023+00
f06fc2b9-100b-493d-86ec-5945bd2bd366	REEMBOLSAR_PAGO	d70f3b07-3a0e-4218-8cd3-bbdd44b5dafc	{"monto": 68.00, "pago_id": "4513d75f-b0ce-4356-ba61-2bfab55d3e70", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 19:43:58.32164+00	2026-10-06 19:43:58.32164+00
d6b5a6f0-96d0-4ed2-a7a5-71a6aee877b9	ANULAR_VENTA	1bc119a2-1001-4472-b67a-9e2a3a9785ce	{"anulada": true, "venta_id": "1bc119a2-1001-4472-b67a-9e2a3a9785ce"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 19:43:58.32164+00	2026-10-06 19:43:58.32164+00
391d1a31-a325-42c6-bc97-b63f1c210cdf	ANULAR_VENTA	1bc119a2-1001-4472-b67a-9e2a3a9785ce	{"anulada": true, "venta_id": "1bc119a2-1001-4472-b67a-9e2a3a9785ce"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 19:44:06.736214+00	2026-10-06 19:44:06.736214+00
ea990b1d-3261-42a0-82ab-1d53cd1275f2	CREAR_VENTA	3111866d-9134-4570-8069-adc72b2935ea	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}], "venta_id": "3111866d-9134-4570-8069-adc72b2935ea", "ya_existia": false, "consulta_id": "ceda1f8e-adfd-419c-abb0-6a40f62a36b1", "paciente_id": "fa95e96b-eadf-4a37-832e-0251c96a8921"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 19:45:18.758855+00	2026-10-06 19:45:18.758855+00
b7c82880-a160-4459-8e42-c05f4d69559a	REGISTRAR_PAGO	aeb66fc2-80d6-4fa5-87d7-49c725bc3a07	{"monto": 10.00, "pago_id": "a58f0604-699d-43a8-8a4e-04b386dc7bf2", "pedido_id": "3111866d-9134-4570-8069-adc72b2935ea", "ya_existia": false, "saldo_pendiente": 35.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 19:45:18.758855+00	2026-10-06 19:45:18.758855+00
796ea2e2-9c46-4dfd-91bb-0475aef48712	REGISTRAR_PAGO	5ac93af8-7e06-4b05-b800-eac75d6b2e3a	{"monto": 35.00, "pago_id": "e441d0bb-eee9-4f25-858d-5d97cc54ee81", "pedido_id": "3111866d-9134-4570-8069-adc72b2935ea", "ya_existia": false, "saldo_pendiente": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 19:45:25.630293+00	2026-10-06 19:45:25.630293+00
0b3ae525-2fc3-4567-a565-0e55e8230a96	GUARDAR_CONSULTA	968f8137-1712-41bf-b8ee-e8b3182c1bea	{"creada": true, "consulta_id": "968f8137-1712-41bf-b8ee-e8b3182c1bea", "paciente_id": "e85d8ef1-db65-48d0-8927-8b683b0a501f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 21:22:41.981283+00	2026-10-06 21:22:41.981283+00
8afa164e-4cfa-4035-a311-7f78777c9925	GUARDAR_CONSULTA	0bf31771-2941-459f-923f-959aa4342d70	{"creada": true, "consulta_id": "0bf31771-2941-459f-923f-959aa4342d70", "paciente_id": "e85d8ef1-db65-48d0-8927-8b683b0a501f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 21:22:41.981283+00	2026-10-06 21:22:41.981283+00
967377b9-e8e9-4b79-8a30-2c4ff56373c1	CREAR_VENTA	02f0bae7-cb9e-4036-90d7-67776bfa17ea	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 3}, {"codigo": null, "cantidad": 1, "inventario_id": 14}], "venta_id": "02f0bae7-cb9e-4036-90d7-67776bfa17ea", "ya_existia": false, "consulta_id": "0bf31771-2941-459f-923f-959aa4342d70", "paciente_id": "e85d8ef1-db65-48d0-8927-8b683b0a501f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 21:22:41.981283+00	2026-10-06 21:22:41.981283+00
d966f639-1922-461a-96aa-41cf8e7f8b58	REGISTRAR_PAGO	392003c4-65ec-4824-9076-e943a86e6e69	{"monto": 60.00, "pago_id": "7ec08e60-15fb-438b-aed9-37a3435f3685", "pedido_id": "02f0bae7-cb9e-4036-90d7-67776bfa17ea", "ya_existia": false, "saldo_pendiente": 0.29}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 21:22:41.981283+00	2026-10-06 21:22:41.981283+00
2929260d-1cae-4bea-b1f0-0d11147dcafe	EDITAR_VENTA	02f0bae7-cb9e-4036-90d7-67776bfa17ea	{"items": [{"codigo": null, "cantidad": 1, "inventory_id": 3}, {"codigo": null, "cantidad": 1, "inventory_id": 14}], "version": 1, "venta_id": "02f0bae7-cb9e-4036-90d7-67776bfa17ea"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 21:22:41.981283+00	2026-10-06 21:22:41.981283+00
568c90b3-7890-4778-9163-02e983eba204	REEMBOLSAR_PAGO	fb8c0e15-4566-4852-8cb3-a9b5414f461a	{"monto": 60.00, "pago_id": "83d1213f-e5cb-4cdd-8b1d-e01fc2ecb8bc", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 21:22:41.981283+00	2026-10-06 21:22:41.981283+00
6a7f494f-ea09-43bd-a4db-a8eef8ac75c8	ANULAR_VENTA	02f0bae7-cb9e-4036-90d7-67776bfa17ea	{"anulada": true, "venta_id": "02f0bae7-cb9e-4036-90d7-67776bfa17ea"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 21:22:41.981283+00	2026-10-06 21:22:41.981283+00
ab7d84cb-3115-4468-ac05-60120da2c53f	CREAR_VENTA	962518ce-f703-4c2a-be33-6c426d0fd731	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 23}], "venta_id": "962518ce-f703-4c2a-be33-6c426d0fd731", "ya_existia": false, "consulta_id": "0bf31771-2941-459f-923f-959aa4342d70", "paciente_id": "e85d8ef1-db65-48d0-8927-8b683b0a501f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 22:10:52.14243+00	2026-10-06 22:10:52.14243+00
2fa67661-24aa-4310-93b4-74af9c6fc3be	EDITAR_VENTA	962518ce-f703-4c2a-be33-6c426d0fd731	{"items": [{"codigo": null, "cantidad": 1, "inventory_id": 23}], "version": 1, "venta_id": "962518ce-f703-4c2a-be33-6c426d0fd731"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 22:10:52.14243+00	2026-10-06 22:10:52.14243+00
41e274a8-b941-4b51-871d-56d7932f5d41	GUARDAR_CONSULTA	3f129560-f2cb-41c0-a058-b8d274722bba	{"creada": true, "consulta_id": "3f129560-f2cb-41c0-a058-b8d274722bba", "paciente_id": "e85d8ef1-db65-48d0-8927-8b683b0a501f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 22:10:52.14243+00	2026-10-06 22:10:52.14243+00
d91496d3-6632-47c1-9e5f-745c848fef48	CREAR_VENTA	4928c3f1-a8b5-413d-804e-6d6730df4854	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}], "venta_id": "4928c3f1-a8b5-413d-804e-6d6730df4854", "ya_existia": false, "consulta_id": "88262d44-f418-44ae-b1cb-6671322d1b0a", "paciente_id": "425c31b4-c897-4096-8757-64afd690eb4f"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 22:10:52.14243+00	2026-10-06 22:10:52.14243+00
06fc354a-30ff-4643-8c6c-126342d13952	REGISTRAR_PAGO	fc5fd902-f730-49d8-86e9-c7aa15388828	{"monto": 45.00, "pago_id": "c4032316-7b85-4098-a74b-7f5eb44eb87c", "pedido_id": "4928c3f1-a8b5-413d-804e-6d6730df4854", "ya_existia": false, "saldo_pendiente": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 22:10:52.14243+00	2026-10-06 22:10:52.14243+00
d918bf7d-1fd0-447c-9cab-308925691203	REGISTRAR_PAGO	103c9477-d8fb-479e-9fbf-7dac8d1a4602	{"monto": 20.00, "pago_id": "b23ee77b-7a24-4bdb-89c2-9df88af102e0", "pedido_id": "962518ce-f703-4c2a-be33-6c426d0fd731", "ya_existia": false, "saldo_pendiente": 45.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 22:10:52.14243+00	2026-10-06 22:10:52.14243+00
c5f23609-d274-46f6-b4ab-17e807a1968e	REGISTRAR_PAGO	9c9e5646-3d24-4991-8301-b940226f5871	{"monto": 45.00, "pago_id": "2d189b36-7b36-4971-864d-bc472fecc9c3", "pedido_id": "962518ce-f703-4c2a-be33-6c426d0fd731", "ya_existia": false, "saldo_pendiente": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 22:10:52.14243+00	2026-10-06 22:10:52.14243+00
773a1d05-7f30-4fc2-b3ef-05493f59024c	GUARDAR_CONSULTA	6c5e8d5c-8166-407c-bfeb-28343bb92bca	{"creada": true, "consulta_id": "6c5e8d5c-8166-407c-bfeb-28343bb92bca", "paciente_id": "7e7c497d-2ccb-446f-8b37-ecb0e04f502e"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 22:10:52.14243+00	2026-10-06 22:10:52.14243+00
35a6760b-1819-456a-8b91-80a60519433a	CREAR_VENTA	dac6988f-0875-4373-9eec-8f8f231d3136	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 3}, {"codigo": null, "cantidad": 1, "inventario_id": 22}], "venta_id": "dac6988f-0875-4373-9eec-8f8f231d3136", "ya_existia": false, "consulta_id": "6c5e8d5c-8166-407c-bfeb-28343bb92bca", "paciente_id": "7e7c497d-2ccb-446f-8b37-ecb0e04f502e"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 22:10:52.14243+00	2026-10-06 22:10:52.14243+00
1b2462e9-5bb2-420e-b128-3d58ff7d4192	REGISTRAR_PAGO	a27ba18d-cc1a-4afb-9ada-7b6e335f3a5f	{"monto": 10.00, "pago_id": "3e530a95-509d-4e9f-a262-5d2b4adb678d", "pedido_id": "dac6988f-0875-4373-9eec-8f8f231d3136", "ya_existia": false, "saldo_pendiente": 16.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 22:10:52.14243+00	2026-10-06 22:10:52.14243+00
262253a9-1f0f-4404-b7ce-b54166287b07	REEMBOLSAR_PAGO	3807f0f8-407b-451a-9af3-f03a476a826e	{"monto": 10.00, "pago_id": "953c9c29-63cf-4764-9ee4-b36093e0d3cd", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 23:03:34.552311+00	2026-10-06 23:03:34.552311+00
74c8f1e8-d7a0-485a-b6df-c39d4b877847	ANULAR_VENTA	dac6988f-0875-4373-9eec-8f8f231d3136	{"anulada": true, "venta_id": "dac6988f-0875-4373-9eec-8f8f231d3136"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 23:03:34.552311+00	2026-10-06 23:03:34.552311+00
e7d2697f-f336-4268-9224-50a14fb94a77	ANULAR_VENTA	dac6988f-0875-4373-9eec-8f8f231d3136	{"anulada": true, "venta_id": "dac6988f-0875-4373-9eec-8f8f231d3136"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 23:03:38.197546+00	2026-10-06 23:03:38.197546+00
cff168c6-9067-43b3-92a2-73abfe0e11ae	REEMBOLSAR_PAGO	00d4dbdf-e088-4440-af7b-f9815de83d14	{"monto": 65.00, "pago_id": "d1618ebb-8a07-4093-8cda-80f96f8f0e2a", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 23:03:40.784445+00	2026-10-06 23:03:40.784445+00
ac0b7dd4-35e5-4b51-a15b-5fedc3029144	ANULAR_VENTA	962518ce-f703-4c2a-be33-6c426d0fd731	{"anulada": true, "venta_id": "962518ce-f703-4c2a-be33-6c426d0fd731"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 23:03:40.784445+00	2026-10-06 23:03:40.784445+00
d52936cc-4d48-4657-8027-de9c399b6cdd	REEMBOLSAR_PAGO	d1d68e2c-9063-43a3-8f8e-4bf2dd8bec08	{"monto": 45.00, "pago_id": "1dfaa3c0-cb41-4b24-aa3e-f31f6bdad80c", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 23:03:50.151387+00	2026-10-06 23:03:50.151387+00
3bec6aea-fabc-4042-9ffe-dad986a796d8	ANULAR_VENTA	4928c3f1-a8b5-413d-804e-6d6730df4854	{"anulada": true, "venta_id": "4928c3f1-a8b5-413d-804e-6d6730df4854"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 23:03:50.151387+00	2026-10-06 23:03:50.151387+00
1d335b8c-f9d2-401d-a150-a6456878761f	ANULAR_VENTA	4928c3f1-a8b5-413d-804e-6d6730df4854	{"anulada": true, "venta_id": "4928c3f1-a8b5-413d-804e-6d6730df4854"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 23:03:56.079056+00	2026-10-06 23:03:56.079056+00
89386c20-0488-4280-84f5-ac20c8a8ab1d	UPSERT_PRECIO	-1791405619778	{"precio": {"id": 15, "notas": "Índice 1.56 - Resina media", "material": "Reducido (1.61/1.67)", "created_at": "2026-10-07T20:40:20.743034+00:00", "tipo_lente": "Monofocal", "tratamiento": "Antirreflejo Verde", "rango_medida": "1.56 | Esf ±2.00 a ±3.00 | Cil hasta -3.00 (Pot. máx ±4.50)", "sync_version": 0, "precio_sugerido": "20", "costo_laboratorio": "2.5", "server_updated_at": "2026-10-07T20:40:20.743034+00:00"}, "servidor_id": 15}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-07 20:40:20.743034+00	2026-10-07 20:40:20.743034+00
3e2787b1-6ee6-4b69-8ccd-18770cf43038	GUARDAR_CONSULTA	31aca2e2-4ff7-458f-ad34-e2ca10f9d0f1	{"creada": true, "consulta_id": "31aca2e2-4ff7-458f-ad34-e2ca10f9d0f1", "paciente_id": "cf63e290-ee4b-4ce6-9f8a-1d0b50fb1c35"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-07 23:14:17.978748+00	2026-10-07 23:14:17.978748+00
342b0de3-64da-42fb-856d-41ee8239d8c4	UPSERT_INVENTARIO	-1791415194498	{"inventario": {"id": 28, "color": null, "marca": null, "stock": 1, "codigo": "DXCC1234 ", "modelo": null, "precio": "0", "material": "METAL / TERMINALES DE PLASTICO", "categoria": "Armazon", "client_ref": "-1791415194498", "created_at": "2026-10-07T23:19:55.409587+00:00", "imagen_url": null, "descripcion": null, "costo_compra": "0", "param_puente": "20", "sync_version": 0, "tipo_armazon": "Al Aire", "material_nota": null, "param_frontal": "135", "caracteristica": null, "param_diagonal": "56", "param_varillas": "145", "param_vertical": "35", "nombre_accesorio": null, "param_horizontal": "55", "server_updated_at": "2026-10-07T23:19:55.409587+00:00"}, "servidor_id": 28}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-07 23:19:55.409587+00	2026-10-07 23:19:55.409587+00
5a798097-b7f9-48f1-97b4-405830b04668	UPSERT_INVENTARIO	28	{"inventario": {"id": 28, "color": null, "marca": null, "stock": 1, "codigo": "DXCC1234 ", "modelo": null, "precio": "30", "material": "METAL / TERMINALES DE PLASTICO", "categoria": "Armazon", "client_ref": "-1791415194498", "created_at": "2026-10-07T23:19:55.409587+00:00", "imagen_url": "producto_1791427001918_22024d13.jpg", "descripcion": "DORADO CON TERMINAL NEGRO Y PLAQUETAS", "costo_compra": "5.25", "param_puente": "20", "sync_version": 1, "tipo_armazon": "Al Aire", "material_nota": null, "param_frontal": "135", "caracteristica": null, "param_diagonal": "56", "param_varillas": "145", "param_vertical": "35", "nombre_accesorio": null, "param_horizontal": "55", "server_updated_at": "2026-10-08T02:36:43.384673+00:00"}, "servidor_id": 28}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-08 02:36:43.384673+00	2026-10-08 02:36:43.384673+00
e5a9b64d-e237-4619-a898-8070f1157efe	CREAR_VENTA	81c14cf6-2629-4a45-a74a-6382a3c7791d	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 3}, {"codigo": null, "cantidad": 1, "inventario_id": 28}], "venta_id": "81c14cf6-2629-4a45-a74a-6382a3c7791d", "ya_existia": false, "consulta_id": "31aca2e2-4ff7-458f-ad34-e2ca10f9d0f1", "paciente_id": "cf63e290-ee4b-4ce6-9f8a-1d0b50fb1c35"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-08 03:25:56.018305+00	2026-10-08 03:25:56.018305+00
3a176d8c-dbc3-46e5-8201-8ba70da60533	REGISTRAR_PAGO	cfd97c6d-56f6-4672-819c-d05a7319ff3f	{"monto": 25.00, "pago_id": "2786c1bf-3316-49c6-abea-019459aab957", "pedido_id": "81c14cf6-2629-4a45-a74a-6382a3c7791d", "ya_existia": false, "saldo_pendiente": 45.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-10 16:58:11.530416+00	2026-10-10 16:58:11.530416+00
4c938fb4-2d91-4b23-9d76-6f7ed6f42e4a	CAMBIAR_ESTADO_VENTA	81c14cf6-2629-4a45-a74a-6382a3c7791d	{"estado": "Listo para Entrega", "venta_id": "81c14cf6-2629-4a45-a74a-6382a3c7791d"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-10 17:08:31.280058+00	2026-10-10 17:08:31.280058+00
2bb60e64-143a-4bca-8f6e-d551cd4d9d51	REGISTRAR_PAGO	499d3d3e-e089-4c18-ab00-296a3ce84046	{"monto": 45.00, "pago_id": "e641f4f0-1dfa-4e8b-b8a5-1411bd98e203", "pedido_id": "81c14cf6-2629-4a45-a74a-6382a3c7791d", "ya_existia": false, "saldo_pendiente": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-16 18:29:45.331672+00	2026-10-16 18:29:45.331672+00
2f3a6a17-0116-40a5-8d38-855fe24c38a0	GUARDAR_CONSULTA	6eddfc82-8337-4660-a47e-746020d90d4c	{"creada": true, "consulta_id": "6eddfc82-8337-4660-a47e-746020d90d4c", "paciente_id": "b8c802de-8829-4357-94cd-2e853b54dc45"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-17 20:41:57.303444+00	2026-10-17 20:41:57.303444+00
93c74c97-361a-45f6-838b-6ec5fc958757	GUARDAR_CONSULTA	0d631322-f275-406e-999f-0c47f9f9da38	{"creada": true, "consulta_id": "0d631322-f275-406e-999f-0c47f9f9da38", "paciente_id": "58527d51-432a-4270-94bf-d455a63301bd"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-17 20:55:09.42122+00	2026-10-17 20:55:09.42122+00
b502db15-f592-4f9d-896e-5564a721a689	CREAR_VENTA	a935ba06-e189-4b63-9c1f-c6a783434f50	{"items": [{"codigo": null, "cantidad": 1, "inventario_id": 2}], "venta_id": "a935ba06-e189-4b63-9c1f-c6a783434f50", "ya_existia": false, "consulta_id": "0d631322-f275-406e-999f-0c47f9f9da38", "paciente_id": "58527d51-432a-4270-94bf-d455a63301bd"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-17 20:58:22.96522+00	2026-10-17 20:58:22.96522+00
a60d5a1e-4248-4424-abbc-f45df55a971e	REGISTRAR_PAGO	5df50af2-4d9c-487f-8330-1a1cf1be3161	{"monto": 10.00, "pago_id": "fb4a49e9-b10b-41bd-a44d-27cd15ee1996", "pedido_id": "a935ba06-e189-4b63-9c1f-c6a783434f50", "ya_existia": false, "saldo_pendiente": 35.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-17 21:00:04.579957+00	2026-10-17 21:00:04.579957+00
87ba9efa-b1af-49aa-acc3-5e73b5f95620	REEMBOLSAR_PAGO	d268b544-662e-4455-84db-1e3bbf3d07b6	{"monto": 10.00, "pago_id": "18eb38b2-b810-4e45-9574-8fba6d175d8e", "reembolso": true, "abono_restante": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-17 21:00:38.645996+00	2026-10-17 21:00:38.645996+00
a70ff8d2-283f-4b93-b59e-c3917519204e	ANULAR_VENTA	a935ba06-e189-4b63-9c1f-c6a783434f50	{"anulada": true, "venta_id": "a935ba06-e189-4b63-9c1f-c6a783434f50"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-17 21:00:38.645996+00	2026-10-17 21:00:38.645996+00
7e792543-3983-47ef-8870-8693f1b305c6	GUARDAR_CONSULTA	807fde1d-6acb-4878-97e7-db28ac7a545c	{"creada": true, "consulta_id": "807fde1d-6acb-4878-97e7-db28ac7a545c", "paciente_id": "07599973-81b1-4049-8ba0-f5aac0b3a9df"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-17 21:12:49.888007+00	2026-10-17 21:12:49.888007+00
baaedd99-7547-44ec-ac37-48b2625147e2	GUARDAR_CONSULTA	a52c5d98-119f-4f96-ab2a-6ca8a64142ea	{"creada": true, "consulta_id": "a52c5d98-119f-4f96-ab2a-6ca8a64142ea", "paciente_id": "491f0545-647e-459d-ba0c-d64ad07b5cb9"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-19 21:08:55.496391+00	2026-10-19 21:08:55.496391+00
f5bb4fd1-767d-4c62-b556-8bfeca7d25b8	CAMBIAR_ESTADO_VENTA	81c14cf6-2629-4a45-a74a-6382a3c7791d	{"estado": "Entregado", "venta_id": "81c14cf6-2629-4a45-a74a-6382a3c7791d"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-19 22:24:14.990374+00	2026-10-19 22:24:14.990374+00
3887a174-4e6a-4185-beaf-147b62d779ec	CAMBIAR_ESTADO_VENTA	62eae686-fa33-47dc-aee9-340f406e1567	{"estado": "Entregado", "venta_id": "62eae686-fa33-47dc-aee9-340f406e1567"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-19 23:27:51.852303+00	2026-10-19 23:27:51.852303+00
532d03f0-df02-4853-9a85-a6eb24d77172	EDITAR_VENTA	62eae686-fa33-47dc-aee9-340f406e1567	{"items": [{"codigo": null, "cantidad": 1, "inventory_id": 2}, {"codigo": null, "cantidad": 1, "inventory_id": 3}], "version": 1, "venta_id": "62eae686-fa33-47dc-aee9-340f406e1567"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 15:59:05.114459+00	2026-10-20 15:59:05.114459+00
6ea8c103-bf48-4e37-827b-52c136b97dbe	REGISTRAR_PAGO	ff7a3c6f-2d94-44b3-9202-0eaad58392ef	{"monto": 0.20, "pago_id": "66578c8f-c409-4d2a-b5e3-0cfa7ae85d5c", "pedido_id": "62eae686-fa33-47dc-aee9-340f406e1567", "ya_existia": false, "saldo_pendiente": 30.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 15:59:05.114459+00	2026-10-20 15:59:05.114459+00
04d93144-dc99-48ad-b633-867f9f0f9dc7	REGISTRAR_PAGO	92696159-6519-4ced-b6c2-adaa2a119609	{"monto": 30.00, "pago_id": "8c04a2d3-a85a-4d55-af41-be81bbd4c1df", "pedido_id": "62eae686-fa33-47dc-aee9-340f406e1567", "ya_existia": false, "saldo_pendiente": 0.00}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 15:59:23.131377+00	2026-10-20 15:59:23.131377+00
b6e89b78-8265-4b88-bfba-8b46d0b6aa07	GUARDAR_CONSULTA	97ac523e-91aa-4022-adaa-edca347dc0d5	{"creada": true, "consulta_id": "97ac523e-91aa-4022-adaa-edca347dc0d5", "paciente_id": "de4f73b9-331a-4d03-99e4-0e5ec2b0e03b"}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 17:59:11.375099+00	2026-10-20 17:59:11.375099+00
aa0d290d-a06b-4cea-a2ba-4efee09e49c4	UPSERT_PRECIO	-1792530657291	{"precio": {"id": 16, "notas": "{\\"v\\":1,\\"tratamientos\\":[\\"tratam_ar\\"],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Monofocal\\",\\"materialLente\\":\\"Plástico\\",\\"nota\\":\\"INCLUYE ESTUCHE\\"}", "material": "PLÁSTICO", "created_at": "2026-10-20T21:10:56.828887+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + ANTIREFLEJO", "sync_version": 0, "precio_sugerido": "35", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:10:56.828887+00:00"}, "servidor_id": 16}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:10:56.828887+00	2026-10-20 21:10:56.828887+00
0b2fd836-2b30-4ddc-b837-6a7a333664a9	UPSERT_PRECIO	-1792530799105	{"precio": {"id": 17, "notas": "{\\"v\\":1,\\"tratamientos\\":[\\"tratam_ar\\",\\"tratam_foto\\"],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Monofocal\\",\\"materialLente\\":\\"Plástico\\",\\"nota\\":\\"INCLUYE ESTUCHE\\"}", "material": "PLÁSTICO", "created_at": "2026-10-20T21:13:18.946711+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + FOTOSENSIBLE + ANTIREFLEJO", "sync_version": 0, "precio_sugerido": "60", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:13:18.946711+00:00"}, "servidor_id": 17}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:13:18.946711+00	2026-10-20 21:13:18.946711+00
cf72e3ce-34cc-45eb-95d5-2844298a182e	UPSERT_PRECIO	-1792530903321	{"precio": {"id": 18, "notas": "{\\"v\\":1,\\"tratamientos\\":[\\"tratam_ar\\",\\"tratam_azul\\"],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Monofocal\\",\\"materialLente\\":\\"Plástico\\",\\"nota\\":\\"INCLUYE ESTUCHE\\"}", "material": "PLÁSTICO", "created_at": "2026-10-20T21:15:03.237305+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + ANTIREFLEJO + FILTRO AZUL", "sync_version": 0, "precio_sugerido": "50", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:15:03.237305+00:00"}, "servidor_id": 18}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:15:03.237305+00	2026-10-20 21:15:03.237305+00
135594a3-b610-4c34-88e2-b4e630144c54	UPSERT_PRECIO	-1792530952457	{"precio": {"id": 19, "notas": "{\\"v\\":1,\\"tratamientos\\":[\\"tratam_ar\\",\\"tratam_azul\\",\\"tratam_foto\\"],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Monofocal\\",\\"materialLente\\":\\"Plástico\\",\\"nota\\":\\"INCLUYE ESTUCHE\\"}", "material": "PLÁSTICO", "created_at": "2026-10-20T21:15:52.067018+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + ANTIREFLEJO + FILTRO AZUL + FOTOCROMATICO", "sync_version": 0, "precio_sugerido": "80", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:15:52.067018+00:00"}, "servidor_id": 19}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:15:52.067018+00	2026-10-20 21:15:52.067018+00
ebde0472-85c0-4432-b387-642adf5bb2e1	UPSERT_PRECIO	-1792531031923	{"precio": {"id": 20, "notas": "{\\"v\\":1,\\"tratamientos\\":[],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Monofocal\\",\\"materialLente\\":\\"Plástico\\",\\"nota\\":\\"INCLUYE ESTUCHE\\"}", "material": "PLÁSTICO", "created_at": "2026-10-20T21:17:11.478428+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + LUNAS BLANCAS", "sync_version": 0, "precio_sugerido": "25", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:17:11.478428+00:00"}, "servidor_id": 20}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:17:11.478428+00	2026-10-20 21:17:11.478428+00
f84c78ae-385c-4178-865d-f73a0adcdf89	UPSERT_PRECIO	-1792531314562	{"precio": {"id": 21, "notas": "{\\"v\\":1,\\"tratamientos\\":[\\"tratam_ar\\"],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Monofocal\\",\\"materialLente\\":\\"Policarbonato\\",\\"nota\\":\\"INCLUYE ESTUCHE\\"}", "material": "POLICARBONATO", "created_at": "2026-10-20T21:21:54.268513+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + ANTIREFLEJO + POLICARBONATO", "sync_version": 0, "precio_sugerido": "35", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:21:54.268513+00:00"}, "servidor_id": 21}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:21:54.268513+00	2026-10-20 21:21:54.268513+00
fdb29f8e-6538-4313-a740-1ad99a3929db	UPSERT_PRECIO	-1792531363938	{"precio": {"id": 22, "notas": "{\\"v\\":1,\\"tratamientos\\":[\\"tratam_ar\\",\\"tratam_azul\\"],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Monofocal\\",\\"materialLente\\":\\"Policarbonato\\",\\"nota\\":\\"INCLUYE ESTUCHE\\"}", "material": "POLICARBONATO", "created_at": "2026-10-20T21:22:43.617328+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + ANTIREFLEJO + FILTRO AZUL", "sync_version": 0, "precio_sugerido": "55", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:22:43.617328+00:00"}, "servidor_id": 22}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:22:43.617328+00	2026-10-20 21:22:43.617328+00
8d002b17-4fd5-413b-a477-3a81167e8419	UPSERT_PRECIO	-1792531363938	{"precio": {"id": 23, "notas": "{\\"v\\":1,\\"tratamientos\\":[\\"tratam_ar\\",\\"tratam_azul\\"],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Monofocal\\",\\"materialLente\\":\\"Policarbonato\\",\\"nota\\":\\"INCLUYE ESTUCHE\\"}", "material": "POLICARBONATO", "created_at": "2026-10-20T21:23:37.376677+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + POLICARBONATO + ANTIREFLEJO + FILTRO AZUL", "sync_version": 0, "precio_sugerido": "55", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:23:37.376677+00:00"}, "servidor_id": 23}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:23:37.376677+00	2026-10-20 21:23:37.376677+00
d2a5d869-bdf3-45c3-88f4-6e9c7d1bc274	UPSERT_PRECIO	-1792531495152	{"precio": {"id": 24, "notas": "{\\"v\\":1,\\"tratamientos\\":[\\"tratam_ar\\"],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Monofocal\\",\\"materialLente\\":\\"Reducido (1.61/1.67)\\",\\"nota\\":\\"INCLUYE ESTUCHE\\"}", "material": "REDUCIDO (1.61/1.67)", "created_at": "2026-10-20T21:24:54.793737+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + ANTIREFLEJO + REDUCIDO 1.67", "sync_version": 0, "precio_sugerido": "90", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:24:54.793737+00:00"}, "servidor_id": 24}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:24:54.793737+00	2026-10-20 21:24:54.793737+00
88ca1052-5528-4853-ab68-d0f9c777dfb5	UPSERT_PRECIO	-1792531546899	{"precio": {"id": 25, "notas": "{\\"v\\":1,\\"tratamientos\\":[\\"tratam_ar\\",\\"tratam_foto\\"],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Monofocal\\",\\"materialLente\\":\\"Policarbonato\\",\\"nota\\":\\"INCLUYE ESTUCHE\\"}", "material": "POLICARBONATO", "created_at": "2026-10-20T21:25:46.500739+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + ANTIREFLEJO + FOTOSENSIBLE + POLICARBONATO", "sync_version": 0, "precio_sugerido": "90", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:25:46.500739+00:00"}, "servidor_id": 25}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:25:46.500739+00	2026-10-20 21:25:46.500739+00
5fe6bb2d-8e92-4375-b843-b095b8c3f7dc	UPSERT_PRECIO	-1792531718641	{"precio": {"id": 26, "notas": "{\\"v\\":1,\\"tratamientos\\":[],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Bifocal\\",\\"materialLente\\":\\"Plástico\\",\\"nota\\":\\"INCLUYE ESTUCHE\\"}", "material": "PLÁSTICO", "created_at": "2026-10-20T21:28:38.243086+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + LUNAS BLANCAS FLAT TOP", "sync_version": 0, "precio_sugerido": "45", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:28:38.243086+00:00"}, "servidor_id": 26}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:28:38.243086+00	2026-10-20 21:28:38.243086+00
326b634f-7028-4250-8a06-dc1b34319a93	UPSERT_PRECIO	-1792531794378	{"precio": {"id": 27, "notas": "{\\"v\\":1,\\"tratamientos\\":[\\"tratam_ar\\"],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Progresivo\\",\\"materialLente\\":\\"Plástico\\",\\"nota\\":\\"INCLUYE ESTUCHE\\"}", "material": "PLÁSTICO", "created_at": "2026-10-20T21:29:54.272601+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + ANTIREFLEJO + PROGRESIVO INNOVA", "sync_version": 0, "precio_sugerido": "125", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:29:54.272601+00:00"}, "servidor_id": 27}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:29:54.272601+00	2026-10-20 21:29:54.272601+00
17f72d78-ef56-4edc-83b9-61fc6731bca3	UPSERT_PRECIO	-1792532207233	{"precio": {"id": 28, "notas": "{\\"v\\":1,\\"tratamientos\\":[\\"tratam_ar\\",\\"tratam_foto\\"],\\"topeArmazon\\":null,\\"tipoLente\\":\\"Progresivo\\",\\"materialLente\\":\\"Plástico\\",\\"nota\\":\\"\\"}", "material": "PLÁSTICO", "created_at": "2026-10-20T21:36:46.811208+00:00", "tipo_lente": "COMBO", "tratamiento": "Combo", "rango_medida": "COMBO: ARMAZON + ANTIREFLEJO + FOTOSENSIBLE + PROGRESIVO INNOVA", "sync_version": 0, "precio_sugerido": "200", "costo_laboratorio": "0", "server_updated_at": "2026-10-20T21:36:46.811208+00:00"}, "servidor_id": 28}	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 21:36:46.811208+00	2026-10-20 21:36:46.811208+00
\.


--
-- Data for Name: pacientes_perfil; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pacientes_perfil (id, cedula, nombre, telefono, correo, fecha_nacimiento, antecedentes, created_at, alias, sync_version, server_updated_at) FROM stdin;
dec33667-b6a4-46df-b2e1-d8896c5de648	1723298095	ERICK JULIAN HERRERA LEON	0962630880	\N	2003-01-07	\N	2026-08-23 15:59:12.791083+00	\N	0	2026-09-25 04:01:08.563489+00
4e16173a-be7f-4bb6-9660-32694e37e8d3	1400732986	DAVID HASSAN CHIRIBOGA GARNICA	0992031166	davidhassan1999@gmail.com	1999-03-31	\N	2026-08-23 16:04:19.668607+00	\N	0	2026-09-25 04:01:08.563489+00
278c5259-5231-4294-b542-8ffdec86f5cd	0703090936	NELLY ESPERANZA CARREÑO CHAMBA	0984014105	carrenochamba@gmail.com	1973-05-10	\N	2026-08-18 21:27:36.353383+00	\N	0	2026-09-25 04:01:08.563489+00
b19da452-cf26-4828-9566-9ab8c9198168	1805181086	ANTHONY ALEXIS NARANJO TORRES	0959631456	alexisntorr@hotmail.com	1996-12-12	\N	2026-08-23 15:48:58.611979+00	\N	0	2026-09-25 04:01:08.563489+00
40ca4d68-081e-4adc-8296-05ccb75400b9	1721878377	ANDREA CAROLINA HERRERA LEON	0958781659	karitoherreraleon22@gmail.com	1998-12-22	\N	2026-08-23 14:03:24.297491+00	\N	0	2026-09-25 04:01:08.563489+00
69cee6ee-1ac4-4336-b8c8-bbb850603fca	0703519975	LUIS FERNANDO ROMAN ROMERO	0968385145	lromancito2575@gmail.com	1976-12-25	\N	2026-08-23 15:53:45.568976+00	\N	0	2026-09-25 04:01:08.563489+00
c2c8bdfe-5cd1-458a-96f3-ffa81f36f54f	1727761312	ANDY JOSUE TORRES AGUAISA	0992356495	josu03torres@gmail.com	1997-01-03	\N	2026-08-23 16:21:26.589018+00	\N	0	2026-09-25 04:01:08.563489+00
8b947ab9-c6fa-4c14-9826-14316af1a4c1	1727496844	DOMENICA PATRICIA BOLAÑOS ABARCA	0992580920	domenicaabarca@gmail.com	1999-12-13	\N	2026-08-23 23:52:48.029258+00	\N	0	2026-09-25 04:01:08.563489+00
f924d048-f1c5-45c9-b305-a1a6f2f7a1d1	1754238424	GENOVEVA LILIBETH CAIZA ALTAMIRANO	0999247702	lilibeth_veva_altamirano@hotmail.com	1996-08-06	\N	2026-08-24 00:56:00.602684+00	\N	0	2026-09-25 04:01:08.563489+00
963f4c4a-6b1f-4274-a93f-ede829241fe0	0750933509	DOMENICA VICTORIA SAMANIEGO CARREÑO	0939920669	domenicasamaniego01@gmail.com	2010-03-01	\N	2026-08-25 01:53:23.936839+00	\N	0	2026-09-25 04:01:08.563489+00
9e03646c-e81e-45dc-a063-756d916b5923	1725185217	GABRIELA LESLIE VELEZ PEREIRA	0984604321	leslie23velez@gmail.com	1990-03-23	\N	2026-08-25 02:51:58.943699+00	\N	0	2026-09-25 04:01:08.563489+00
b3f7acae-1649-4f8c-821e-eec1023857eb	1724475965	ALEJANDRO JURADO	0997217459	lejandx@hotmail.com	1995-05-28	\N	2026-09-01 03:04:18.827533+00	AMIGO DE NAPO UCE	0	2026-09-25 04:01:08.563489+00
cf63e290-ee4b-4ce6-9f8a-1d0b50fb1c35	1752516078	KLEVER MAURICIO TOAQUIZA LUTUAL	0983534745	toaquiza215@gmail.com	2001-03-26	SUFRIO UN GOLPE HACE AÑOS EN EL OD/PTERIGIO OD/RESEQUEDAD OCULAR	2026-10-07 23:14:17.978748+00	FARMACIA METRORED IÑAQUITO	0	2026-10-07 23:14:17.978748+00
12803b5c-bd33-4eb9-9321-c0a9c40c6441	0703094706	SONIA DEL ROCIO CARREÑO CHAMBA	0979966631	soniacarreno78@gmail.com	1978-12-03	\N	2026-08-27 18:12:42.422185+00	\N	0	2026-09-25 04:01:08.563489+00
2b28985c-4f9c-49bb-8719-e29dc7964434	0750933624	SONIA KATHERINE CRIOLLO CARREÑO	0990169780	katherinecriollo1226@gmail.com	1995-12-26	\N	2026-08-27 18:34:03.293524+00	\N	0	2026-09-25 04:01:08.563489+00
8b9320df-847a-45d8-8878-62dbe3cf8244	1726226465	JOHAN SEBASTIAN HERRERA TORRES	0963615618	\N	2000-06-04	\N	2026-08-31 20:20:04.258164+00	PRIMO DE CARITO HERRERA	0	2026-09-25 04:01:08.563489+00
3ca6aea7-d1dc-458b-a72b-cca1efb6c6c9	2100398516	BYRON HITLER ZHISPON ALVARADO	0984772154	\N	1997-02-05	\N	2026-08-31 19:42:09.739517+00	HACHE AMIGO UCE	0	2026-09-25 04:01:08.563489+00
a80654bf-78c8-46b0-b387-ad279a0a427f	1709518573	IRINA ALEXANDRA TROYA MOGOLLON	0984610218	irina.troya01@gmail.com	1965-11-30	\N	2026-08-25 04:06:10.063483+00	MAMA DE RICARDO/JOHA ZUMBA	0	2026-09-25 04:01:08.563489+00
8edb8aa0-c6da-49b4-94da-33b5e5eb5c7c	1726723271	GINA TAMARA JARRAMILLO PABON	0995804007	ginajhon05122017@gmail.com	1999-08-01	-TRABAJA DE CAJERA FRENTE A PANTALLAS\n- ANTES UTILIZABA LENTES	2026-08-22 19:05:29.582962+00	CAJERA METRORED QUISUR	0	2026-09-25 04:01:08.563489+00
de4f73b9-331a-4d03-99e4-0e5ec2b0e03b	1001550134	PATRICIA ANTONIETA PABON CALAHORRANO	0985796770	\N	1966-09-12	\N	2026-10-20 17:59:11.375099+00	ABUELITA DE LES METRORED QUISUR	0	2026-10-20 17:59:11.375099+00
b1d3f813-a5b7-4f0c-ba1a-ab382b117763	1715635908	MYRIAM MALENA AGUILAR ACHIG	0962652655	mmaguilar_dg@hotmail.com	1980-03-17	\N	2026-08-25 03:54:57.325354+00	JEFA DE CAJAS METRORED QUISUR	0	2026-09-25 04:01:08.563489+00
49cb62f0-8f71-4aaa-b1c4-e80a826344fa	1722129085	NATASHA CORINA QUINATOA GARCIA	0978760085	nquinatoa@metrored.med.ec	1995-04-07	*ARMAZON + AR/FA $60	2026-08-25 03:21:05.33007+00	CAJERA METRORED QUISUR	0	2026-09-25 04:01:08.563489+00
d19efb70-785b-43a3-829b-3f6c21bb5ae5	1710161306	SEGUNDO ELIECER CAIZA CAYO	0990301188	segundocaizacayo@gmail.com	1967-05-05	\N	2026-08-25 03:46:21.608782+00	PAPA DE GENO QUISUR	0	2026-09-25 04:01:08.563489+00
e6da2925-6edb-4cfd-8de9-f473f6a1974e	1101044863	DODA DEL CISNE ZARANGO	0996890210	\N	1950-05-16	\N	2026-08-25 02:46:46.420333+00	PACIENTE DE QUISUR	0	2026-09-25 04:01:08.563489+00
dbe0668b-320e-4c0e-9c11-beca2197e7e9	0940687460	JORDAN VICENTE SEGURA CACAO	0987316991	jordanseguracacao@hotmail.com	1996-06-17	\N	2026-08-25 03:31:49.026584+00	EX DE GENO QUISUR	0	2026-09-25 04:01:08.563489+00
456da94b-2aec-409e-b845-7f523ac4f9ee	9999999998	PRUEBA	\N	\N	\N	\N	2026-09-24 00:17:43.993674+00	\N	0	2026-09-25 04:01:08.563489+00
3c1c077d-46d6-4d5d-a0f0-4f300f118c89	1722888599	CHRISTOPHER ORLANDO PINTO MOROCHO	0987682310	\N	2001-02-20	RX EXTERNA\nOD:-0.75 -4.00 X 20\nOI: -0.75 -3.50 X 167	2026-08-31 20:00:32.575827+00	AMIGO UCE	0	2026-09-25 04:01:08.563489+00
a6d757c7-2ee8-498b-b080-c8b2bdc2e8ae	0750933533	SAMANTHA PAULET SAMANIEGO CARREÑO	0939777107	\N	2007-10-05	\N	2026-08-27 20:46:48.721148+00	\N	0	2026-09-25 04:01:08.563489+00
373094c9-08a2-4481-924c-0f93b4712f38	1750892695	DAYANARA CAMILA GORDON PADILLA	0984588661	jeka_d10@hotmail.com	2007-01-10	\N	2026-09-19 17:55:12.891259+00	HIJA DE JESSY METRORED QUISUR	0	2026-09-25 04:01:08.563489+00
bff1ff63-6659-4b10-9a54-cc7a1e2d37ce	1752011575	JULIETA DALILA GORDON PADILLA	0995208968	\N	2011-11-16	\N	2026-08-25 04:11:07.320418+00	HIJA DE JESSY METRORED QUISUR	0	2026-09-25 04:01:08.563489+00
d0001f6d-b895-4c17-ab39-71345b2c2f24	0705770741	DARWIN XAVIER CELI CARREÑO	0999911209	xavierceli@icloud.com	1998-05-29	DUEÑO	2026-08-18 21:00:04.40218+00	\N	0	2026-09-25 04:01:08.563489+00
425c31b4-c897-4096-8757-64afd690eb4f	9999999999	CONSUMIDOR FINAL	\N	\N	\N	\N	2026-09-23 15:35:03.803699+00	\N	0	2026-09-25 04:01:08.563489+00
\.


--
-- Data for Name: pagos; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pagos (id, idempotency_key, pedido_id, monto, metodo, referencia, comprobante_path, created_by, created_at, operacion_id, tipo) FROM stdin;
80428b85-e6c0-4807-93e4-49347cd81d21	7085d157-a66e-43c8-bc60-f6e7613ffa5a	7085d157-a66e-43c8-bc60-f6e7613ffa5a	10.00	Efectivo	\N	\N	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 17:30:53.163595+00	\N	COBRO
bfd85905-5acb-463e-8027-159f1b61e3b9	b035c5c6-908c-4af1-9f0d-218bb82b99bb	7085d157-a66e-43c8-bc60-f6e7613ffa5a	3.00	Efectivo	\N	\N	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 17:31:08.340925+00	\N	COBRO
98f41538-e67e-4009-bbdf-6dfd044feb3b	93df9101-4b42-4d8f-a574-f0df8dee5f7b	7085d157-a66e-43c8-bc60-f6e7613ffa5a	13.00	Efectivo	\N	\N	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-09-26 18:18:15.542745+00	\N	REEMBOLSO
71313617-5a90-4041-a9c0-a08a70a81da2	43d0d876-0ee8-4363-918b-5d4c627fe16b	43d0d876-0ee8-4363-918b-5d4c627fe16b	20.00	Transferencia	[2026-10-02] +$20.00 Transferencia	comprobante_1790980785301_icono192.png	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 22:39:54.034397+00	\N	COBRO
2f82402b-20af-4cd6-9c35-1db245da37de	c0854485-30ac-42ec-b3ab-df9f35f7422d	43d0d876-0ee8-4363-918b-5d4c627fe16b	20.00	Efectivo	\N	\N	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-02 22:41:29.018311+00	\N	REEMBOLSO
f37e305c-544e-49d3-97e7-f7d328530de6	63df3c7c-3b5e-47da-ade6-5ef78dd3942e	63df3c7c-3b5e-47da-ade6-5ef78dd3942e	60.00	Transferencia	[2026-10-04] +$60.00 Transferencia	comprobante_1791124461315_593987682310swhatsappnetACD9BE5568B39FAE994063A8E675A33A.jpg	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:34:26.101779+00	\N	COBRO
c4032316-7b85-4098-a74b-7f5eb44eb87c	4928c3f1-a8b5-413d-804e-6d6730df4854	4928c3f1-a8b5-413d-804e-6d6730df4854	45.00	Efectivo	[2026-10-06] +$45.00 Efectivo	\N	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 22:10:52.14243+00	\N	COBRO
1dfaa3c0-cb41-4b24-aa3e-f31f6bdad80c	17908293-8fe5-4cd2-9a9e-fd477ee5389f	4928c3f1-a8b5-413d-804e-6d6730df4854	45.00	Efectivo	\N	\N	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 23:03:50.151387+00	\N	REEMBOLSO
2786c1bf-3316-49c6-abea-019459aab957	c9ef5349-ea09-4c64-9aa5-2bb0a8b2fdf6	81c14cf6-2629-4a45-a74a-6382a3c7791d	25.00	Transferencia	\N	comprobante_1791651490087_593988503206swhatsappnetACAA63A6A070F331D7DE05EE9A642F2E.jpg	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-10 16:58:11.530416+00	\N	COBRO
e641f4f0-1dfa-4e8b-b8a5-1411bd98e203	ad0d5b21-a119-4a8c-b451-44657176dd94	81c14cf6-2629-4a45-a74a-6382a3c7791d	45.00	Transferencia	\N	comprobante_1792175383231_593988503206swhatsappnetA5305C1FB7BEC4671A495D4DE54B7A4D.jpg	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-16 18:29:45.331672+00	\N	COBRO
66578c8f-c409-4d2a-b5e3-0cfa7ae85d5c	fee45939-d417-4d77-8778-d346635c9fda	62eae686-fa33-47dc-aee9-340f406e1567	0.20	Efectivo	[27/8] +$30.00 Transferencia (Caja Rápida)\n[2026-10-20] +$0.20 Efectivo	https://uaflmzuklixcpqspiyqi.supabase.co/storage/v1/object/public/comprobantes_pagos/comprobante_1787852300779_WhatsAppImage20260826at18.28.39.jpeg	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 15:59:05.114459+00	\N	COBRO
8c04a2d3-a85a-4d55-af41-be81bbd4c1df	a56a4341-483d-44d8-bb1d-54e69733e571	62eae686-fa33-47dc-aee9-340f406e1567	30.00	Transferencia	\N	comprobante_1792511963150_593995804007swhatsappnet4A051E36E4D5EDA4AE8F.jpg	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-20 15:59:23.131377+00	\N	COBRO
\.


--
-- Data for Name: pedido_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pedido_items (id, pedido_id, inventario_id, cantidad, precio_unitario, codigo_snapshot, created_at) FROM stdin;
520	43d0d876-0ee8-4363-918b-5d4c627fe16b	4	1	3	\N	2026-10-02 22:39:54.034397+00
521	43d0d876-0ee8-4363-918b-5d4c627fe16b	6	1	25	DXCC101963	2026-10-02 22:39:54.034397+00
540	4928c3f1-a8b5-413d-804e-6d6730df4854	2	1	45	XC95826	2026-10-06 22:10:52.14243+00
543	81c14cf6-2629-4a45-a74a-6382a3c7791d	3	1	1	\N	2026-10-08 03:25:56.018305+00
544	81c14cf6-2629-4a45-a74a-6382a3c7791d	28	1	30	DXCC1234 	2026-10-08 03:25:56.018305+00
546	62eae686-fa33-47dc-aee9-340f406e1567	2	1	45	XC95826	2026-10-20 15:59:05.114459+00
547	62eae686-fa33-47dc-aee9-340f406e1567	3	1	1	\N	2026-10-20 15:59:05.114459+00
\.


--
-- Data for Name: pedidos_ventas; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pedidos_ventas (id, paciente_id, consulta_id, fecha, venta, abono, descuento, forma_pago, pago_nota, estado, notas, codigo_armazon, tipo_armazon, param_horizontal, param_puente, param_vertical, param_diagonal, tipo_lente, material_lente, material_nota, accesorio_id, tratam_ninguno, tratam_ar, tratam_ar_azul, tratam_azul, tratam_tinturado, tratam_tinturado_nota, tratam_foto, tratam_foto_nota, tratam_trans, tratam_trans_nota, costo_armazon_int, costo_lunas_int, costo_accesorio_int, costo_tratamientos_int, costo_varios_int, created_at, comprobante_url, sync_version, server_updated_at) FROM stdin;
7085d157-a66e-43c8-bc60-f6e7613ffa5a	425c31b4-c897-4096-8757-64afd690eb4f	f76ea360-9fc8-4325-a838-c454e19b7edb	2026-09-26	20	0.00	0	Efectivo	[26/09/2026] +10.00 Efectivo\n[26/09/2026] +3.00 Efectivo \n[2026-09-26] -13.00 Efectivo	Anulado	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NO	SI	NO	NO	NO	\N	NO	\N	NO	\N	\N	\N	\N	\N	\N	2026-09-26 17:30:53.163595+00		1	2026-09-26 17:31:08.340925+00
4928c3f1-a8b5-413d-804e-6d6730df4854	425c31b4-c897-4096-8757-64afd690eb4f	88262d44-f418-44ae-b1cb-6671322d1b0a	2026-10-06	45	0.00	0	Efectivo	[06/10/2026] +45.00 Efectivo [2026-10-06] +$45.00 Efectivo\n[2026-10-06] -45.00 Efectivo	Anulado	\N	XC95826	Completo	54	17	46	55	\N	\N	\N	\N	NO	NO	NO	NO	NO	\N	NO	\N	NO	\N	\N	\N	\N	\N	\N	2026-10-06 22:10:52.14243+00		0	2026-10-06 22:10:52.14243+00
62eae686-fa33-47dc-aee9-340f406e1567	8edb8aa0-c6da-49b4-94da-33b5e5eb5c7c	cc9b3bc6-5ccd-4c1f-8ec3-4a4386bd01b7	2026-08-22	86	60.20	30	Transferencia	[27/8] +$30.00 Transferencia (Caja Rápida)\n[20/10/2026] +0.20 Efectivo [27/8] +$30.00 Transferencia (Caja Rápida)\n[2026-10-20] +$0.20 Efectivo\n[20/10/2026] +30.00 Transferencia 	Entregado	\N	XC95826	Completo	54	17	46	55	Monofocal	Plástico	\N	3	NO	SI	NO	NO	NO	\N	NO	\N	NO	\N	12	7.5	\N	\N	\N	2026-08-22 19:05:29.582962+00	comprobante_1792511963150_593995804007swhatsappnet4A051E36E4D5EDA4AE8F.jpg	1	2026-10-20 15:59:05.114459+00
81c14cf6-2629-4a45-a74a-6382a3c7791d	cf63e290-ee4b-4ce6-9f8a-1d0b50fb1c35	31aca2e2-4ff7-458f-ad34-e2ca10f9d0f1	2026-10-07	100	70.00	30	Transferencia	[10/10/2026] +25.00 Transferencia\n[16/10/2026] +45.00 Transferencia 	Entregado	\N	DXCC1234 	Al Aire	55	20	35	56	Monofocal	Policarbonato	\N	3	NO	SI	NO	NO	NO	\N	NO	\N	NO	\N	\N	\N	\N	\N	\N	2026-10-08 03:25:56.018305+00	comprobante_1792175383231_593988503206swhatsappnetA5305C1FB7BEC4671A495D4DE54B7A4D.jpg	0	2026-10-08 03:25:56.018305+00
63df3c7c-3b5e-47da-ade6-5ef78dd3942e	3c1c077d-46d6-4d5d-a0f0-4f300f118c89	3ce9ca5b-56ac-4e74-9c9f-0a94a9aabd13	2026-10-04	60	60.00	0	Transferencia	[04/10/2026] +60.00 Transferencia [2026-10-04] +$60.00 Transferencia	Entregado	\N	\N	\N	\N	\N	\N	\N	\N	Policarbonato	\N	\N	NO	SI	NO	NO	NO	\N	NO	\N	NO	\N	\N	8.97	\N	\N	1.60	2026-10-04 14:34:26.101779+00	comprobante_1791124461315_593987682310swhatsappnetACD9BE5568B39FAE994063A8E675A33A.jpg	0	2026-10-04 14:34:26.101779+00
43d0d876-0ee8-4363-918b-5d4c627fe16b	d0001f6d-b895-4c17-ab39-71345b2c2f24	ade955e0-6559-46b0-901f-267e0f506bd3	2026-10-02	68	0.00	0	Transferencia	[02/10/2026] +20.00 Transferencia [2026-10-02] +$20.00 Transferencia\n[2026-10-02] -20.00 Efectivo	Anulado	\N	DXCC101963	Completo	\N	\N	\N	\N	Monofocal	Plástico	\N	4	NO	SI	NO	NO	NO	\N	NO	\N	NO	\N	\N	\N	\N	\N	\N	2026-10-02 22:39:54.034397+00	comprobante_1790980785301_icono192.png	0	2026-10-02 22:39:54.034397+00
\.


--
-- Data for Name: perfiles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.perfiles (user_id, rol, creado_en, actualizado_en) FROM stdin;
ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	admin	2026-10-17 20:13:31.194946+00	2026-10-17 20:13:31.194946+00
\.


--
-- Data for Name: registros_eliminados; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.registros_eliminados (id, paciente_ids, consulta_ids, pedido_ids, consultas, ventas, cobros, eliminado_por, eliminado_en) FROM stdin;
cfb3cad0-51d7-455c-abb8-b8f035309e93	{272880f8-becf-4061-9128-32952ffce92f}	{5e1a6b10-9e9e-4f8f-9c1d-9a07b430b188,ffdd5b19-dc27-46b9-9fa8-78c60ff27d1a}	{}	2	0	0	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 03:39:53.068231+00
0303bc0d-d822-4fc9-849d-a4936b4bac6c	{12db56da-e9e6-4119-b76a-456954eb3750}	{d5082fbb-a49d-4276-bc9b-9a2b77e2009b,0cff833d-a6e8-460e-827e-d11978bb7065}	{538e9847-1016-41b8-80fe-7ed9bd3ece1a}	2	1	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 03:43:38.938132+00
d61215f2-5f55-4795-9454-8fd4410d875f	{9d6b6aed-d20c-4e60-8f39-8501a064f191}	{239ba530-486a-4823-8dd3-82467dce3065}	{}	1	0	0	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 13:39:40.526536+00
9b369823-5a6e-45e4-9c99-3cdf69c490a2	{57e635ff-c985-4e17-b1c3-b0fcb096035a}	{eb7e59f8-5b1a-4086-884e-62c8b7e06ec9}	{}	1	0	0	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:02:21.359698+00
af41edb1-6559-45b7-891b-e0b77f03464a	{b087f112-1782-472d-9921-f7ae7c66fd58}	{f1401ff9-5c3a-448a-bbd1-ad8629b8a340}	{17b668b0-fd98-4045-8f98-70d8600848dc}	1	1	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:08:59.224909+00
907104f6-0f2e-4099-9efc-66e876a8a69a	{abb6b620-2c2a-45c2-86c9-2a3242c94cc7}	{5b159aa5-24a7-4c78-b49c-29b51eeff29f}	{}	1	0	0	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-04 14:11:16.071893+00
f3b42dcc-e48b-415d-8a09-d8487d48fde3	{a692cab2-aaaa-456b-ac84-aa091199496d}	{0dd3c00d-ce97-4efd-be6e-ae892ef9e552}	{2754dfe3-6ea9-4e63-95b4-5e2d65a0e873}	1	1	1	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-05 14:38:30.373014+00
615341b6-70e0-4c5b-a1ec-ad7dda3c3928	{735a3603-c7f5-4d61-82d0-d62124197fbf}	{7436eeee-88c1-4585-b788-79f3b196d9bc,fa39f268-70fc-4919-a432-aa742f44aa8a}	{6c6d870b-f35f-4ce5-a987-360917e6558c}	2	1	3	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 05:00:26.920194+00
40c3523e-9618-41be-a1a7-eabe6fd52a78	{380b4ef3-aa60-41ab-88a0-1ab27cfbfd96}	{3875cde6-84e9-4ae3-b219-3f08f17d5f76,2b2368ea-0d53-49f4-8d62-52e2336a5edf,da9f330c-c89c-49e3-b08e-37ff506fb3ed}	{f7823284-3d70-4901-9d22-104a8aee010e,073aead6-11c1-4fe1-8b8a-5ee5efc1bc52}	3	2	5	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 19:11:19.877295+00
7cbb5024-e9e6-4c18-8d3d-7f0617401685	{fa95e96b-eadf-4a37-832e-0251c96a8921}	{ceda1f8e-adfd-419c-abb0-6a40f62a36b1}	{1bc119a2-1001-4472-b67a-9e2a3a9785ce,3111866d-9134-4570-8069-adc72b2935ea}	1	2	5	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 20:03:59.655614+00
4d038e31-9f23-4589-bbca-f302bdd67353	{7e7c497d-2ccb-446f-8b37-ecb0e04f502e}	{6c5e8d5c-8166-407c-bfeb-28343bb92bca}	{dac6988f-0875-4373-9eec-8f8f231d3136}	1	1	2	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 23:14:21.049525+00
9c493d04-77e0-404d-b9bf-146d19861614	{e85d8ef1-db65-48d0-8927-8b683b0a501f}	{3f129560-f2cb-41c0-a058-b8d274722bba,0bf31771-2941-459f-923f-959aa4342d70,968f8137-1712-41bf-b8ee-e8b3182c1bea}	{962518ce-f703-4c2a-be33-6c426d0fd731,02f0bae7-cb9e-4036-90d7-67776bfa17ea}	3	2	5	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-06 23:27:09.278857+00
99d5d6bf-fc76-4abf-ab17-8ad91cc90455	{b8c802de-8829-4357-94cd-2e853b54dc45}	{6eddfc82-8337-4660-a47e-746020d90d4c}	{}	1	0	0	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-17 20:50:02.152934+00
7f95475e-8c67-4c47-b3fb-c5eb7cfc8251	{58527d51-432a-4270-94bf-d455a63301bd}	{0d631322-f275-406e-999f-0c47f9f9da38}	{a935ba06-e189-4b63-9c1f-c6a783434f50}	1	1	2	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-17 21:01:12.827595+00
6c7f3ba7-0b17-4c4f-8a40-34b11c23d0fc	{07599973-81b1-4049-8ba0-f5aac0b3a9df}	{807fde1d-6acb-4878-97e7-db28ac7a545c}	{}	1	0	0	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-17 21:13:07.472301+00
0219285f-a112-44ad-a8f7-7a543aba9c1b	{491f0545-647e-459d-ba0c-d64ad07b5cb9}	{a52c5d98-119f-4f96-ab2a-6ca8a64142ea}	{}	1	0	0	ee09bc3f-e9b9-4683-9c51-da6d21ba8b62	2026-10-19 21:10:33.504935+00
\.


--
-- Name: inventario_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.inventario_id_seq', 28, true);


--
-- Name: inventario_movimientos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.inventario_movimientos_id_seq', 616, true);


--
-- Name: lista_precios_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.lista_precios_id_seq', 28, true);


--
-- Name: pedido_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.pedido_items_id_seq', 547, true);


--
-- Name: consultas_clinicas consultas_clinicas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultas_clinicas
    ADD CONSTRAINT consultas_clinicas_pkey PRIMARY KEY (id);


--
-- Name: consultas_clinicas_revisiones consultas_clinicas_revisiones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultas_clinicas_revisiones
    ADD CONSTRAINT consultas_clinicas_revisiones_pkey PRIMARY KEY (id);


--
-- Name: inventario_movimientos inventario_movimientos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_movimientos
    ADD CONSTRAINT inventario_movimientos_pkey PRIMARY KEY (id);


--
-- Name: inventario inventario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario
    ADD CONSTRAINT inventario_pkey PRIMARY KEY (id);


--
-- Name: lista_precios lista_precios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_precios
    ADD CONSTRAINT lista_precios_pkey PRIMARY KEY (id);


--
-- Name: operaciones_aplicadas operaciones_aplicadas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operaciones_aplicadas
    ADD CONSTRAINT operaciones_aplicadas_pkey PRIMARY KEY (id);


--
-- Name: pacientes_perfil pacientes_perfil_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pacientes_perfil
    ADD CONSTRAINT pacientes_perfil_pkey PRIMARY KEY (id);


--
-- Name: pagos pagos_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: pagos pagos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_pkey PRIMARY KEY (id);


--
-- Name: pedido_items pedido_items_pedido_inventario_unico; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_items
    ADD CONSTRAINT pedido_items_pedido_inventario_unico UNIQUE (pedido_id, inventario_id);


--
-- Name: pedido_items pedido_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_items
    ADD CONSTRAINT pedido_items_pkey PRIMARY KEY (id);


--
-- Name: pedidos_ventas pedidos_ventas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_ventas
    ADD CONSTRAINT pedidos_ventas_pkey PRIMARY KEY (id);


--
-- Name: perfiles perfiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.perfiles
    ADD CONSTRAINT perfiles_pkey PRIMARY KEY (user_id);


--
-- Name: registros_eliminados registros_eliminados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_eliminados
    ADD CONSTRAINT registros_eliminados_pkey PRIMARY KEY (id);


--
-- Name: consultas_clinicas_paciente_fecha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultas_clinicas_paciente_fecha_idx ON public.consultas_clinicas USING btree (paciente_id, fecha DESC, id DESC);


--
-- Name: consultas_revisiones_consulta_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultas_revisiones_consulta_idx ON public.consultas_clinicas_revisiones USING btree (consulta_id, version DESC);


--
-- Name: inventario_client_ref_unico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventario_client_ref_unico ON public.inventario USING btree (client_ref) WHERE (client_ref IS NOT NULL);


--
-- Name: inventario_movimientos_operacion_unico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventario_movimientos_operacion_unico ON public.inventario_movimientos USING btree (operacion_id, tipo, inventario_id) WHERE (operacion_id IS NOT NULL);


--
-- Name: operaciones_aplicadas_entidad_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operaciones_aplicadas_entidad_idx ON public.operaciones_aplicadas USING btree (entidad_id, creada_en DESC);


--
-- Name: pagos_pedido_fecha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pagos_pedido_fecha_idx ON public.pagos USING btree (pedido_id, created_at DESC);


--
-- Name: pagos_pedido_tipo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pagos_pedido_tipo_idx ON public.pagos USING btree (pedido_id, tipo);


--
-- Name: pedidos_ventas_paciente_fecha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pedidos_ventas_paciente_fecha_idx ON public.pedidos_ventas USING btree (paciente_id, fecha DESC, id DESC);


--
-- Name: unico_cedula; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unico_cedula ON public.pacientes_perfil USING btree (cedula);


--
-- Name: unico_codigo_inventario; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unico_codigo_inventario ON public.inventario USING btree (upper(TRIM(BOTH FROM codigo))) WHERE ((codigo IS NOT NULL) AND (codigo <> ''::text));


--
-- Name: inventario_movimientos inventario_movimientos_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inventario_movimientos_append_only BEFORE DELETE OR UPDATE ON public.inventario_movimientos FOR EACH ROW EXECUTE FUNCTION public.impedir_mutacion_append_only();


--
-- Name: pagos pagos_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pagos_append_only BEFORE DELETE OR UPDATE ON public.pagos FOR EACH ROW EXECUTE FUNCTION public.impedir_mutacion_append_only();


--
-- Name: consultas_clinicas rellenar_campos_consultas; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER rellenar_campos_consultas BEFORE INSERT ON public.consultas_clinicas FOR EACH ROW EXECUTE FUNCTION public.rellenar_campos_sistema();


--
-- Name: pedidos_ventas rellenar_campos_pedidos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER rellenar_campos_pedidos BEFORE INSERT ON public.pedidos_ventas FOR EACH ROW EXECUTE FUNCTION public.rellenar_campos_sistema();


--
-- Name: pedidos_ventas trg_bloquear_escritura_directa_pedidos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bloquear_escritura_directa_pedidos BEFORE INSERT OR DELETE OR UPDATE ON public.pedidos_ventas FOR EACH ROW EXECUTE FUNCTION public.bloquear_escritura_directa_pedidos();


--
-- Name: consultas_clinicas trg_guardar_revision_consulta; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guardar_revision_consulta AFTER UPDATE ON public.consultas_clinicas FOR EACH ROW EXECUTE FUNCTION public.guardar_revision_consulta();


--
-- Name: consultas_clinicas consultas_clinicas_paciente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultas_clinicas
    ADD CONSTRAINT consultas_clinicas_paciente_id_fkey FOREIGN KEY (paciente_id) REFERENCES public.pacientes_perfil(id) ON DELETE CASCADE;


--
-- Name: consultas_clinicas_revisiones consultas_clinicas_revisiones_consulta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultas_clinicas_revisiones
    ADD CONSTRAINT consultas_clinicas_revisiones_consulta_id_fkey FOREIGN KEY (consulta_id) REFERENCES public.consultas_clinicas(id) ON DELETE RESTRICT;


--
-- Name: inventario_movimientos inventario_movimientos_inventario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_movimientos
    ADD CONSTRAINT inventario_movimientos_inventario_id_fkey FOREIGN KEY (inventario_id) REFERENCES public.inventario(id) ON DELETE RESTRICT;


--
-- Name: inventario_movimientos inventario_movimientos_pedido_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_movimientos
    ADD CONSTRAINT inventario_movimientos_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.pedidos_ventas(id) ON DELETE RESTRICT;


--
-- Name: pagos pagos_pedido_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.pedidos_ventas(id) ON DELETE RESTRICT;


--
-- Name: pedido_items pedido_items_inventario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_items
    ADD CONSTRAINT pedido_items_inventario_id_fkey FOREIGN KEY (inventario_id) REFERENCES public.inventario(id) ON DELETE RESTRICT;


--
-- Name: pedido_items pedido_items_pedido_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_items
    ADD CONSTRAINT pedido_items_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.pedidos_ventas(id) ON DELETE RESTRICT;


--
-- Name: pedidos_ventas pedidos_ventas_consulta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_ventas
    ADD CONSTRAINT pedidos_ventas_consulta_id_fkey FOREIGN KEY (consulta_id) REFERENCES public.consultas_clinicas(id) ON DELETE RESTRICT;


--
-- Name: pedidos_ventas pedidos_ventas_paciente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_ventas
    ADD CONSTRAINT pedidos_ventas_paciente_id_fkey FOREIGN KEY (paciente_id) REFERENCES public.pacientes_perfil(id) ON DELETE RESTRICT;


--
-- Name: perfiles perfiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.perfiles
    ADD CONSTRAINT perfiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: consultas_clinicas Solo admin consultas_clinicas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Solo admin consultas_clinicas" ON public.consultas_clinicas TO authenticated USING (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text)) WITH CHECK (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text));


--
-- Name: consultas_clinicas_revisiones Solo admin consultas_clinicas_revisiones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Solo admin consultas_clinicas_revisiones" ON public.consultas_clinicas_revisiones TO authenticated USING (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text)) WITH CHECK (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text));


--
-- Name: inventario Solo admin inventario; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Solo admin inventario" ON public.inventario TO authenticated USING (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text)) WITH CHECK (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text));


--
-- Name: inventario_movimientos Solo admin inventario_movimientos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Solo admin inventario_movimientos" ON public.inventario_movimientos TO authenticated USING (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text)) WITH CHECK (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text));


--
-- Name: lista_precios Solo admin lista_precios; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Solo admin lista_precios" ON public.lista_precios TO authenticated USING (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text)) WITH CHECK (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text));


--
-- Name: operaciones_aplicadas Solo admin operaciones_aplicadas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Solo admin operaciones_aplicadas" ON public.operaciones_aplicadas TO authenticated USING (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text)) WITH CHECK (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text));


--
-- Name: pacientes_perfil Solo admin pacientes_perfil; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Solo admin pacientes_perfil" ON public.pacientes_perfil TO authenticated USING (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text)) WITH CHECK (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text));


--
-- Name: pagos Solo admin pagos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Solo admin pagos" ON public.pagos TO authenticated USING (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text)) WITH CHECK (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text));


--
-- Name: pedido_items Solo admin pedido_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Solo admin pedido_items" ON public.pedido_items TO authenticated USING (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text)) WITH CHECK (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text));


--
-- Name: pedidos_ventas Solo admin pedidos_ventas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Solo admin pedidos_ventas" ON public.pedidos_ventas TO authenticated USING (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text)) WITH CHECK (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text));


--
-- Name: registros_eliminados Solo admin registros_eliminados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Solo admin registros_eliminados" ON public.registros_eliminados TO authenticated USING (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text)) WITH CHECK (((auth.jwt() ->> 'email'::text) = 'xavierceli@icloud.com'::text));


--
-- Name: consultas_clinicas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultas_clinicas ENABLE ROW LEVEL SECURITY;

--
-- Name: consultas_clinicas_revisiones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultas_clinicas_revisiones ENABLE ROW LEVEL SECURITY;

--
-- Name: inventario; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventario ENABLE ROW LEVEL SECURITY;

--
-- Name: inventario_movimientos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventario_movimientos ENABLE ROW LEVEL SECURITY;

--
-- Name: lista_precios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lista_precios ENABLE ROW LEVEL SECURITY;

--
-- Name: operaciones_aplicadas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operaciones_aplicadas ENABLE ROW LEVEL SECURITY;

--
-- Name: pacientes_perfil; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pacientes_perfil ENABLE ROW LEVEL SECURITY;

--
-- Name: pagos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

--
-- Name: pedido_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pedido_items ENABLE ROW LEVEL SECURITY;

--
-- Name: pedidos_ventas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pedidos_ventas ENABLE ROW LEVEL SECURITY;

--
-- Name: perfiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

--
-- Name: perfiles perfiles_lectura; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY perfiles_lectura ON public.perfiles FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.es_admin()));


--
-- Name: registros_eliminados; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.registros_eliminados ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION _p0_numero(p_valor text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._p0_numero(p_valor text) FROM PUBLIC;
GRANT ALL ON FUNCTION public._p0_numero(p_valor text) TO authenticated;
GRANT ALL ON FUNCTION public._p0_numero(p_valor text) TO service_role;


--
-- Name: FUNCTION _p0_operacion_sobre_eliminado(p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._p0_operacion_sobre_eliminado(p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public._p0_operacion_sobre_eliminado(p_payload jsonb) TO service_role;
GRANT ALL ON FUNCTION public._p0_operacion_sobre_eliminado(p_payload jsonb) TO authenticated;


--
-- Name: FUNCTION actualizar_estado_venta(p_venta_id uuid, p_estado text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.actualizar_estado_venta(p_venta_id uuid, p_estado text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.actualizar_estado_venta(p_venta_id uuid, p_estado text) TO authenticated;
GRANT ALL ON FUNCTION public.actualizar_estado_venta(p_venta_id uuid, p_estado text) TO service_role;


--
-- Name: FUNCTION anular_venta(p_venta_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.anular_venta(p_venta_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.anular_venta(p_venta_id uuid) TO service_role;


--
-- Name: FUNCTION aplicar_operaciones(p_operaciones jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.aplicar_operaciones(p_operaciones jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.aplicar_operaciones(p_operaciones jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.aplicar_operaciones(p_operaciones jsonb) TO service_role;


--
-- Name: FUNCTION archivar_consulta(p_consulta_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.archivar_consulta(p_consulta_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.archivar_consulta(p_consulta_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.archivar_consulta(p_consulta_id uuid) TO service_role;


--
-- Name: FUNCTION bloquear_escritura_directa_pedidos(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.bloquear_escritura_directa_pedidos() FROM PUBLIC;
GRANT ALL ON FUNCTION public.bloquear_escritura_directa_pedidos() TO authenticated;
GRANT ALL ON FUNCTION public.bloquear_escritura_directa_pedidos() TO service_role;


--
-- Name: FUNCTION contar_registros_paciente(p_cedula text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contar_registros_paciente(p_cedula text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.contar_registros_paciente(p_cedula text) TO authenticated;
GRANT ALL ON FUNCTION public.contar_registros_paciente(p_cedula text) TO service_role;


--
-- Name: FUNCTION crear_perfil_nuevo_usuario(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.crear_perfil_nuevo_usuario() TO anon;
GRANT ALL ON FUNCTION public.crear_perfil_nuevo_usuario() TO authenticated;
GRANT ALL ON FUNCTION public.crear_perfil_nuevo_usuario() TO service_role;


--
-- Name: FUNCTION crear_venta(p_venta_id uuid, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.crear_venta(p_venta_id uuid, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.crear_venta(p_venta_id uuid, p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.crear_venta(p_venta_id uuid, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION deudas_pacientes(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.deudas_pacientes() FROM PUBLIC;
GRANT ALL ON FUNCTION public.deudas_pacientes() TO authenticated;
GRANT ALL ON FUNCTION public.deudas_pacientes() TO service_role;


--
-- Name: FUNCTION editar_venta(p_venta_id uuid, p_operacion_id uuid, p_base_version bigint, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.editar_venta(p_venta_id uuid, p_operacion_id uuid, p_base_version bigint, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.editar_venta(p_venta_id uuid, p_operacion_id uuid, p_base_version bigint, p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.editar_venta(p_venta_id uuid, p_operacion_id uuid, p_base_version bigint, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION eliminar_inventario(p_inventario_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.eliminar_inventario(p_inventario_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.eliminar_inventario(p_inventario_id bigint) TO service_role;


--
-- Name: FUNCTION eliminar_paciente_definitivo(p_cedula text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.eliminar_paciente_definitivo(p_cedula text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.eliminar_paciente_definitivo(p_cedula text) TO authenticated;
GRANT ALL ON FUNCTION public.eliminar_paciente_definitivo(p_cedula text) TO service_role;


--
-- Name: FUNCTION eliminar_paciente_definitivo_impl(p_cedula text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.eliminar_paciente_definitivo_impl(p_cedula text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.eliminar_paciente_definitivo_impl(p_cedula text) TO service_role;


--
-- Name: FUNCTION eliminar_precio(p_precio_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.eliminar_precio(p_precio_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.eliminar_precio(p_precio_id bigint) TO service_role;


--
-- Name: FUNCTION es_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.es_admin() TO anon;
GRANT ALL ON FUNCTION public.es_admin() TO authenticated;
GRANT ALL ON FUNCTION public.es_admin() TO service_role;


--
-- Name: FUNCTION guardar_consulta_clinica(p_consulta_id uuid, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guardar_consulta_clinica(p_consulta_id uuid, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guardar_consulta_clinica(p_consulta_id uuid, p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.guardar_consulta_clinica(p_consulta_id uuid, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION guardar_consulta_clinica_v2(p_consulta_id uuid, p_payload jsonb, p_base_version bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guardar_consulta_clinica_v2(p_consulta_id uuid, p_payload jsonb, p_base_version bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guardar_consulta_clinica_v2(p_consulta_id uuid, p_payload jsonb, p_base_version bigint) TO authenticated;
GRANT ALL ON FUNCTION public.guardar_consulta_clinica_v2(p_consulta_id uuid, p_payload jsonb, p_base_version bigint) TO service_role;


--
-- Name: FUNCTION guardar_revision_consulta(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guardar_revision_consulta() FROM PUBLIC;
GRANT ALL ON FUNCTION public.guardar_revision_consulta() TO service_role;
GRANT ALL ON FUNCTION public.guardar_revision_consulta() TO authenticated;


--
-- Name: FUNCTION impedir_mutacion_append_only(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.impedir_mutacion_append_only() FROM PUBLIC;
GRANT ALL ON FUNCTION public.impedir_mutacion_append_only() TO authenticated;
GRANT ALL ON FUNCTION public.impedir_mutacion_append_only() TO service_role;


--
-- Name: FUNCTION limitar_usuarios_vermas(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.limitar_usuarios_vermas() TO anon;
GRANT ALL ON FUNCTION public.limitar_usuarios_vermas() TO authenticated;
GRANT ALL ON FUNCTION public.limitar_usuarios_vermas() TO service_role;


--
-- Name: FUNCTION mi_rol(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mi_rol() FROM PUBLIC;
GRANT ALL ON FUNCTION public.mi_rol() TO authenticated;
GRANT ALL ON FUNCTION public.mi_rol() TO service_role;


--
-- Name: FUNCTION reembolsar_pago(p_pedido_id uuid, p_idempotency_key uuid, p_monto numeric, p_metodo text, p_referencia text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reembolsar_pago(p_pedido_id uuid, p_idempotency_key uuid, p_monto numeric, p_metodo text, p_referencia text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reembolsar_pago(p_pedido_id uuid, p_idempotency_key uuid, p_monto numeric, p_metodo text, p_referencia text) TO service_role;


--
-- Name: FUNCTION registrar_pago(p_pedido_id uuid, p_idempotency_key uuid, p_monto numeric, p_metodo text, p_referencia text, p_comprobante_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_pago(p_pedido_id uuid, p_idempotency_key uuid, p_monto numeric, p_metodo text, p_referencia text, p_comprobante_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_pago(p_pedido_id uuid, p_idempotency_key uuid, p_monto numeric, p_metodo text, p_referencia text, p_comprobante_path text) TO authenticated;
GRANT ALL ON FUNCTION public.registrar_pago(p_pedido_id uuid, p_idempotency_key uuid, p_monto numeric, p_metodo text, p_referencia text, p_comprobante_path text) TO service_role;


--
-- Name: FUNCTION rellenar_campos_sistema(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rellenar_campos_sistema() TO authenticated;
GRANT ALL ON FUNCTION public.rellenar_campos_sistema() TO service_role;


--
-- Name: FUNCTION revisiones_consulta(p_consulta_id uuid, p_limite integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.revisiones_consulta(p_consulta_id uuid, p_limite integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revisiones_consulta(p_consulta_id uuid, p_limite integer) TO authenticated;
GRANT ALL ON FUNCTION public.revisiones_consulta(p_consulta_id uuid, p_limite integer) TO service_role;


--
-- Name: FUNCTION stats_negocio(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.stats_negocio() FROM PUBLIC;
GRANT ALL ON FUNCTION public.stats_negocio() TO authenticated;
GRANT ALL ON FUNCTION public.stats_negocio() TO service_role;


--
-- Name: FUNCTION upsert_inventario(p_inventario_id bigint, p_datos jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.upsert_inventario(p_inventario_id bigint, p_datos jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_inventario(p_inventario_id bigint, p_datos jsonb) TO service_role;


--
-- Name: FUNCTION upsert_precio(p_precio_id bigint, p_datos jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.upsert_precio(p_precio_id bigint, p_datos jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_precio(p_precio_id bigint, p_datos jsonb) TO service_role;


--
-- Name: TABLE consultas_clinicas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultas_clinicas TO service_role;
GRANT ALL ON TABLE public.consultas_clinicas TO authenticated;


--
-- Name: TABLE consultas_clinicas_revisiones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultas_clinicas_revisiones TO service_role;
GRANT ALL ON TABLE public.consultas_clinicas_revisiones TO authenticated;


--
-- Name: TABLE inventario; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inventario TO service_role;
GRANT ALL ON TABLE public.inventario TO authenticated;


--
-- Name: SEQUENCE inventario_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.inventario_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.inventario_id_seq TO service_role;


--
-- Name: TABLE inventario_movimientos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inventario_movimientos TO service_role;
GRANT ALL ON TABLE public.inventario_movimientos TO authenticated;


--
-- Name: SEQUENCE inventario_movimientos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.inventario_movimientos_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.inventario_movimientos_id_seq TO service_role;


--
-- Name: TABLE lista_precios; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lista_precios TO service_role;
GRANT ALL ON TABLE public.lista_precios TO authenticated;


--
-- Name: SEQUENCE lista_precios_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.lista_precios_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.lista_precios_id_seq TO service_role;


--
-- Name: TABLE operaciones_aplicadas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.operaciones_aplicadas TO service_role;
GRANT ALL ON TABLE public.operaciones_aplicadas TO authenticated;


--
-- Name: TABLE pacientes_perfil; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pacientes_perfil TO service_role;
GRANT ALL ON TABLE public.pacientes_perfil TO authenticated;


--
-- Name: TABLE pacientes_archivados; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pacientes_archivados TO service_role;
GRANT SELECT ON TABLE public.pacientes_archivados TO authenticated;


--
-- Name: TABLE pagos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pagos TO service_role;
GRANT ALL ON TABLE public.pagos TO authenticated;


--
-- Name: TABLE pedido_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pedido_items TO service_role;
GRANT ALL ON TABLE public.pedido_items TO authenticated;


--
-- Name: SEQUENCE pedido_items_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.pedido_items_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.pedido_items_id_seq TO service_role;


--
-- Name: TABLE pedidos_ventas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pedidos_ventas TO service_role;
GRANT ALL ON TABLE public.pedidos_ventas TO authenticated;


--
-- Name: TABLE perfiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.perfiles TO authenticated;
GRANT ALL ON TABLE public.perfiles TO service_role;


--
-- Name: TABLE registros_eliminados; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.registros_eliminados TO service_role;
GRANT ALL ON TABLE public.registros_eliminados TO authenticated;


--
-- Name: TABLE vista_pacientes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vista_pacientes TO service_role;
GRANT ALL ON TABLE public.vista_pacientes TO authenticated;


--
-- Name: TABLE vista_pacientes_unicos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vista_pacientes_unicos TO service_role;
GRANT ALL ON TABLE public.vista_pacientes_unicos TO authenticated;


--
-- Name: TABLE vista_pacientes_versionada; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vista_pacientes_versionada TO authenticated;
GRANT ALL ON TABLE public.vista_pacientes_versionada TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict Tjw3jvazDr588IoFhxY76vypegrGqrh6F0jYm2ifggalPy4LnohmOLMfb6oAHCV


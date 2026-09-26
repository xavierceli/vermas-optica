-- ===========================================================================
-- 202609240005_despachador_reembolso.sql  (version sin lineas en blanco)
-- IMPORTANTE: el SQL Editor de Supabase parte el script por lineas en blanco.
-- Este archivo NO tiene ninguna linea vacia y es idempotente.
-- ===========================================================================
begin;
-- Cuerpo de aplicar_operaciones de 002 reproducido sin cambios, salvo el
-- caso nuevo REEMBOLSAR_PAGO. Cualquier otra diferencia seria un riesgo.
create or replace function public.aplicar_operaciones(p_operaciones jsonb) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $function$
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
$function$;
commit;
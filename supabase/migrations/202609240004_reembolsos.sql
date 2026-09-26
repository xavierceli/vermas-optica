-- ===========================================================================
-- 202609240004_reembolsos.sql  (version sin lineas en blanco)
-- IMPORTANTE: el SQL Editor de Supabase parte el script por lineas en blanco.
-- Por eso este archivo NO tiene ninguna linea vacia: cada bloque debe llegar
-- entero al servidor. Es idempotente, se puede volver a ejecutar sin riesgo.
-- ===========================================================================
begin;
-- 1) Distinguir cobro de reembolso. Los cobros existentes pasan a ser COBRO.
alter table public.pagos add column if not exists tipo text not null default 'COBRO';
do $mig$ begin
  if not exists (select 1 from pg_constraint where conname = 'pagos_tipo_valido') then
    alter table public.pagos add constraint pagos_tipo_valido check (tipo in ('COBRO', 'REEMBOLSO'));
  end if;
end $mig$;
create index if not exists pagos_pedido_tipo_idx on public.pagos(pedido_id, tipo);
-- 2) El trigger de escritura directa debe admitir el reembolso.
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
    if (to_jsonb(new) - v_campos_sistema) = (to_jsonb(old) - v_campos_sistema) then
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
-- 3) RPC de reembolso: idempotente, bloquea la venta, no deja el abono negativo.
create or replace function public.reembolsar_pago(p_pedido_id uuid, p_idempotency_key uuid, p_monto numeric, p_metodo text, p_referencia text default null) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $function$
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
$function$;
grant execute on function public.reembolsar_pago(uuid, uuid, numeric, text, text) to authenticated;
revoke all on function public.reembolsar_pago(uuid, uuid, numeric, text, text) from public, anon;
commit;
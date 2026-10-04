-- ===========================================================================
-- 202609240018_eliminar_paciente_definitivo.sql  (version sin lineas en blanco)
-- IMPORTANTE: el SQL Editor de Supabase parte el script por lineas en blanco.
-- Este archivo NO tiene ninguna linea vacia y es idempotente.
-- QUE HACE: reemplaza el borrado antiguo (eliminar_paciente_completo, que dejaba
--   registros huerfanos) por un borrado completo y controlado de UN paciente:
--   consultas y sus copias de version, ventas, productos de venta, cobros y
--   reembolsos, movimientos de stock y la ficha, todo en una sola transaccion
--   (se borra todo o no se borra nada). Devuelve al inventario los productos de
--   las ventas NO entregadas. Deja una fila en registros_eliminados (solo codigos
--   aleatorios, fecha, usuario y cantidades; ningun dato del paciente) para que
--   los demas equipos limpien su copia local.
-- TAMBIEN ELIMINA la funcion antigua eliminar_paciente_completo (ya sin permisos).
-- NO BORRA NADA AL EJECUTARLO: solo crea funciones y una tabla. Los datos solo se
--   borran cuando alguien llama a eliminar_paciente_definitivo desde la app.
-- NO usa session_replication_role: las relaciones entre tablas siguen activas.
-- Para deshacerlo: drop function public.eliminar_paciente_definitivo(text);
-- ===========================================================================
begin;
create table if not exists public.registros_eliminados (
  id uuid primary key default extensions.gen_random_uuid(),
  paciente_ids uuid[] not null default '{}',
  consulta_ids uuid[] not null default '{}',
  pedido_ids uuid[] not null default '{}',
  consultas integer not null default 0,
  ventas integer not null default 0,
  cobros integer not null default 0,
  eliminado_por uuid default auth.uid(),
  eliminado_en timestamptz not null default now()
);
comment on table public.registros_eliminados is 'Bitacora minima de borrados definitivos: solo codigos aleatorios, cantidades, fecha y usuario. Los equipos la leen para limpiar su copia local.';
alter table public.registros_eliminados enable row level security;
drop policy if exists registros_eliminados_lectura_autenticados on public.registros_eliminados;
create policy registros_eliminados_lectura_autenticados on public.registros_eliminados for select to authenticated using (true);
revoke all on public.registros_eliminados from public, anon, authenticated;
grant select on public.registros_eliminados to authenticated;
create or replace function public.impedir_mutacion_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'DELETE' and current_setting('app.eliminacion_paciente', true) = 'on' then
    return old;
  end if;
  raise exception 'La tabla % es append-only: no se permite % ni UPDATE.', tg_table_name, tg_op
    using errcode = '55000';
end;
$function$;
-- Candado de pedidos_ventas: igual que el vigente (migracion 015) salvo la rama de borrado definitivo.
create or replace function public.bloquear_escritura_directa_pedidos() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $function$
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
$function$;
create or replace function public.contar_registros_paciente(p_cedula text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_cedula text := upper(btrim(coalesce(p_cedula, '')));
  v_pacientes uuid[];
  v_consultas uuid[];
  v_pedidos uuid[];
begin
  if auth.uid() is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;
  select coalesce(array_agg(p.id), '{}') into v_pacientes from public.pacientes_perfil p where upper(btrim(p.cedula)) = v_cedula;
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
$function$;
create or replace function public.eliminar_paciente_definitivo(p_cedula text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_cedula text := upper(btrim(coalesce(p_cedula, '')));
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
  select coalesce(array_agg(p.id), '{}') into v_pacientes from public.pacientes_perfil p where upper(btrim(p.cedula)) = v_cedula;
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
$function$;
revoke all on function public.contar_registros_paciente(text) from public, anon;
grant execute on function public.contar_registros_paciente(text) to authenticated;
revoke all on function public.eliminar_paciente_definitivo(text) from public, anon;
grant execute on function public.eliminar_paciente_definitivo(text) to authenticated;
drop function if exists public.eliminar_paciente_completo(text);
commit;

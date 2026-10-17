-- ===========================================================================
-- 202609240022_roles_admin_personal.sql
-- ===========================================================================
-- QUE HACE
--   Separa DOS roles: 'admin' y 'personal'.
--     - personal: el trabajo del dia (pacientes, consultas, ventas, cobros,
--       cambios de estado y archivar consultas).
--     - admin   : ademas, lo que toca dinero o es irreversible: inventario,
--       tarifario (precios), reembolsos, anular ventas y borrar un paciente.
--   Y limita VER+ a 3 usuarios como maximo.
--
-- POR QUE SE COMPRUEBA EN EL SERVIDOR Y NO SOLO EN LA PANTALLA
--   Esconder un boton no es seguridad: la clave publica viaja dentro de la app
--   y cualquier usuario con sesion puede llamar a una funcion a mano. Por eso
--   la comprobacion vive DENTRO de las funciones y, ademas, se quita el permiso
--   de llamarlas directamente (solo entran por el despachador aplicar_operaciones).
--
-- TU USUARIO QUEDA ADMIN SOLO
--   Al crear los perfiles, el usuario MAS ANTIGUO (el tuyo) queda 'admin' y el
--   resto 'personal'. Para cambiar a alguien despues:
--     update public.perfiles set rol = 'admin'
--      where user_id = (select id from auth.users where email = 'tu@correo');
--
-- Idempotente: se puede ejecutar dos veces sin romper nada. Sin lineas en
-- blanco dentro de la transaccion (el editor de Supabase a veces parte el
-- script en los saltos; leccion de la migracion 005).
-- ===========================================================================
begin;
-- 1. TABLA DE PERFILES ------------------------------------------------------
create table if not exists public.perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rol text not null default 'personal' constraint perfiles_rol_valido check (rol in ('admin', 'personal')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
alter table public.perfiles enable row level security;
-- 2. ¿ES ADMIN QUIEN LLAMA? (corre como dueño, por eso puede leer perfiles sin
--    recursión de RLS) ------------------------------------------------------
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1 from public.perfiles p
    where p.user_id = auth.uid() and p.rol = 'admin'
  );
$function$;
-- 3. ROL DE QUIEN LLAMA (para que la app sepa que mostrar) ------------------
create or replace function public.mi_rol()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
  select coalesce(
    (select p.rol from public.perfiles p where p.user_id = auth.uid()),
    'personal'
  );
$function$;
revoke all on function public.mi_rol() from public, anon;
grant execute on function public.mi_rol() to authenticated;
-- 4. LECTURA DE PERFILES: cada quien ve su fila; el admin ve todas ----------
drop policy if exists perfiles_lectura on public.perfiles;
create policy perfiles_lectura on public.perfiles
  for select to authenticated
  using (user_id = auth.uid() or public.es_admin());
revoke all on public.perfiles from public, anon;
grant select on public.perfiles to authenticated;
-- 5. ALTA DE PERFIL Y TOPE DE 3 USUARIOS ------------------------------------
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  insert into public.perfiles (user_id, rol) values (new.id, 'personal')
  on conflict (user_id) do nothing;
  return new;
end;
$function$;
drop trigger if exists trg_perfil_nuevo_usuario on auth.users;
create trigger trg_perfil_nuevo_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_nuevo_usuario();
create or replace function public.limitar_usuarios_vermas()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_total integer;
begin
  select count(*) into v_total from auth.users;
  if v_total >= 3 then
    raise exception 'VER+ admite 3 usuarios como maximo. Elimina un usuario antes de crear otro.';
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_limitar_usuarios on auth.users;
create trigger trg_limitar_usuarios
  before insert on auth.users
  for each row execute function public.limitar_usuarios_vermas();
-- 6. PERFILES DE LOS USUARIOS QUE YA EXISTEN (el mas antiguo es admin) ------
insert into public.perfiles (user_id, rol)
select u.id,
       case when row_number() over (order by u.created_at, u.id) = 1 then 'admin' else 'personal' end
from auth.users u
on conflict (user_id) do nothing;
-- 7. DESPACHADOR: solo el admin entra a inventario, precios, reembolsos y
--    anulaciones. Se reproduce el cuerpo de 005 y se antepone el control. ----
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
$function$;
-- 8. BORRAR PACIENTE: se renombra la version actual a _impl y se publica un
--    envoltorio con el control. Asi no se copia su cuerpo (largo y delicado).
--    El _impl queda sin permiso para nadie salvo el dueño. ------------------
do $do$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'eliminar_paciente_definitivo_impl'
  ) then
    alter function public.eliminar_paciente_definitivo(text) rename to eliminar_paciente_definitivo_impl;
  end if;
end;
$do$;
create or replace function public.eliminar_paciente_definitivo(p_cedula text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede borrar un paciente definitivamente.' using errcode = '42501';
  end if;
  return public.eliminar_paciente_definitivo_impl(p_cedula);
end;
$function$;
revoke all on function public.eliminar_paciente_definitivo(text) from public, anon;
revoke all on function public.eliminar_paciente_definitivo_impl(text) from public, anon, authenticated;
grant execute on function public.eliminar_paciente_definitivo(text) to authenticated;
-- 9. CERRAR LA PUERTA DE ATRAS: las funciones de inventario/precios/reembolso/
--    anulacion ya no se pueden llamar directamente; solo el despachador las
--    invoca (que corre como dueño y ya comprueba el rol). -------------------
revoke all on function public.upsert_inventario(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.eliminar_inventario(bigint) from public, anon, authenticated;
revoke all on function public.upsert_precio(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.eliminar_precio(bigint) from public, anon, authenticated;
revoke all on function public.reembolsar_pago(uuid, uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.anular_venta(uuid) from public, anon, authenticated;
commit;

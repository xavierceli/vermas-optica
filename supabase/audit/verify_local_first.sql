-- Verificación posterior a las migraciones local-first.
-- Ejecutar después de 202609240001 y 202609240002.
-- Es de solo lectura: no devuelve datos de negocio.

begin;
set transaction isolation level repeatable read, read only;

-- 1) Objetos creados.
select to_regclass('public.operaciones_aplicadas') as operaciones_aplicadas,
       to_regclass('public.consultas_clinicas_revisiones') as revisiones,
       to_regclass('public.pedido_items') as pedido_items,
       to_regclass('public.inventario_movimientos') as movimientos,
       to_regclass('public.pagos') as pagos;

-- 2) Columnas de versionado y referencias de idempotencia.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name in ('pacientes_perfil','consultas_clinicas','pedidos_ventas','inventario','lista_precios')
      and column_name in ('sync_version','server_updated_at'))
    or (table_name = 'inventario' and column_name = 'client_ref')
    or (table_name in ('inventario_movimientos','pagos') and column_name = 'operacion_id')
    or (table_name = 'consultas_clinicas' and column_name = 'archived_at')
  )
order by table_name, column_name;

-- 3) Funciones de dominio y Outbox.
select n.nspname as schema_name,
       p.proname as function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
       pg_catalog.pg_get_function_result(p.oid) as result_type,
       p.prosecdef as security_definer,
       p.proconfig
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'guardar_consulta_clinica', 'crear_venta', 'editar_venta',
    'registrar_pago', 'actualizar_estado_venta', 'anular_venta',
    'aplicar_operaciones', 'upsert_inventario', 'upsert_precio',
    'archivar_consulta'
  )
order by p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- 4) El trigger antiguo de stock no debe existir; el guard nuevo sí.
select c.relname as table_name, t.tgname as trigger_name,
       pg_catalog.pg_get_triggerdef(t.oid, true) as definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and c.relname in ('pedidos_ventas','pedido_items','pagos','inventario_movimientos')
order by c.relname, t.tgname;

-- 5) Privilegios de tablas: anon no debe tener DML; authenticated no debe escribir
--    directamente las tablas de negocio.
select
  has_table_privilege('anon', 'public.pacientes_perfil', 'SELECT') as anon_patient_select,
  has_table_privilege('anon', 'public.consultas_clinicas', 'INSERT') as anon_consulta_insert,
  has_table_privilege('anon', 'public.pedidos_ventas', 'UPDATE') as anon_venta_update,
  has_table_privilege('authenticated', 'public.pedidos_ventas', 'INSERT') as auth_venta_insert,
  has_table_privilege('authenticated', 'public.consultas_clinicas', 'UPDATE') as auth_consulta_update,
  has_table_privilege('authenticated', 'public.inventario', 'UPDATE') as auth_inventory_update;

-- 6) Outbox/RPC: anon no debe ejecutar el despachador; authenticated sí.
select
  has_function_privilege('anon', 'public.aplicar_operaciones(jsonb)', 'EXECUTE') as anon_outbox_execute,
  has_function_privilege('authenticated', 'public.aplicar_operaciones(jsonb)', 'EXECUTE') as auth_outbox_execute;

-- 7) Índices de integridad.
select indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public'
  and indexname in (
    'unico_cedula',
    'inventario_client_ref_unico',
    'inventario_movimientos_operacion_unico',
    'operaciones_aplicadas_entidad_idx'
  )
order by indexname;

commit;

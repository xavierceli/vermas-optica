-- Extracción segura del esquema relevante de Supabase.
-- Ejecutar en SQL Editor y devolver el resultado de cada consulta.
-- No lee filas de negocio ni contiene sentencias DDL/DML.

begin;
set transaction isolation level repeatable read, read only;

-- 1. Extensiones instaladas: verificar pgcrypto para gen_random_uuid().
select e.extname, e.extversion, n.nspname as schema
from pg_catalog.pg_extension e
join pg_catalog.pg_namespace n on n.oid = e.extnamespace
order by e.extname;

-- 2. Objetos, propietario, RLS, FORCE RLS y opciones de seguridad.
select n.nspname as schema_name,
       c.relname as object_name,
       case c.relkind
         when 'r' then 'table'
         when 'p' then 'partitioned table'
         when 'v' then 'view'
         when 'm' then 'materialized view'
       end as object_type,
       pg_catalog.pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       c.reloptions,
       c.reltuples::bigint as estimated_rows
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'pacientes_perfil', 'consultas_clinicas', 'pedidos_ventas',
    'inventario', 'lista_precios', 'pagos',
    'vista_pacientes', 'vista_pacientes_unicos'
  )
order by c.relname;

-- 3. Columnas, tipos exactos, nulabilidad, defaults e identidad.
select table_name,
       ordinal_position,
       column_name,
       udt_schema || '.' || udt_name as data_type,
       is_nullable,
       column_default,
       is_identity,
       identity_generation,
       is_generated,
       generation_expression,
       col_description(format('%I.%I', table_schema, table_name)::regclass::oid, ordinal_position) as comment
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'pacientes_perfil', 'consultas_clinicas', 'pedidos_ventas',
    'inventario', 'lista_precios', 'pagos',
    'vista_pacientes', 'vista_pacientes_unicos'
  )
order by table_name, ordinal_position;

-- 4. Primary keys, uniques, foreign keys y checks.
select con.conrelid::regclass as table_name,
       con.conname as constraint_name,
       case con.contype
         when 'p' then 'PRIMARY KEY'
         when 'u' then 'UNIQUE'
         when 'f' then 'FOREIGN KEY'
         when 'c' then 'CHECK'
         when 'x' then 'EXCLUSION'
       end as constraint_type,
       con.condeferrable,
       con.condeferred,
       pg_catalog.pg_get_constraintdef(con.oid, true) as definition
from pg_catalog.pg_constraint con
join pg_catalog.pg_class rel on rel.oid = con.conrelid
join pg_catalog.pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
  and rel.relname in (
    'pacientes_perfil', 'consultas_clinicas', 'pedidos_ventas',
    'inventario', 'lista_precios', 'pagos'
  )
order by rel.relname, constraint_type, con.conname;

-- 5. Índices: verificar índices de cédula, paciente, fecha, estado y stock.
select schemaname,
       tablename,
       indexname,
       indexdef
from pg_catalog.pg_indexes
where schemaname = 'public'
  and tablename in (
    'pacientes_perfil', 'consultas_clinicas', 'pedidos_ventas',
    'inventario', 'lista_precios', 'pagos'
  )
order by tablename, indexname;

-- 6. Estado y definición de RLS.
select schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual,
       with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in (
    'pacientes_perfil', 'consultas_clinicas', 'pedidos_ventas',
    'inventario', 'lista_precios', 'pagos'
  )
order by tablename, policyname;

-- 7. Definición de vistas; security_invoker se comprueba en reloptions de la consulta 2.
select schemaname,
       viewname,
       definition
from pg_catalog.pg_views
where schemaname = 'public'
order by viewname;

-- 8. Funciones públicas: cuerpo, tipo devuelto, volatility, search_path,
--    SECURITY DEFINER/INVOKER y permisos EXECUTE.
select n.nspname as schema_name,
       p.proname as function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
       pg_catalog.pg_get_function_result(p.oid) as result_type,
       p.prosecdef as security_definer,
       p.provolatile as volatility,
       p.proparallel as parallel_safety,
       p.proconfig as function_settings,
       p.proacl as execute_privileges,
       pg_catalog.pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind in ('f', 'p')
order by p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- 9. Triggers de las tablas: especialmente deducciones o auditoría ocultas.
select n.nspname as schema_name,
       c.relname as table_name,
       t.tgname as trigger_name,
       pg_catalog.pg_get_triggerdef(t.oid, true) as definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and c.relname in (
    'pacientes_perfil', 'consultas_clinicas', 'pedidos_ventas',
    'inventario', 'lista_precios', 'pagos'
  )
order by c.relname, t.tgname;

-- 10. Grants de tablas: confirmar que anon no tiene permisos.
select table_schema,
       table_name,
       grantee,
       privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'pacientes_perfil', 'consultas_clinicas', 'pedidos_ventas',
    'inventario', 'lista_precios', 'pagos'
  )
order by table_name, grantee, privilege_type;

commit;

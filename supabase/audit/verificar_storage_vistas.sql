-- ===========================================================================
-- 8) SEGURIDAD DE STORAGE Y VISTAS (anadido tras la auditoria de campo)
-- Sin lineas en blanco a proposito: el SQL Editor parte el script por ahi.
-- Debe devolver todo en false / security_invoker=on. Si algo sale en true,
-- hay una fuga: anon o cualquier visitante podrian leer o escribir archivos.
-- ===========================================================================
-- 8a) Ningun bucket con datos de negocio puede ser publico.
select name, public as bucket_publico_deberia_ser_false from storage.buckets where name in ('comprobantes_pagos', 'inventario_imagenes') order by name;
-- 8b) No debe quedar ninguna politica de storage sin exigir usuario.
--     Las autogeneradas por el panel se llaman 'Permitir todo...' y su rol es public.
select policyname, tablename, cmd, roles, (coalesce(qual, '') = '') as sin_restriccion from pg_policies where schemaname = 'storage' and policyname like 'Permitir todo%' order by policyname;
-- 8c) Las vistas deben ser security_invoker; si no, saltan el RLS de las tablas.
select relname, reloptions, (reloptions::text like '%security_invoker=on%') as respeta_rls from pg_class where relname in ('vista_pacientes', 'vista_pacientes_unicos') order by relname;
-- 8d) RLS activo en todas las tablas de negocio. Debe salir todo en true.
select c.relname as tabla, c.relrowsecurity as rls_activo from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('pacientes_perfil', 'consultas_clinicas', 'pedidos_ventas', 'inventario', 'lista_precios', 'pedido_items', 'inventario_movimientos', 'pagos') order by c.relname;
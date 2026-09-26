-- Diagnostico de exposicion. SOLO LECTURA. Sin lineas en blanco a proposito.
-- 1) RLS real por tabla
select c.relname as tabla, c.relrowsecurity as rls_activo, (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as politicas from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('pacientes_perfil','consultas_clinicas','pedidos_ventas','inventario','lista_precios','pedido_items','inventario_movimientos','pagos') order by c.relname;
-- 2) Las vistas saltan RLS si no son security_invoker
select c.relname as vista, c.reloptions, (select rolsuper from pg_roles where rolname = pg_get_userbyid(c.relowner)) as dueno_superusuario from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v';
-- 3) Privilegios reales de anon (lo que de verdad importa hoy)
select table_name, has_table_privilege('anon', 'public.' || table_name, 'SELECT') as anon_lee, has_table_privilege('anon', 'public.' || table_name, 'INSERT') as anon_escribe from information_schema.tables where table_schema = 'public' and table_name in ('pacientes_perfil','consultas_clinicas','pedidos_ventas','inventario','lista_precios') order by table_name;
-- 4) Buckets de Storage y si son publicos (SI es publico, los comprobantes son accesibles sin login)
select id, name, public from storage.buckets order by name;
-- 5) Politicas actuales de storage.objects
select policyname, tablename, cmd, qual from pg_policies where schemaname = 'storage' order by tablename, policyname;
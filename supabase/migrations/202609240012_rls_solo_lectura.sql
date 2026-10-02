-- ============================================================================
-- 202609240012_rls_solo_lectura.sql
-- ============================================================================
-- QUE SE ENCONTRO AL AUDITAR LAS POLITICAS
-- (Las politicas se crean a mano en el panel de Supabase, asi que no estaban
-- en ninguna migracion del repositorio: solo se podia ver el resultado.)
--
-- 1) Las politicas se llamaban "pacientes_perfil_solo_personal" y companeros,
--    pero su USING era `true`: no restringian nada. El nombre mentia.
-- 2) Junto a cada una estaba "Acceso total autenticados", que era
--    `for all to public using (auth.role() = 'authenticated')`. Sin WITH CHECK
--    declarado, PostgreSQL reutiliza el USING tambien para las escrituras: la
--    RLS permitia INSERT, UPDATE y DELETE a cualquier usuario autenticado.
--    Hoy eso NO era explotable porque a `authenticated` solo se le concedio
--    GRANT SELECT sobre esas tablas, pero la red era de un solo paso: un
--    `grant insert` futuro abria la escritura directa a toda la clinica.
-- 3) Las vistas `vista_pacientes` y `vista_pacientes_unicos` no tenian RLS y
--    tenian INSERT, UPDATE, DELETE y TRUNCATE concedidos a `authenticated`,
--    aunque la app SOLO las lee.
--
-- ARREGLO
--   - Cada tabla de negocio queda con UNA sola politica honesta: solo lectura
--     para usuarios autenticados. Se van las dos anteriores.
--   - Las vistas quedan con permisos de solo lectura. PostgreSQL no admite
--     politicas RLS sobre vistas; se controlan con GRANT y REVOKE.
--   - `anon` se queda sin nada, y el historial de revisiones vuelve a ser
--     exclusivo del servidor.
--
-- POR QUE NO ROMPE NADA
--   La app nunca escribe en una tabla: todo entra por funciones SECURITY
--   DEFINER, que se ejecutan como duenio de la tabla y no pasan por la RLS.
--   Se verifico en el codigo: en src/ solo hay `.select()` sobre
--   inventario, lista_precios, pedidos_ventas, pacientes_perfil y las dos
--   vistas. Las escrituras van por `aplicar_operaciones`, `upsert_inventario`,
--   `crear_venta`, `registrar_pago` y demas.
--
-- Idempotente: se puede ejecutar las veces que haga falta.
-- ============================================================================

begin;

-- --- 1. Vistas de pacientes: solo lectura ---------------------------------
-- Las politicas RLS se aplican a tablas, no a vistas. Para estas vistas,
-- REVOKE/GRANT limita el acceso a authenticated y solo permite lectura.
revoke all on public.vista_pacientes from public, anon, authenticated;
revoke all on public.vista_pacientes_unicos from public, anon, authenticated;
grant select on public.vista_pacientes to authenticated;
grant select on public.vista_pacientes_unicos to authenticated;

-- --- 2. Consultas clinicas -------------------------------------------------
revoke all on public.consultas_clinicas from public, anon;
drop policy if exists "Acceso total autenticados" on public.consultas_clinicas;
drop policy if exists consultas_clinicas_solo_personal on public.consultas_clinicas;
drop policy if exists consultas_clinicas_lectura_autenticados on public.consultas_clinicas;
create policy consultas_clinicas_lectura_autenticados on public.consultas_clinicas
  for select to authenticated using (true);

-- --- 3. Inventario ---------------------------------------------------------
revoke all on public.inventario from public, anon;
drop policy if exists "Acceso total autenticados" on public.inventario;
drop policy if exists inventario_solo_personal on public.inventario;
drop policy if exists inventario_lectura_autenticados on public.inventario;
create policy inventario_lectura_autenticados on public.inventario
  for select to authenticated using (true);

-- --- 4. Tarifario ----------------------------------------------------------
revoke all on public.lista_precios from public, anon;
drop policy if exists "Acceso total autenticados" on public.lista_precios;
drop policy if exists lista_precios_solo_personal on public.lista_precios;
drop policy if exists lista_precios_lectura_autenticados on public.lista_precios;
create policy lista_precios_lectura_autenticados on public.lista_precios
  for select to authenticated using (true);

-- --- 5. Pacientes ----------------------------------------------------------
revoke all on public.pacientes_perfil from public, anon;
drop policy if exists "Acceso total autenticados" on public.pacientes_perfil;
drop policy if exists pacientes_perfil_solo_personal on public.pacientes_perfil;
drop policy if exists pacientes_perfil_lectura_autenticados on public.pacientes_perfil;
create policy pacientes_perfil_lectura_autenticados on public.pacientes_perfil
  for select to authenticated using (true);

-- --- 6. Ventas -------------------------------------------------------------
revoke all on public.pedidos_ventas from public, anon;
drop policy if exists "Acceso total autenticados" on public.pedidos_ventas;
drop policy if exists pedidos_ventas_solo_personal on public.pedidos_ventas;
drop policy if exists pedidos_ventas_lectura_autenticados on public.pedidos_ventas;
create policy pedidos_ventas_lectura_autenticados on public.pedidos_ventas
  for select to authenticated using (true);

-- --- 7. Historial de revisiones: solo el servidor -------------------------
-- Lo escribe un trigger y no lo lee nadie desde la app, asi que se queda sin
-- permisos para anon y authenticated. Con la RLS activada y sin politicas ya no
-- podian tocarla, pero esos permisos heredados (INSERT, UPDATE, DELETE,
-- TRUNCATE) eran una mina: el dia que se añada una politica para mostrar el
-- historial en la app, tambien se abririan las escrituras sin querer.
revoke all on public.consultas_clinicas_revisiones from public, anon, authenticated;

commit;

-- ============================================================================
-- VERIFICACION (ejecutar despues del commit): cada tabla de negocio debe
-- mostrar una sola politica terminada en _lectura_autenticados, y `anon` no
-- debe aparecer en la columna de permisos.
-- ============================================================================
select
  c.relname as tabla,
  c.relrowsecurity as rls,
  coalesce((select string_agg(p.polname, ' | ') from pg_policy p where p.polrelid = c.oid), 'SIN POLITICAS') as politicas,
  coalesce((select string_agg(g.grantee || ':' || g.privilege_type, '  ')
              from information_schema.role_table_grants g
              where g.table_schema = 'public' and g.table_name = c.relname
                and g.grantee in ('PUBLIC', 'anon', 'authenticated')), 'sin permisos') as permisos
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'v')
order by c.relrowsecurity, c.relname;

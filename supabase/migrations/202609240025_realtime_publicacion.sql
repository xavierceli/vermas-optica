-- ============================================================================
-- 025: TIEMPO REAL (SUPABASE REALTIME)
-- ============================================================================
-- Objetivo: que los equipos dejen de ver datos de hasta 30 s de antiguedad.
-- El motor de sincronizacion sigue consultando cada 30 s como RESPALDO (y es el
-- unico camino sin conexion). Esto solo anade avisos instantaneos.
--
-- Que hace esta migracion:
--   Anade a la publicacion `supabase_realtime` las tablas que cambian durante
--   el trabajo diario. Sin esto, Realtime no emite NADA para esas tablas.
--
-- Que NO hace:
--   - No cambia RLS: Realtime respeta las politicas del usuario conectado.
--   - No cambia datos ni funciones.
--   - No activa replica identity full: solo se usan los eventos INSERT/UPDATE
--     (payload.new). Los DELETE siguen cubiertos por el sondeo de 30 s.
--
-- Es idempotente: si una tabla ya esta publicada, no hace nada.
-- ============================================================================

begin;

do $publicacion$
declare
  v_tabla text;
  v_tablas text[] := array[
    'inventario',          -- stock y catalogo: lo que mas se pisa entre equipos
    'lista_precios',       -- tarifario
    'consultas_clinicas',  -- fichas y evaluaciones
    'pedidos_ventas',      -- ventas, abonos y estados
    'pagos'                -- cobros y reembolsos
  ];
begin
  if not exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    -- En Supabase la publicacion existe por defecto. Si no existe (otro
    -- entorno), no se aborta: la app sigue funcionando con el sondeo.
    raise notice 'Migracion 025: no existe la publicacion supabase_realtime; se omite.';
    return;
  end if;

  foreach v_tabla in array v_tablas loop
    if to_regclass(format('public.%I', v_tabla)) is null then
      raise exception 'Migracion 025 abortada: falta la tabla public.%', v_tabla;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_tabla
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_tabla);
      raise notice 'Migracion 025: % anadida a supabase_realtime.', v_tabla;
    else
      raise notice 'Migracion 025: % ya estaba publicada.', v_tabla;
    end if;
  end loop;
end
$publicacion$;

commit;

-- ============================================================================
-- COMPROBACION (solo lectura):
--
--   select tablename
--     from pg_publication_tables
--    where pubname = 'supabase_realtime'
--      and schemaname = 'public'
--    order by tablename;
--
-- Deben aparecer: consultas_clinicas, inventario, lista_precios, pagos,
--                  pedidos_ventas (y las que ya hubiera).
--
-- Si Realtime no entrega eventos despues de aplicar esto, en Supabase:
--   Database -> Replication -> supabase_realtime, comprobar que las tablas
--   estan activas y que el proyecto tiene Realtime habilitado.
-- ============================================================================

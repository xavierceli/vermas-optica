-- ===========================================================================
-- 202609240026_revisiones_consulta.sql
-- ===========================================================================
-- QUE HACE
--   Expone en la app el historial de versiones que guarda la migracion 024.
--   Hasta ahora la version anterior de una ficha clinica quedaba recuperable
--   solo con una consulta SQL en el panel de Supabase: el mensaje de conflicto
--   prometia un "historial de revisiones" que el usuario no podia ver.
--
-- POR QUE UNA FUNCION Y NO PERMISO SOBRE LA TABLA
--   Cada revision guarda la fila clinica COMPLETA. Conceder SELECT directo
--   abriria toda la tabla a cualquier cliente. La funcion devuelve solo las
--   columnas necesarias, con limite y orden, sin tocar la RLS ni los permisos
--   de la tabla.
--
-- SEGURIDAD
--   - SECURITY DEFINER con search_path fijo.
--   - Sin permiso para public ni anon; solo authenticated.
--   - La app ya permite a cualquier usuario autenticado leer todas las fichas
--     clinicas (RLS de solo lectura), asi que ver sus versiones no amplia el
--     alcance.
--
-- Idempotente: se puede ejecutar dos veces.
-- ===========================================================================
begin;

create or replace function public.revisiones_consulta(
  p_consulta_id uuid,
  p_limite integer default 20
)
returns table (
  version integer,
  motivo text,
  editado_en timestamptz,
  editado_por text,
  snapshot jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
  select
    r.version,
    r.motivo,
    r.editado_en,
    coalesce(u.email::text, '') as editado_por,
    r.snapshot
  from public.consultas_clinicas_revisiones r
  left join auth.users u on u.id = r.editado_por
  where r.consulta_id = p_consulta_id
    and auth.uid() is not null
  order by r.version desc, r.editado_en desc
  limit greatest(1, least(coalesce(p_limite, 20), 50));
$function$;

revoke all on function public.revisiones_consulta(uuid, integer) from public, anon;
grant execute on function public.revisiones_consulta(uuid, integer) to authenticated;

comment on function public.revisiones_consulta(uuid, integer) is
  'Versiones anteriores de una consulta clinica, para el panel de conflictos.';

commit;

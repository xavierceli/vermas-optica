-- ===========================================================================
-- 202609240017_historial_consultas.sql  (version sin lineas en blanco)
-- IMPORTANTE: el SQL Editor de Supabase parte el script por lineas en blanco.
-- Este archivo NO tiene ninguna linea vacia y es idempotente.
-- QUE ARREGLA: editar una consulta clinica sobrescribia lo anterior sin dejar
--   copia. La migracion 012 decia que un trigger guardaba las versiones, pero
--   ese trigger nunca existio en la base.
-- QUE HACE: cada vez que cambia el CONTENIDO clinico de una consulta, guarda en
--   consultas_clinicas_revisiones una copia de como estaba ANTES de la edicion.
--   No guarda nada si el contenido no cambio (guardados repetidos) ni cuando solo
--   se archiva (archivar_consulta ya guarda su propia copia).
-- NO TOCA datos existentes: solo agrega una funcion y un trigger. Hacia adelante
--   crea filas nuevas en consultas_clinicas_revisiones; no hay copia de ediciones
--   anteriores a esta migracion porque no se guardaron.
-- La tabla de revisiones sigue sin permisos para la app (solo se lee desde el
--   SQL Editor de Supabase).
-- Para deshacerlo: drop trigger trg_guardar_revision_consulta on public.consultas_clinicas;
-- ===========================================================================
begin;
create or replace function public.guardar_revision_consulta()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_sistema text[] := array['sync_version', 'server_updated_at', 'archived_at', 'created_at'];
begin
  if (to_jsonb(new) - v_sistema) = (to_jsonb(old) - v_sistema) then
    return null;
  end if;
  insert into public.consultas_clinicas_revisiones (consulta_id, version, snapshot, motivo, editado_por)
  values (
    old.id,
    old.sync_version,
    to_jsonb(old),
    'Edición',
    coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  );
  return null;
end;
$function$;
revoke all on function public.guardar_revision_consulta() from public, anon, authenticated;
drop trigger if exists trg_guardar_revision_consulta on public.consultas_clinicas;
create trigger trg_guardar_revision_consulta
  after update on public.consultas_clinicas
  for each row execute function public.guardar_revision_consulta();
commit;

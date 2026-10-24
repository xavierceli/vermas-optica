-- ===========================================================================
-- 202609240023_cedulas_archivadas.sql  (version sin lineas en blanco)
-- IMPORTANTE: el SQL Editor de Supabase parte el script por lineas en blanco.
-- Este archivo NO tiene ninguna linea vacia y es idempotente.
-- QUE ARREGLA: la app calculaba las cedulas de pacientes archivados bajando
--   DOS VECES la tabla completa consultas_clinicas en cada sincronizacion
--   (todas las vivas y todas las archivadas), solo para deducir unos ids.
--   Con el historial creciendo, cada pull paginaba miles de filas para algo
--   que la base sabe calcular sola.
-- QUE HACE: crea la vista pacientes_archivados con la MISMA semantica que
--   tenia leerCedulasArchivadasDelServidor en el cliente: una fila por cedula
--   (mayusculas, sin espacios) cuyo paciente tiene ALGUNA consulta archivada
--   y NINGUNA viva. El cliente la usa si existe y si no, sigue por el camino
--   antiguo (la app no exige aplicar esta migracion para funcionar).
-- SEGURIDAD: security_invoker hace que el RLS de las tablas base siga
--   mandando; anon se queda sin acceso y authenticated solo puede leer.
-- Para deshacerlo: drop view if exists public.pacientes_archivados;
-- ===========================================================================
begin;
create or replace view public.pacientes_archivados
with (security_invoker = on)
as
select distinct upper(btrim(p.cedula)) as cedula
from public.pacientes_perfil p
where p.cedula is not null
  and btrim(p.cedula) <> ''
  and exists (
    select 1 from public.consultas_clinicas c
    where c.paciente_id = p.id
      and c.archived_at is not null
  )
  and not exists (
    select 1 from public.consultas_clinicas v
    where v.paciente_id = p.id
      and v.archived_at is null
  );
revoke all on public.pacientes_archivados from public, anon, authenticated;
grant select on public.pacientes_archivados to authenticated;
commit;

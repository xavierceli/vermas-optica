-- ============================================================================
-- 202609240014_archiva_pacientes_prueba.sql
-- ============================================================================
-- POR QUE ESTE ARCHIVO
-- Al borrar un paciente, la app lo tapaba SOLO en el equipo que lo habia
-- borrado. El historial se descarga de la vista `vista_pacientes_unicos`, que
-- se creo antes del archivado e ignora `archived_at`. Resultado: en un
-- navegador nuevo (Edge, por ejemplo) "PRUEBA" y "PRUEBA2" aparecian como si
-- nadie los hubiera borrado nunca.
--
-- OJO, TRAMPA: `consultas_clinicas` NO tiene columna `cedula`. La cedula vive en
-- `pacientes_perfil` y la consulta guarda `paciente_id`. Por eso todo esto va por
-- JOIN.
--
-- QUE HACE
-- Archiva las consultas de los pacientes de PRUEBA. Es idempotente, reversible y
-- NO toca ventas ni pagos.
-- ============================================================================

-- PASO 1 - VERIFICACION (solo lee). Ejecuta esto primero.
select
  p.cedula,
  p.nombre,
  count(*) as consultas,
  count(*) filter (where c.archived_at is not null) as ya_archivadas
from public.consultas_clinicas c
join public.pacientes_perfil p on p.id = c.paciente_id
where p.cedula in ('0705770742', '0705770743')
group by p.cedula, p.nombre
order by p.cedula;

-- PASO 2 - ARCHIVAR. Solo si el paso 1 salio bien.
begin;

update public.consultas_clinicas c
set archived_at = now(),
    sync_version = c.sync_version + 1,
    server_updated_at = now()
where c.archived_at is null
  and c.paciente_id in (
    select id from public.pacientes_perfil
    where cedula in ('0705770742', '0705770743')
  );

commit;

-- PASO 3 - COMPROBACION: consultas debe coincidir con archivadas.
select
  count(*) as consultas,
  count(*) filter (where c.archived_at is not null) as archivadas
from public.consultas_clinicas c
join public.pacientes_perfil p on p.id = c.paciente_id
where p.cedula in ('0705770742', '0705770743');

-- COMO DESHACERLO
-- update public.consultas_clinicas c
-- set archived_at = null, sync_version = c.sync_version + 1, server_updated_at = now()
-- where c.paciente_id in (select id from public.pacientes_perfil where cedula in ('0705770742','0705770743'));
-- ============================================================================

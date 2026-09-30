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
-- La app ya pregunta al servidor que cedulas estan archivadas, pero SOLO puede
-- ocultar lo que el servidor sepa. Si el borrado nunca subio, el servidor no lo
-- sabe y este script lo pone al dia.
--
-- QUE HACE
-- Archiva las consultas de los pacientes DE PRUEBA, tomando la lista de
-- pacientes que se van a verificar justo antes de tocar nada.
--
-- ES SEGURO
--   · Solo toca las CEDULAS de la lista de abajo.
--   · Solo lo que sigue SIN archivar: correrlo dos veces no hace nada la segunda.
--   · Se puede deshacer (ver el final del archivo).
--   · No toca ventas ni pagos: solo consultas clinicas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PASO 1 — VERIFICACION. Esto SOLO LEE. Copia y ejecuta este bloque primero.
-- ---------------------------------------------------------------------------
-- Debe salirte SOLO lo que ya conoces: los pacientes de prueba. Si aparece un nombre
-- real (GINA, DOMENICA, un paciente de verdad), NO sigas al paso 2 y dimelo.
select
  c.cedula,
  c.nombre,
  count(*) as consultas,
  count(*) filter (where c.archived_at is not null) as ya_archivadas
from public.consultas_clinicas c
where c.cedula in ('0705770742', '0705770743')
group by c.cedula, c.nombre
order by c.cedula;

-- Si quieres ver el detalle una a una:
-- select cedula, nombre, fecha, archived_at
-- from public.consultas_clinicas
-- where cedula in ('0705770742', '0705770743')
-- order by cedula, fecha desc;

-- ---------------------------------------------------------------------------
-- PASO 2 — ARCHIVAR. Copia y ejecuta este bloque solo si el paso 1 salio bien.
-- ---------------------------------------------------------------------------
begin;

update public.consultas_clinicas
set archived_at = now(),
    sync_version = sync_version + 1,
    server_updated_at = now()
where archived_at is null
  and cedula in ('0705770742', '0705770743');

commit;

-- ---------------------------------------------------------------------------
-- PASO 3 — COMPROBACION. Debe decir consultas = archivadas.
-- ---------------------------------------------------------------------------
select
  count(*) as consultas,
  count(*) filter (where archived_at is not null) as archivadas
from public.consultas_clinicas
where cedula in ('0705770742', '0705770743');

-- ---------------------------------------------------------------------------
-- COMO DESHACERLO, si te arrepientes
-- ---------------------------------------------------------------------------
-- update public.consultas_clinicas
-- set archived_at = null, sync_version = sync_version + 1, server_updated_at = now()
-- where cedula in ('0705770742', '0705770743');

-- ---------------------------------------------------------------------------
-- NOTA SOBRE EL CODIGO
-- El error "syntax error at or near supabase" aparece cuando se pega la RUTA
-- del archivo en lugar de su CONTENIDO. En la consola de Supabase SQL Editor hay
-- que abrir el archivo, copiar el texto de dentro y pegarlo.
-- ============================================================================

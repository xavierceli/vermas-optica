-- ============================================================================
-- 202609240013_archiva_consultas_prueba.sql
-- ============================================================================
-- UN SOLO PACIENTE DE PRUEBA, LIMPIEZA PUNTUAL.
--
-- QUE PASABA
-- Las 4 consultas del paciente de prueba quedaron archivadas SOLO en el
-- dispositivo. La app no lograba encolar el archivo al servidor (bug del
-- cliente, ya corregido), asi que el servidor seguia devolviendo la consulta en
-- cada sincronizacion. En el equipo que lo borro ya no aparece (el filtro local
-- lo oculta), pero en OTRO equipo, o tras reinstalar la app o limpiar la cache
-- del navegador, el paciente volveria a salir.
--
-- QUE HACE
-- Lo mismo que la funcion public.archivar_consulta(): poner archived_at a las
-- 4 consultas, para que el servidor deje de mandarlas.
--
-- Idempotente: solo toca lo que sigue SIN archivar, asi que correrlo dos veces
-- no hace nada la segunda. Es reversible:
--   update public.consultas_clinicas set archived_at = null where id in (...);
--
-- ESTA MIGRACION ES OPCIONAL. La app ya funciona sin ella: solo evita que el
-- paciente reaparezca en otros dispositivos.
-- ============================================================================

begin;

update public.consultas_clinicas
set archived_at = now(),
    sync_version = sync_version + 1,
    server_updated_at = now()
where archived_at is null
  and id in (
    '1a0298a0-a710-4f11-a7a1-75f092a151e6'::uuid,
    '25157037-d81e-4776-be3d-273914f0da98'::uuid,
    '84deef12-d2af-4a7d-9d2e-b32c1e6b5de2'::uuid,
    'd7cf3787-16f6-4a73-ad66-316f04d41684'::uuid
  );

commit;

-- Verificacion: archivadas debe coincidir con consultas.
select
  count(*) as consultas,
  count(*) filter (where archived_at is not null) as archivadas
from public.consultas_clinicas
where id in (
  '1a0298a0-a710-4f11-a7a1-75f092a151e6'::uuid,
  '25157037-d81e-4776-be3d-273914f0da98'::uuid,
  '84deef12-d2af-4a7d-9d2e-b32c1e6b5de2'::uuid,
  'd7cf3787-16f6-4a73-ad66-316f04d41684'::uuid
);
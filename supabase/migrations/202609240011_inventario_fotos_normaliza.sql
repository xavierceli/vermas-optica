-- ============================================================================
-- 202609240011_inventario_fotos_normaliza.sql
-- ============================================================================
-- LIMPIEZA DE DATOS (opcional, la app ya funciona sin ejecutarla).
--
-- Las fotos del inventario se guardaron como URL PUBLICA cuando el bucket
-- todavia era publico:
--   https://<proyecto>.supabase.co/storage/v1/object/public/inventario_imagenes/<archivo>
-- El bucket ahora es PRIVADO (migraciones 006 y 008) y la app espera solo la
-- RUTA interna del archivo, porque la URL firmada caduca a la hora.
--
-- Este script deja imagen_url con la ruta interna:
--   1788277291740_GeminiGeneratedImage1ml3ibrni3br1ml.png
--
-- NO borra ni mueve archivos. Es idempotente: solo toca filas que tengan la
-- URL publica antigua, y los productos sin foto no se ven afectados.
-- ============================================================================

begin;

update public.inventario
set imagen_url = btrim(regexp_replace(imagen_url, '^.*inventario_imagenes/', ''))
where imagen_url like '%/inventario_imagenes/%'
  and btrim(regexp_replace(imagen_url, '^.*inventario_imagenes/', '')) <> ''
  and btrim(regexp_replace(imagen_url, '^.*inventario_imagenes/', '')) not like '%..%';

commit;

-- Verificacion: deben quedar 0 filas con URL publica antigua.
select
  count(*) filter (where imagen_url like 'http%') as urls_antiguas,
  count(*) filter (where imagen_url <> '' and imagen_url is not null) as con_foto,
  count(*) as total
from public.inventario;
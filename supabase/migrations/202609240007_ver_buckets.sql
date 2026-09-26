-- ===========================================================================
-- 202609240007_ver_buckets.sql
-- Correccion de 006. Al poner los buckets en privado, Storage dejo de
-- resolverlos: la API busca la fila en storage.buckets y esa tabla tiene RLS,
-- sin politica para 'authenticated' el resultado es 0 filas y responde 404
-- "Bucket not found" aunque el bucket exista.
-- Solo se abre la LECTURA del nombre/estado del bucket. Los archivos siguen
-- protegidos por las politicas de storage.objects creadas en 006.
-- anon sigue sin ver nada. Idempotente. Sin lineas en blanco.
-- ===========================================================================
begin;
drop policy if exists "app_ver_buckets" on storage.buckets;
create policy "app_ver_buckets" on storage.buckets for select to authenticated using (id in ('comprobantes_pagos', 'inventario_imagenes'));
commit;
-- ===========================================================================
-- 202609240008_crear_buckets.sql  (ejecutar en el proyecto uaflmzuklixcpqspiyqi)
-- La app reported "Bucket not found" al firmar un comprobante. Motivo: el
-- bucket no existe en el proyecto que usa la app (uaflmzuklixcpqspiyqi). La
-- migracion 006 solo hacia UPDATE sobre buckets existentes, asi que si no
-- estaban, no los creaba y ademas dejaba las politicas huerfanas.
-- Este script CREA los que falten y vuelve a dejar TODAS las politicas
-- correctas. Es idempotente y se puede ejecutar las veces que haga falta.
-- Verifica el proyecto antes: en la URL del panel debe verse uaflmzuklixcpqspiyqi
-- ===========================================================================
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('comprobantes_pagos', 'comprobantes_pagos', false, 10485760, null) on conflict (id) do update set public = false;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('inventario_imagenes', 'inventario_imagenes', false, 10485760, null) on conflict (id) do update set public = false;
drop policy if exists "app_ver_buckets" on storage.buckets;
create policy "app_ver_buckets" on storage.buckets for select to authenticated using (id in ('comprobantes_pagos', 'inventario_imagenes'));
drop policy if exists "ver_comprobantes_pagos" on storage.objects;
drop policy if exists "subir_comprobantes_pagos" on storage.objects;
drop policy if exists "editar_comprobantes_pagos" on storage.objects;
drop policy if exists "borrar_comprobantes_pagos" on storage.objects;
create policy "ver_comprobantes_pagos" on storage.objects for select to authenticated using (bucket_id = 'comprobantes_pagos');
create policy "subir_comprobantes_pagos" on storage.objects for insert to authenticated with check (bucket_id = 'comprobantes_pagos');
create policy "editar_comprobantes_pagos" on storage.objects for update to authenticated using (bucket_id = 'comprobantes_pagos') with check (bucket_id = 'comprobantes_pagos');
create policy "borrar_comprobantes_pagos" on storage.objects for delete to authenticated using (bucket_id = 'comprobantes_pagos');
drop policy if exists "ver_inventario_imagenes" on storage.objects;
drop policy if exists "subir_inventario_imagenes" on storage.objects;
create policy "ver_inventario_imagenes" on storage.objects for select to authenticated using (bucket_id = 'inventario_imagenes');
create policy "subir_inventario_imagenes" on storage.objects for insert to authenticated with check (bucket_id = 'inventario_imagenes');
commit;
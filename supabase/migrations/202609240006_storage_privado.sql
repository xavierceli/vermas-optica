-- ===========================================================================
-- 202609240006_storage_privado.sql
-- URGENTE. Los dos buckets estaban en public=true con politicas "Permitir todo".
-- Eso permitia, SIN INICIAR SESION: leer comprobantes de pago, SUBIR archivos
-- arbitrarios y SOBRESCRIBIR comprobantes existentes (la politica UPDATE solo
-- filtra por bucket_id, no exige usuario). Un atacante podia reemplazar la
-- imagen de un comprobante de un cliente.
-- Este script pone los buckets en privado y deja las politicas solo para
-- usuarios autenticados. Idempotente. Sin lineas en blanco.
-- ===========================================================================
begin;
update storage.buckets set public = false where id in ('comprobantes_pagos', 'inventario_imagenes') and public = true;
drop policy if exists "Permitir Todo 13vweb3_0" on storage.objects;
drop policy if exists "Permitir Todo 13vweb3_1" on storage.objects;
drop policy if exists "Permitir Todo 13vweb3_2" on storage.objects;
drop policy if exists "Permitir Todo 13vweb3_3" on storage.objects;
drop policy if exists "Permitir todo is57ui_0" on storage.objects;
drop policy if exists "Permitir todo is57ui_1" on storage.objects;
drop policy if exists "Permitir todo is57ui_2" on storage.objects;
drop policy if exists "Permitir todo is57ui_3" on storage.objects;
drop policy if exists "subida_inventario_imagenes" on storage.objects;
drop policy if exists "edicion_inventario_imagenes" on storage.objects;
create policy "ver_inventario_imagenes" on storage.objects for select to authenticated using (bucket_id = 'inventario_imagenes');
create policy "subir_inventario_imagenes" on storage.objects for insert to authenticated with check (bucket_id = 'inventario_imagenes');
create policy "editar_inventario_imagenes" on storage.objects for update to authenticated using (bucket_id = 'inventario_imagenes') with check (bucket_id = 'inventario_imagenes');
create policy "borrar_inventario_imagenes" on storage.objects for delete to authenticated using (bucket_id = 'inventario_imagenes');
create policy "ver_comprobantes_pagos" on storage.objects for select to authenticated using (bucket_id = 'comprobantes_pagos');
create policy "subir_comprobantes_pagos" on storage.objects for insert to authenticated with check (bucket_id = 'comprobantes_pagos');
create policy "editar_comprobantes_pagos" on storage.objects for update to authenticated using (bucket_id = 'comprobantes_pagos') with check (bucket_id = 'comprobantes_pagos');
create policy "borrar_comprobantes_pagos" on storage.objects for delete to authenticated using (bucket_id = 'comprobantes_pagos');
commit;
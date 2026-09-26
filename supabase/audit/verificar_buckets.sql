-- Confirmacion: debe devolver public=false en los dos buckets y una sola
-- politica de lectura sobre storage.buckets (app_ver_buckets, solo authenticated).
select id, name, public from storage.buckets where name in ('comprobantes_pagos', 'inventario_imagenes') order by name;
select policyname, tablename, cmd, roles, qual from pg_policies where schemaname = 'storage' and tablename = 'buckets';
select policyname, cmd, roles from pg_policies where schemaname = 'storage' and policyname like '%comprobantes%' order by policyname;
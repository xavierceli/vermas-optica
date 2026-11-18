-- ============================================================================
-- PRELUDIO PARA RESTAURAR UN RESPALDO DE SUPABASE EN UN POSTGRESQL LIMPIO
-- ============================================================================
-- El volcado solo trae el esquema `public`, pero ese esquema depende de cosas
-- que en Supabase ya existen y en un Postgres pelado no:
--
--   - roles anon / authenticated / service_role (los usan los GRANT y la RLS),
--   - el esquema auth con auth.uid() y auth.role() (los usan las funciones),
--   - la tabla auth.users (public.perfiles tiene una clave foranea contra ella
--     y ademas hay triggers que se enganchan a esa tabla).
--
-- Este archivo crea lo minimo. No crea datos de usuarios: esos se insertan
-- aparte con scripts/preparar-restauracion.mjs, extrayendo los ids que
-- referencia public.perfiles en el propio volcado.
-- ============================================================================

create schema if not exists auth;

-- Supabase instala pgcrypto en el esquema `extensions`, y las tablas del
-- volcado usan `extensions.gen_random_uuid()` en sus valores por defecto.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create or replace function auth.uid() returns uuid
  language sql stable as $$ select null::uuid $$;

create or replace function auth.role() returns text
  language sql stable as $$ select 'authenticated'::text $$;

create or replace function auth.jwt() returns jsonb
  language sql stable as $$ select '{}'::jsonb $$;

create or replace function auth.email() returns text
  language sql stable as $$ select null::text $$;

-- Roles internos de Supabase que aparecen en los GRANT del volcado.
-- Solo hace falta que existan para que la restauracion no aborte.
do $$
declare
  rol text;
begin
  foreach rol in array array['anon', 'authenticated', 'service_role',
                              'supabase_admin', 'dashboard_user',
                              'supabase_auth_admin', 'supabase_storage_admin',
                              'pgbouncer', 'authenticator']
  loop
    if not exists (select 1 from pg_roles where rolname = rol) then
      if rol in ('service_role', 'supabase_admin') then
        execute format('create role %I nologin noinherit bypassrls', rol);
      else
        execute format('create role %I nologin noinherit', rol);
      end if;
    end if;
  end loop;
end $$;

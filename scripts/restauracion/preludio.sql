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

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin noinherit';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin noinherit';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin noinherit bypassrls';
  end if;
end $$;

create extension if not exists pgcrypto;

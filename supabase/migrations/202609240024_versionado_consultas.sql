-- ============================================================================
-- 024: VERSIONADO OPTIMISTA EN CONSULTAS CLINICAS
-- ============================================================================
-- Problema que corrige:
--   guardar_consulta_clinica hacia un UPDATE de las columnas presentes en el
--   payload SIN comprobar la version. Si el equipo A y el equipo B abrian la
--   misma consulta y ambos guardaban, el ultimo pisaba lo del primero en
--   silencio. En una ficha clinica eso es perdida de datos.
--
-- Que hace esta migracion:
--   1. guardar_consulta_clinica_v2: bloquea la fila (FOR UPDATE), comprueba
--      p_base_version y, si no coincide, rechaza con SQLSTATE 40001. El
--      despachador aplicar_operaciones ya traduce 40001 a status 'conflict'.
--   2. Antes de cada edicion guarda la fila anterior en
--      consultas_clinicas_revisiones. Asi, aunque el cliente no sepa la
--      version (por ejemplo una consulta bajada antes de esta migracion),
--      el dato pisado NUNCA se pierde: queda recuperable.
--   3. guardar_consulta_clinica (2 argumentos) se conserva como envoltorio.
--      Asi crear_venta y aplicar_operaciones siguen funcionando sin tocarlos.
--   4. Crea vista_pacientes_versionada: la vista de historial mas la columna
--      sync_version_consulta, para que el cliente sepa que version tiene.
--      Es un LEFT JOIN con la tabla base: si algo no coincide, la fila sigue
--      saliendo (solo sin version) y el comportamiento vuelve al de hoy.
--
-- Requiere haber aplicado 202609240002_local_first.sql (sync_version y
-- consultas_clinicas_revisiones).
-- Es idempotente: se puede ejecutar dos veces.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Preflight: fallar con un mensaje claro si falta la base.
-- ---------------------------------------------------------------------------
do $preflight$
begin
  if to_regclass('public.consultas_clinicas') is null
     or to_regclass('public.pacientes_perfil') is null then
    raise exception 'Migracion 024 abortada: falta el esquema base (consultas_clinicas/pacientes_perfil).';
  end if;

  if to_regclass('public.vista_pacientes') is null then
    raise exception 'Migracion 024 abortada: falta la vista public.vista_pacientes del esquema base.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'consultas_clinicas'
      and column_name = 'sync_version'
  ) then
    raise exception 'Migracion 024 abortada: aplique antes 202609240002_local_first.sql (falta consultas_clinicas.sync_version).';
  end if;

  if to_regclass('public.consultas_clinicas_revisiones') is null then
    raise exception 'Migracion 024 abortada: aplique antes 202609240002_local_first.sql (falta consultas_clinicas_revisiones).';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- 1) Implementacion nueva, con version.
-- ---------------------------------------------------------------------------
create or replace function public.guardar_consulta_clinica_v2(
  p_consulta_id uuid,
  p_payload jsonb,
  p_base_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_usuario uuid := auth.uid();
  v_perfil jsonb := case when jsonb_typeof(p_payload -> 'paciente') = 'object'
                        then p_payload -> 'paciente' else '{}'::jsonb end;
  v_consulta jsonb := case when jsonb_typeof(p_payload -> 'consulta') = 'object'
                          then p_payload -> 'consulta' else '{}'::jsonb end;
  v_cedula text;
  v_consulta_id uuid := coalesce(p_consulta_id, extensions.gen_random_uuid());
  v_paciente_id uuid;
  v_paciente_previo uuid;
  v_actual public.consultas_clinicas;
  v_version_actual bigint := 0;
  v_version_nueva bigint := 0;
  v_columnas text;
  v_asignaciones text;
  v_sql text;
  v_creada boolean := false;
begin
  if v_usuario is null then
    raise exception 'Autenticación requerida.' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload clínico inválido.' using errcode = '22023';
  end if;

  -- La version viaja dentro del payload para no cambiar la firma que usan
  -- crear_venta y aplicar_operaciones. El parametro explicito gana si viene.
  if p_base_version is null then
    p_base_version := nullif(btrim(coalesce(p_payload ->> 'base_version', '')), '')::bigint;
  end if;

  v_cedula := upper(btrim(coalesce(v_perfil ->> 'cedula', '')));
  if v_cedula = '' then
    raise exception 'La cédula del paciente es obligatoria.' using errcode = '22023';
  end if;
  if btrim(coalesce(v_perfil ->> 'nombre', '')) = '' then
    raise exception 'El nombre del paciente es obligatorio.' using errcode = '22023';
  end if;

  -- Upsert por la cédula: nunca cambiar el UUID de un perfil existente.
  insert into public.pacientes_perfil as existente (
    id, cedula, nombre, telefono, correo, fecha_nacimiento, antecedentes, alias
  ) values (
    extensions.gen_random_uuid(),
    v_cedula,
    btrim(v_perfil ->> 'nombre'),
    nullif(btrim(coalesce(v_perfil ->> 'telefono', '')), ''),
    nullif(lower(btrim(coalesce(v_perfil ->> 'correo', ''))), ''),
    nullif(btrim(coalesce(v_perfil ->> 'fecha_nacimiento', '')), ''),
    nullif(btrim(coalesce(v_perfil ->> 'antecedentes', '')), ''),
    nullif(btrim(coalesce(v_perfil ->> 'alias', '')), '')
  )
  on conflict (cedula) do update set
    nombre = coalesce(nullif(btrim(excluded.nombre), ''), existente.nombre),
    telefono = coalesce(nullif(excluded.telefono, ''), existente.telefono),
    correo = coalesce(nullif(excluded.correo, ''), existente.correo),
    fecha_nacimiento = coalesce(nullif(excluded.fecha_nacimiento, ''), existente.fecha_nacimiento),
    antecedentes = coalesce(nullif(excluded.antecedentes, ''), existente.antecedentes),
    alias = coalesce(nullif(excluded.alias, ''), existente.alias)
  returning id into v_paciente_id;

  -- FOR UPDATE serializa dos equipos que guarden la MISMA consulta a la vez:
  -- el segundo espera, ve la version nueva y (si la suya es vieja) recibe 40001
  -- en vez de pisar el trabajo del primero.
  select c.* into v_actual
  from public.consultas_clinicas c
  where c.id = v_consulta_id
  for update;

  if found then
    v_paciente_previo := v_actual.paciente_id;
    v_version_actual := coalesce(v_actual.sync_version, 0);

    if v_paciente_previo <> v_paciente_id then
      raise exception 'La consulta % pertenece a otro paciente.', v_consulta_id
        using errcode = '23514';
    end if;

    if p_base_version is not null and v_version_actual <> p_base_version then
      raise exception 'La evaluación clínica fue modificada en otro dispositivo (servidor %, local %).',
        v_version_actual, p_base_version
        using errcode = '40001';
    end if;
  end if;

  -- Blindaje: la version la decide SIEMPRE el servidor. Aunque un cliente
  -- antiguo mande estas columnas en el payload, se ignoran.
  v_consulta := v_consulta
    - array['id', 'paciente_id', 'cedula', 'nombre', 'created_at',
            'sync_version', 'server_updated_at', 'sync_version_consulta', 'syncVersion'];

  if not found then
    v_creada := true;
    v_consulta := jsonb_set(
      v_consulta,
      '{fecha}',
      to_jsonb(coalesce(nullif(btrim(v_consulta ->> 'fecha'), ''), current_date::text))
    );

    select
      string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position),
      null
    into v_columnas, v_asignaciones
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'consultas_clinicas';

    v_sql := format(
      'insert into public.consultas_clinicas (%s)
         select (pg_catalog.jsonb_populate_record(null::public.consultas_clinicas, $1::jsonb)).*',
      v_columnas
    );
    execute v_sql using (
      v_consulta || jsonb_build_object(
        'id', v_consulta_id,
        'paciente_id', v_paciente_id,
        -- jsonb_populate_record NO aplica defaults: rellena con NULL lo que
        -- falta. Como sync_version y server_updated_at son NOT NULL desde la
        -- migracion 002, se inyectan aqui para que una consulta NUEVA nunca
        -- falle por dejar esas columnas en NULL.
        'sync_version', 0,
        'server_updated_at', now(),
        -- Mismo motivo: si created_at es NOT NULL y no viene en el payload,
        -- populate_record lo dejaria en NULL.
        'created_at', now()
      )
    )::text;

    -- sync_version arranca en 0 (se inyecto arriba en el JSON del INSERT).
    v_version_nueva := 0;

  elsif v_consulta <> '{}'::jsonb then
    select string_agg(format('%I = r.%I', c.column_name, c.column_name), ', ' order by c.column_name)
    into v_asignaciones
    from jsonb_object_keys(v_consulta) as clave(clave)
    join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = 'consultas_clinicas'
     and c.column_name = clave.clave
    where c.column_name not in ('id', 'paciente_id', 'created_at',
                                'sync_version', 'server_updated_at');

    if v_asignaciones is null then
      raise exception 'La evaluación no contiene columnas clínicas válidas.' using errcode = '22023';
    end if;

    -- Revision previa: la version que va a ser reemplazada queda guardada.
    -- Es la garantia de que "el ultimo gana" nunca destruye informacion.
    insert into public.consultas_clinicas_revisiones
      (consulta_id, version, snapshot, motivo, editado_por)
    values
      (v_consulta_id, v_version_actual, to_jsonb(v_actual), 'edicion', v_usuario);

    v_version_nueva := v_version_actual + 1;

    v_sql := format(
      'update public.consultas_clinicas as c
          set %s,
              sync_version = $4::bigint,
              server_updated_at = now()
        from pg_catalog.jsonb_populate_record(null::public.consultas_clinicas, $1::jsonb) as r
        where c.id = $2 and c.paciente_id = $3',
      v_asignaciones
    );
    execute v_sql using v_consulta::text, v_consulta_id, v_paciente_id, v_version_nueva;

    if not found then
      raise exception 'No se pudo actualizar la consulta %.', v_consulta_id using errcode = 'P0002';
    end if;

  else
    -- Nada que escribir: se devuelve la version actual sin incrementarla.
    v_version_nueva := v_version_actual;
  end if;

  return jsonb_build_object(
    'consulta_id', v_consulta_id,
    'paciente_id', v_paciente_id,
    'creada', v_creada,
    'sync_version', v_version_nueva
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2) Envoltorio compatible con la firma de siempre.
--    seguir usando (uuid, jsonb) sin ambiguedad de sobrecargas.
-- ---------------------------------------------------------------------------
create or replace function public.guardar_consulta_clinica(
  p_consulta_id uuid,
  p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, pg_temp
as $function$
  select public.guardar_consulta_clinica_v2(
    p_consulta_id,
    p_payload,
    nullif(btrim(coalesce(p_payload ->> 'base_version', '')), '')::bigint
  );
$function$;

-- ---------------------------------------------------------------------------
-- 3) Vista de historial con la version de la consulta.
--    LEFT JOIN a proposito: si el id de la vista no coincidiera con el de
--    consultas_clinicas, las filas siguen saliendo y sync_version_consulta
--    queda NULL. El cliente lo interpreta como "version desconocida" y no
--    bloquea nada; nunca se pierden filas del historial por esta vista.
-- ---------------------------------------------------------------------------
do $vista$
begin
  begin
    execute $sql$
      create or replace view public.vista_pacientes_versionada
      with (security_invoker = on) as
      select v.*, c.sync_version as sync_version_consulta
      from public.vista_pacientes v
      left join public.consultas_clinicas c on c.id = v.id
    $sql$;
  exception when undefined_function or datatype_mismatch or cannot_coerce then
    -- Tipos distintos entre v.id y c.id: se compara como texto.
    execute $sql$
      create or replace view public.vista_pacientes_versionada
      with (security_invoker = on) as
      select v.*, c.sync_version as sync_version_consulta
      from public.vista_pacientes v
      left join public.consultas_clinicas c on c.id::text = v.id::text
    $sql$;
  end;
end
$vista$;

alter view public.vista_pacientes_versionada set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- 4) Permisos.
-- ---------------------------------------------------------------------------
revoke all on public.vista_pacientes_versionada from public, anon;
grant select on public.vista_pacientes_versionada to authenticated;

revoke all on function public.guardar_consulta_clinica_v2(uuid, jsonb, bigint) from public, anon;
grant execute on function public.guardar_consulta_clinica_v2(uuid, jsonb, bigint) to authenticated;

revoke all on function public.guardar_consulta_clinica(uuid, jsonb) from public, anon;
grant execute on function public.guardar_consulta_clinica(uuid, jsonb) to authenticated;

comment on function public.guardar_consulta_clinica_v2(uuid, jsonb, bigint) is
  'Guarda perfil y evaluación clínica con control de versión (40001 si otro equipo editó antes) y revisión previa obligatoria.';

comment on function public.guardar_consulta_clinica(uuid, jsonb) is
  'Envoltorio compatible: toma base_version del payload y delega en guardar_consulta_clinica_v2.';

comment on view public.vista_pacientes_versionada is
  'vista_pacientes + sync_version de la consulta. LEFT JOIN: nunca oculta filas del historial.';

commit;

-- ============================================================================
-- COMPROBACION (solo lectura, ejecutar despues):
--
--   select proname, pg_get_function_identity_arguments(oid) as args
--     from pg_proc
--    where proname in ('guardar_consulta_clinica','guardar_consulta_clinica_v2')
--    order by proname, args;
--
--   select count(*) as revisiones from public.consultas_clinicas_revisiones;
--
--   select id, sync_version_consulta from public.vista_pacientes_versionada limit 5;
-- ============================================================================

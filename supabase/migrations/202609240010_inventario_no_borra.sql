-- ============================================================================
-- 202609240010_inventario_no_borra.sql
-- ============================================================================
-- BUG REAL: al editar un producto del inventario se perdian datos.
--
-- CAUSA
-- upsert_inventario() hacia UPDATE de todas las columnas usando siempre
-- `p_datos ->> 'columna'`. En PostgreSQL el operador ->> devuelve NULL cuando
-- la clave NO existe en el jsonb, asi que CUALQUIER campo que la app no enviara
-- se guardaba como NULL, borrando lo que hubiera.
--
-- Y la app SI omite campos: el formulario de Inventario muestra unos campos
-- segun la categoria y oculta otros.
--   - Editar un armazon   -> no llegan nombre_accesorio, caracteristica ni
--                            material_nota: el servidor los borraba.
--   - Editar un accesorio -> no llegan codigo, tipo_armazon, material, medidas
--                            ni descripcion: el servidor los borraba.
--   - En ambos casos, imagen_url se perdia si no se elegia foto nueva.
--
-- ARREGLO
-- Solo se sobrescribe una columna si su clave viene presente en el payload; si
-- no viene, se conserva el valor actual. Idempotente y sin tocar datos.
-- ============================================================================

begin;

create or replace function public.upsert_inventario(
  p_inventario_id bigint,
  p_datos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_id bigint;
  v_record public.inventario%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Autenticacion requerida.' using errcode = '42501';
  end if;

  if p_inventario_id is null or p_inventario_id <= 0 then
    insert into public.inventario (
      marca, modelo, color, precio, stock, descripcion, categoria, codigo,
      tipo_armazon, param_horizontal, param_puente, param_vertical, param_diagonal,
      nombre_accesorio, caracteristica, material, material_nota, costo_compra,
      imagen_url, param_frontal, param_varillas, client_ref
    ) values (
      p_datos ->> 'marca', p_datos ->> 'modelo', p_datos ->> 'color', p_datos ->> 'precio',
      coalesce((p_datos ->> 'stock')::integer, 0), p_datos ->> 'descripcion',
      p_datos ->> 'categoria', p_datos ->> 'codigo', p_datos ->> 'tipo_armazon',
      p_datos ->> 'param_horizontal', p_datos ->> 'param_puente', p_datos ->> 'param_vertical',
      p_datos ->> 'param_diagonal', p_datos ->> 'nombre_accesorio', p_datos ->> 'caracteristica',
      p_datos ->> 'material', p_datos ->> 'material_nota', p_datos ->> 'costo_compra',
      p_datos ->> 'imagen_url', p_datos ->> 'param_frontal', p_datos ->> 'param_varillas',
      case when p_inventario_id <= 0 then p_inventario_id::text else null end
    ) returning id into v_id;
  else
    -- REGLA: si la clave NO viene en el payload, se conserva el valor actual
    -- en lugar de sobrescribirlo con NULL. Ese era el origen de la perdida.
    update public.inventario
    set stock = case
          when p_datos ? 'stock' and (p_datos ->> 'stock') is not null
            then (p_datos ->> 'stock')::integer
          else stock end,
        marca = case when p_datos ? 'marca' then p_datos ->> 'marca' else marca end,
        modelo = case when p_datos ? 'modelo' then p_datos ->> 'modelo' else modelo end,
        color = case when p_datos ? 'color' then p_datos ->> 'color' else color end,
        precio = case when p_datos ? 'precio' then p_datos ->> 'precio' else precio end,
        descripcion = case when p_datos ? 'descripcion' then p_datos ->> 'descripcion' else descripcion end,
        categoria = case when p_datos ? 'categoria' then p_datos ->> 'categoria' else categoria end,
        codigo = case when p_datos ? 'codigo' then p_datos ->> 'codigo' else codigo end,
        tipo_armazon = case when p_datos ? 'tipo_armazon' then p_datos ->> 'tipo_armazon' else tipo_armazon end,
        param_horizontal = case when p_datos ? 'param_horizontal' then p_datos ->> 'param_horizontal' else param_horizontal end,
        param_puente = case when p_datos ? 'param_puente' then p_datos ->> 'param_puente' else param_puente end,
        param_vertical = case when p_datos ? 'param_vertical' then p_datos ->> 'param_vertical' else param_vertical end,
        param_diagonal = case when p_datos ? 'param_diagonal' then p_datos ->> 'param_diagonal' else param_diagonal end,
        nombre_accesorio = case when p_datos ? 'nombre_accesorio' then p_datos ->> 'nombre_accesorio' else nombre_accesorio end,
        caracteristica = case when p_datos ? 'caracteristica' then p_datos ->> 'caracteristica' else caracteristica end,
        material = case when p_datos ? 'material' then p_datos ->> 'material' else material end,
        material_nota = case when p_datos ? 'material_nota' then p_datos ->> 'material_nota' else material_nota end,
        costo_compra = case when p_datos ? 'costo_compra' then p_datos ->> 'costo_compra' else costo_compra end,
        imagen_url = case when p_datos ? 'imagen_url' then p_datos ->> 'imagen_url' else imagen_url end,
        param_frontal = case when p_datos ? 'param_frontal' then p_datos ->> 'param_frontal' else param_frontal end,
        param_varillas = case when p_datos ? 'param_varillas' then p_datos ->> 'param_varillas' else param_varillas end,
        sync_version = sync_version + 1,
        server_updated_at = now()
    where id = p_inventario_id
    returning id into v_id;

    if v_id is null then
      raise exception 'El producto % no existe.', p_inventario_id using errcode = 'P0002';
    end if;
  end if;

  select * into v_record from public.inventario where id = v_id;
  return jsonb_build_object('servidor_id', v_id, 'inventario', to_jsonb(v_record));
end;
$function$;

comment on function public.upsert_inventario(bigint, jsonb) is
  'Crea o actualiza un producto. Al actualizar solo sobrescribe las columnas cuya clave llega en p_datos; el resto conserva su valor.';

commit;
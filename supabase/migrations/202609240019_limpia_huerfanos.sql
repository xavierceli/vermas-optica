-- ===========================================================================
-- 202609240019_limpia_huerfanos.sql  (version sin lineas en blanco)
-- IMPORTANTE: el SQL Editor de Supabase parte el script por lineas en blanco.
-- Este archivo NO tiene ninguna linea vacia.
-- REQUIERE la migracion 018 aplicada (usa su permiso de borrado controlado).
-- QUE HACE: borra los registros HUERFANOS que dejo la funcion antigua
--   eliminar_paciente_completo: consultas cuyo paciente ya no existe (y sus copias
--   de version), cobros y reembolsos de ventas que ya no existen, y movimientos
--   de stock de ventas que ya no existen. No toca ningun paciente, venta ni
--   consulta que exista.
-- SEGURO CONTRA CAMBIOS: solo borra si las cantidades son EXACTAMENTE las revisadas
--   (20 consultas, 21 cobros/reembolsos, 32 movimientos de stock). Si no coinciden,
--   no borra nada y muestra un mensaje.
-- NO CAMBIA el stock del inventario. IRREVERSIBLE: no hay respaldo del servidor.
-- ===========================================================================
begin;
do $do$
declare
  v_consultas integer;
  v_cobros integer;
  v_movimientos integer;
begin
  if to_regprocedure('public.eliminar_paciente_definitivo(text)') is null then
    raise exception 'Aplica primero la migracion 018. No se borro nada.';
  end if;
  select count(*) into v_consultas from public.consultas_clinicas c where not exists (select 1 from public.pacientes_perfil p where p.id = c.paciente_id);
  select count(*) into v_cobros from public.pagos g where not exists (select 1 from public.pedidos_ventas v where v.id = g.pedido_id);
  select count(*) into v_movimientos from public.inventario_movimientos m where not exists (select 1 from public.pedidos_ventas v where v.id = m.pedido_id);
  if v_consultas <> 20 or v_cobros <> 21 or v_movimientos <> 32 then
    raise exception 'Las cantidades cambiaron desde la revision (consultas %, cobros %, movimientos %). No se borro nada. Avisame.', v_consultas, v_cobros, v_movimientos;
  end if;
  if exists (select 1 from public.pedidos_ventas v where v.consulta_id in (select c.id from public.consultas_clinicas c where not exists (select 1 from public.pacientes_perfil p where p.id = c.paciente_id))) then
    raise exception 'Hay ventas existentes ligadas a consultas huerfanas. No se borro nada. Avisame.';
  end if;
  perform set_config('app.eliminacion_paciente', 'on', true);
  delete from public.consultas_clinicas_revisiones r where r.consulta_id in (select c.id from public.consultas_clinicas c where not exists (select 1 from public.pacientes_perfil p where p.id = c.paciente_id));
  delete from public.inventario_movimientos m where not exists (select 1 from public.pedidos_ventas v where v.id = m.pedido_id);
  delete from public.pagos g where not exists (select 1 from public.pedidos_ventas v where v.id = g.pedido_id);
  delete from public.consultas_clinicas c where not exists (select 1 from public.pacientes_perfil p where p.id = c.paciente_id);
  perform set_config('app.eliminacion_paciente', 'off', true);
end;
$do$;
commit;

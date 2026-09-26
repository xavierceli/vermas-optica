-- ---------------------------------------------------------------------------
-- 202609240003_permisos_lectura.sql
-- La aplicacion lee algunas tablas directamente (el resto va por aplicar_
-- operaciones). Los SELECT ya estaban concedidos en 001, pero en la base real
-- faltaban: la app recibia "permission denied for table pacientes_perfil".
-- Este script LOS RESTITUYE de forma idempotente sin abrir escritura alguna.
-- anon sigue sin privilegios y las escrituras siguen solo por RPC.
-- ---------------------------------------------------------------------------

begin;

-- 1) Lectura directa que la app necesita (vistas y catalogos).
grant select on table public.pacientes_perfil    to authenticated;
grant select on table public.consultas_clinicas  to authenticated;
grant select on table public.pedidos_ventas      to authenticated;
grant select on table public.pagos               to authenticated;
grant select on table public.inventario          to authenticated;
grant select on table public.lista_precios       to authenticated;
grant select on table public.pedido_items        to authenticated;
grant select on table public.inventario_movimientos to authenticated;

-- Las vistas se conceden por el permiso de la vista, no de la tabla base.
grant select on public.vista_pacientes      to authenticated;
grant select on public.vista_pacientes_unicos to authenticated;

-- 2) Ejecucion de las RPCs de negocio. Sin esto PostgREST responde
--    "permission denied for function".
grant execute on function public.aplicar_operaciones(jsonb) to authenticated;
grant execute on function public.anular_venta(uuid) to authenticated;
grant execute on function public.registrar_pago(uuid, uuid, numeric, text, text, text) to authenticated;
grant execute on function public.actualizar_estado_venta(uuid, text) to authenticated;
grant execute on function public.upsert_inventario(bigint, jsonb) to authenticated;
grant execute on function public.eliminar_inventario(bigint) to authenticated;
grant execute on function public.upsert_precio(bigint, jsonb) to authenticated;
grant execute on function public.eliminar_precio(bigint) to authenticated;
grant execute on function public.archivar_consulta(uuid) to authenticated;
grant execute on function public.editar_venta(uuid, uuid, bigint, jsonb) to authenticated;

-- 3) anon NO debe tener nada. Se reafirma por si algo lo concedio antes.
revoke all on table public.pacientes_perfil from anon;
revoke all on table public.consultas_clinicas from anon;
revoke all on table public.pedidos_ventas from anon;
revoke all on table public.pagos from anon;
revoke all on table public.inventario from anon;
revoke all on table public.lista_precios from anon;
revoke all on table public.vista_pacientes from anon;
revoke all on table public.vista_pacientes_unicos from anon;

commit;
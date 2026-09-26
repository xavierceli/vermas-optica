-- ===========================================================================
-- Verificacion de reembolsos. SOLO LECTURA: no modifica nada.
-- Sin lineas en blanco a proposito (el SQL Editor parte por ahi).
-- Debe devolver 5 filas, todas en true.
-- ===========================================================================
select 'columna pagos.tipo' as objeto, (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pagos' and column_name = 'tipo') = 1 as ok;
select 'constraint pagos_tipo_valido' as objeto, exists (select 1 from pg_constraint where conname = 'pagos_tipo_valido') as ok;
select 'indice pagos_pedido_tipo_idx' as objeto, exists (select 1 from pg_indexes where indexname = 'pagos_pedido_tipo_idx') as ok;
select 'rpc reembolsar_pago' as objeto, exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'reembolsar_pago') as ok;
select 'trigger admite reembolso' as objeto, position('reembolsar_pago' in pg_get_functiondef(p.oid)) > 0 as ok from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'bloquear_escritura_directa_pedidos';
select 'despachador acepta REEMBOLSAR_PAGO' as objeto, position('REEMBOLSAR_PAGO' in pg_get_functiondef(p.oid)) > 0 as ok from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'aplicar_operaciones';
select 'cobros historicos como COBRO' as objeto, count(*) filter (where tipo = 'COBRO') as cobros, count(*) filter (where tipo = 'REEMBOLSO') as reembolsos from public.pagos;
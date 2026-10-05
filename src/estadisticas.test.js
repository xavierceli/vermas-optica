import test from 'node:test';
import assert from 'node:assert/strict';
import {
  unificarPedidos, filtrarPedidos, filtrarTarifario,
  calcularEstadisticas, prefijoDelMesActual
} from './estadisticas.js';

// Estas funciones no tenian pruebas: vivian dentro de useGestor.js, que necesita
// un navegador. Aqui se prueban de verdad, y es aqui donde se protege el dinero:
// si una venta se contara dos veces, los ingresos del panel estarian inflados y
// la decision de cerrar el mes se tomaria sobre una cifra falsa.

// --- Unificar las tres fuentes ------------------------------------------------

test('la misma venta en historial y en locales NO se cuenta dos veces', () => {
  // El historial trae la CONSULTA (id distinto); la lista local trae la VENTA.
  // Sin unificacion, el panel sumaria el mismo importe dos veces.
  const resultado = unificarPedidos({
    historial: [{ id: 'c1', pedido_id: 'v1', venta: '100', abono: '0', estado: 'Entregado' }],
    ventasLocales: [{ id: 'v1', pedido_id: 'v1', venta: '100', abono: '0', estado: 'Entregado' }]
  });
  assert.equal(resultado.length, 1, 'debe quedar UNA sola fila');
});

test('se queda con la version mas reciente (la que mas abonado tiene)', () => {
  const resultado = unificarPedidos({
    historial: [{ id: 'v1', pedido_id: 'v1', venta: '100', abono: '0' }],
    ventasLocales: [{ id: 'v1', pedido_id: 'v1', venta: '100', abono: '40' }]
  });
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].abono, 40, 'debe conservar el abono mas alto');
});

test('las ventas de paciente archivado tambien entran', () => {
  const resultado = unificarPedidos({
    historial: [],
    ventasArchivadas: [{ id: 'v9', pedido_id: 'v9', venta: '50', abono: '0' }]
  });
  assert.equal(resultado.length, 1, 'una venta archivada sigue siendo una venta');
});

test('una consulta clinica suelta NO cuenta como venta', () => {
  // Sin pedido_id, sin importe y sin armazon: es una consulta, no una venta.
  const resultado = unificarPedidos({
    historial: [{ id: 'c1', pedido_id: '', venta: '', abono: '0', codigo_armazon: '' }]
  });
  assert.equal(resultado.length, 0, 'una consulta sin venta no debe inflar el panel');
});

test('listas vacias o nulas no rompen nada', () => {
  assert.deepEqual(unificarPedidos(), []);
  assert.deepEqual(unificarPedidos({}), []);
  assert.deepEqual(unificarPedidos({ historial: null, ventasLocales: null }), []);
});

// --- Filtrados ---------------------------------------------------------------

const PEDIDOS = [
  { nombre: 'Juan Perez', cedula: '1712345678' },
  { nombre: 'Maria Lopez', cedula: '0912345678' },
  { nombre: 'CONSUMIDOR FINAL', cedula: '9999999999' }
];

test('filtra por nombre o cedula, sin distinguir mayusculas', () => {
  assert.equal(filtrarPedidos(PEDIDOS, 'lopez').length, 1);
  assert.equal(filtrarPedidos(PEDIDOS, 'MARIA').length, 1);
  assert.equal(filtrarPedidos(PEDIDOS, '1712').length, 1);
});

test('sin termino devuelve la lista completa', () => {
  assert.equal(filtrarPedidos(PEDIDOS, '').length, 3);
  assert.equal(filtrarPedidos(PEDIDOS).length, 3);
});

test('un filtro sin resultados devuelve lista vacia, no un error', () => {
  assert.deepEqual(filtrarPedidos(PEDIDOS, 'zzzz'), []);
});

test('el tarifario se filtra por tipo, material o rango', () => {
  const tarifas = [
    { tipo_lente: 'Monofocal', material: 'Plastico', rango_medida: 'BAJO' },
    { tipo_lente: 'Bifocal', material: 'Policarbonato', rango_medida: 'ALTO' }
  ];
  assert.equal(filtrarTarifario(tarifas, 'bifocal').length, 1);
  assert.equal(filtrarTarifario(tarifas, 'policarb').length, 1);
  assert.equal(filtrarTarifario(tarifas, 'alto').length, 1);
  assert.equal(filtrarTarifario(tarifas, '').length, 2);
});

// --- Estadisticas ------------------------------------------------------------

const MES = '2026-10';

test('suma ingresos y descuenta costos', () => {
  const stats = calcularEstadisticas({
    pedidos: [{ venta: '100', abono: '0', costo_lunas_int: '30', fecha_venta: '2026-10-05', cedula: '171', nombre: 'JUAN' }],
    historial: [],
    mesActual: MES
  });
  assert.equal(stats.ventasTotal, 100);
  assert.equal(stats.gastosTotal, 30);
  assert.equal(stats.utilidadTotal, 70);
});

test('aplica el descuento antes de sumar ingresos', () => {
  const stats = calcularEstadisticas({
    pedidos: [{ venta: '100', descuento: '10', abono: '0', fecha_venta: '2026-10-05', cedula: '171', nombre: 'JUAN' }],
    historial: [], mesActual: MES
  });
  assert.equal(stats.ventasTotal, 90, '100 con 10% de descuento son 90');
});

test('una venta ANULADA no cuenta como ingreso', () => {
  const stats = calcularEstadisticas({
    pedidos: [{ venta: '500', abono: '0', estado: 'Anulado', fecha_venta: '2026-10-05', cedula: '171', nombre: 'JUAN' }],
    historial: [], mesActual: MES
  });
  assert.equal(stats.ventasTotal, 0, 'lo anulado no es dinero cobrado');
});

test('el saldo pendiente suma lo que falta por cobrar', () => {
  const stats = calcularEstadisticas({
    pedidos: [
      { venta: '100', abono: '40', estado: 'Entregado', fecha_venta: '2026-10-01', cedula: '1', nombre: 'A' },
      { venta: '80', abono: '0', estado: 'En laboratorio', fecha_venta: '2026-10-02', cedula: '2', nombre: 'B' }
    ],
    historial: [], mesActual: MES
  });
  assert.equal(stats.abonosPendientes, 140, '60 + 80 pendientes');
});

test('una venta ya pagada no genera saldo pendiente', () => {
  const stats = calcularEstadisticas({
    pedidos: [{ venta: '100', abono: '100', estado: 'Entregado', fecha_venta: '2026-10-01', cedula: '1', nombre: 'A' }],
    historial: [], mesActual: MES
  });
  assert.equal(stats.abonosPendientes, 0);
});

test('el mes actual se separa del historico', () => {
  const stats = calcularEstadisticas({
    pedidos: [
      { venta: '100', abono: '0', fecha_venta: '2026-10-05', cedula: '1', nombre: 'A' },
      { venta: '50', abono: '0', fecha_venta: '2026-09-05', cedula: '2', nombre: 'B' }
    ],
    historial: [], mesActual: MES
  });
  assert.equal(stats.ventasMes, 100, 'solo la de octubre');
  assert.equal(stats.ventasTotal, 150, 'las dos cuentan en el total');
});

test('el consumidor final NO cuenta como paciente', () => {
  const stats = calcularEstadisticas({
    pedidos: [
      { venta: '100', abono: '0', fecha_venta: '2026-10-01', cedula: '9999999999', nombre: 'CONSUMIDOR FINAL' },
      { venta: '50', abono: '0', fecha_venta: '2026-10-01', cedula: '1712345678', nombre: 'JUAN' }
    ],
    historial: [], mesActual: MES
  });
  assert.equal(stats.totalPacientes, 1, 'la cedula 9999999999 no es un paciente');
});

test('cuenta cada paciente una sola vez aunque tenga muchas visitas', () => {
  const stats = calcularEstadisticas({
    pedidos: [],
    historial: [
      { cedula: '1712345678', nombre: 'JUAN' },
      { cedula: '1712345678', nombre: 'JUAN' },
      { cedula: '0911111111', nombre: 'MARIA' }
    ]
  });
  assert.equal(stats.totalPacientes, 2);
  assert.equal(stats.total, 3, 'pero las consultas si se cuentan todas');
});

test('datos raros dan ceros en vez de romper el panel', () => {
  const stats = calcularEstadisticas({ pedidos: null, historial: null });
  assert.equal(stats.ventasTotal, 0);
  assert.equal(stats.totalPacientes, 0);
  assert.deepEqual(calcularEstadisticas(), {
    ventasMes: 0, gastosMes: 0, utilidadNeta: 0,
    ventasTotal: 0, gastosTotal: 0, utilidadTotal: 0,
    abonosPendientes: 0, totalPacientes: 0, total: 0
  });
});

test('el prefijo del mes tiene el formato AAAA-MM', () => {
  assert.equal(prefijoDelMesActual(new Date(2026, 9, 4)), '2026-10');
  assert.equal(prefijoDelMesActual(new Date(2026, 0, 1)), '2026-01');
  assert.equal(prefijoDelMesActual(new Date(2027, 11, 31)), '2027-12');
  assert.match(prefijoDelMesActual(), /^\d{4}-\d{2}$/);
});
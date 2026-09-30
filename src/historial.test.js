import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparPorCedula, filtrarPorTermino, generarDiagnosticos,
  listaSegunBusqueda, resumenConsulta
} from './historial.js';

// Estas reglas estaban dentro del .map() de Historial.jsx (488 lineas de JSX) y
// no habia forma de probarlas. Son reglas de negocio: una de ellas decide si un
// paciente debe dinero y otra escribe el diagnostico que se imprime en la receta.

const consulta = (extra = {}) => ({ id: 1, cedula: '1712345678', nombre: 'ANA', ...extra });

// --- Que debe el paciente -------------------------------------------------
test('una venta viva muestra su saldo pendiente', () => {
  const r = resumenConsulta(consulta({ venta: 100, descuento: 0, abono: 40 }));
  assert.equal(r.total, 100);
  assert.equal(r.saldo, 60);
  assert.equal(r.tieneDeuda, true);
});

test('una venta totalmente pagada no debe nada', () => {
  const r = resumenConsulta(consulta({ venta: 100, descuento: 0, abono: 100 }));
  assert.equal(r.saldo, 0);
  assert.equal(r.tieneDeuda, false);
});

test('el saldo respeta el descuento', () => {
  const r = resumenConsulta(consulta({ venta: 79.2, descuento: 10, abono: 0 }));
  assert.equal(r.total, 71.28, '79.20 con 10% de descuento');
  assert.equal(r.saldo, 71.28);
});

test('texto vacio o nulo no rompe el calculo', () => {
  const r = resumenConsulta({ venta: '', descuento: null, abono: undefined });
  assert.equal(r.total, 0);
  assert.equal(r.tieneDeuda, false);
});

// --- Cuando hay pedido ----------------------------------------------------
test('una consulta clinica SIN venta no aparece como pedido', () => {
  // El servidor le asigna el estado 'En laboratorio' por defecto, y eso hacia que
  // una consulta sola apareciera en Pedidos con monto $0.
  const r = resumenConsulta(consulta({ pedido_id: '', venta: 0, codigo_armazon: '', accesorio_id: '' }));
  assert.equal(r.tienePedido, false);
});

test('con venta, armazon o accesorio SÍ hay pedido', () => {
  assert.equal(resumenConsulta(consulta({ venta: 50 })).tienePedido, true);
  assert.equal(resumenConsulta(consulta({ pedido_id: 'abc' })).tienePedido, true);
  assert.equal(resumenConsulta(consulta({ codigo_armazon: 'AR-1' })).tienePedido, true);
  assert.equal(resumenConsulta(consulta({ accesorio_id: '7' })).tienePedido, true);
});

test('un pedido_id con solo espacios NO cuenta como pedido', () => {
  assert.equal(resumenConsulta(consulta({ pedido_id: '   ' })).tienePedido, false);
});

// --- Una tarjeta por paciente --------------------------------------------
test('agrupa por cedula y se queda con la consulta mas reciente', () => {
  // La lista llega ordenada por fecha descendente, asi que gana la primera.
  const filas = [
    consulta({ id: 'nueva', fecha: '2026-09-28' }),
    consulta({ id: 'vieja', fecha: '2025-01-10' })
  ];
  const agrupados = agruparPorCedula(filas);
  assert.equal(agrupados.length, 1, 'una sola tarjeta por paciente');
  assert.equal(agrupados[0].id, 'nueva');
});

test('pacientes distintos NO se mezclan', () => {
  const agrupados = agruparPorCedula([
    consulta({ cedula: '111', nombre: 'ANA' }),
    consulta({ cedula: '222', nombre: 'PEDRO' })
  ]);
  assert.equal(agrupados.length, 2);
});

test('CONSUMIDOR FINAL nunca sale en una tarjeta', () => {
  const agrupados = agruparPorCedula([
    consulta({ cedula: '9999999999', nombre: 'CONSUMIDOR FINAL' }),
    consulta({ cedula: '111', nombre: 'ANA' })
  ]);
  assert.equal(agrupados.length, 1);
  assert.equal(agrupados[0].nombre, 'ANA');
});

test('sin termino se ve el historial entero', () => {
  const { hayTermino, lista } = listaSegunBusqueda({ busquedaTexto: '  ', historial: [consulta()] });
  assert.equal(hayTermino, false);
  assert.equal(lista.length, 1);
});

test('un resultado que llega de otra busqueda se descarta', () => {
  // Si el usuario teclea otra cosa mientras llega la respuesta lenta, no se
  // pueden pintar los datos de la busqueda anterior.
  const { lista } = listaSegunBusqueda({
    busquedaTexto: 'nuevo',
    resultados: { termino: 'viejo', datos: [consulta()] },
    historial: []
  });
  assert.deepEqual(lista, []);
});

test('el buscador local filtra por cedula, nombre y alias', () => {
  const filas = [
    consulta({ cedula: '0750577042', nombre: 'PRUEBA', alias: 'Vecino' }),
    consulta({ cedula: '111', nombre: 'ANA RUIZ', alias: '' })
  ];
  assert.equal(filtrarPorTermino(filas, '07505').length, 1);
  assert.equal(filtrarPorTermino(filas, 'ana ru').length, 1);
  assert.equal(filtrarPorTermino(filas, 'vecino').length, 1);
  assert.equal(filtrarPorTermino(filas, 'a').length, 0, 'con una sola letra no busca');
});

// --- Diagnostico (dato clinico) ------------------------------------------
test('esfera negativa: miopia', () => {
  assert.deepEqual(generarDiagnosticos({ esfera_od: -1.25 }), ['Miopía (H52.1)']);
});

test('esfera positiva: hipermetropia', () => {
  assert.deepEqual(generarDiagnosticos({ esfera_od: 1.5 }), ['Hipermetropía (H52.0)']);
});

test('cilindro distinto de cero: astigmatismo', () => {
  assert.deepEqual(generarDiagnosticos({ cilindro_od: -0.75 }), ['Astigmatismo (H52.2)']);
});

test('adicion positiva: presbicia', () => {
  assert.deepEqual(generarDiagnosticos({ adicion_od: 2 }), ['Presbicia (H52.4)']);
});

test('si los dos ojos coinciden, el diagnostico NO se repite', () => {
  const d = generarDiagnosticos({ esfera_od: -1.25, esfera_oi: -2 });
  assert.deepEqual(d, ['Miopía (H52.1)'], 'un solo item en el informe, no dos iguales');
});

test('una refraccion plana no inventa diagnosticos', () => {
  assert.deepEqual(generarDiagnosticos({ esfera_od: 0, cilindro_od: 0, adicion_od: 0 }), []);
  assert.deepEqual(generarDiagnosticos({}), []);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparPorCedula, filtrarPorTermino, generarDiagnosticos,
  listaSegunBusqueda, resumenConsulta, tieneRefraccion, unaTarjetaPorCedula
} from './historial.js';

// Estas reglas estaban dentro del .map() de Historial.jsx (488 lineas de JSX) y
// no habia forma de probarlas. Son reglas de negocio: una de ellas decide si un
// paciente debe dinero y otra escribe el diagnostico que se imprime en la receta.

const consulta = (extra = {}) => ({ id: 1, cedula: '1712345678', nombre: 'ANA', ...extra });

test('un dato antiguo no convertible no hace fallar las reglas del historial', () => {
  const raro = Object.create(null);
  assert.doesNotThrow(() => agruparPorCedula([consulta({ nombre: raro })]));
  assert.deepEqual(filtrarPorTermino([consulta({ nombre: raro })], 'ana'), []);
  assert.equal(resumenConsulta(consulta({ venta: raro })).total, 0);
  assert.doesNotThrow(() => agruparPorCedula([{ id: raro }]));
});

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

// --- Que visita enseña la tarjeta del historial ----------------------------
// BUG REAL, reportado por el optometria con una captura: la tarjeta de un
// paciente ensenaba la tabla de refraccion con guiones y un "No hay pedido
// registrado en esta fecha", mientras que "Ver Evolucion" si desplegaba los
// valores. No faltaba el dato: la tarjeta se quedaba con la visita mas
// reciente, que era un control sin receta, y la Rx estaba en la anterior.

test('una consulta de control SIN receta no tapa la ultima Rx real', () => {
  const filas = [
    consulta({ id: 'control', fecha: '2026-09-30', notas_clinicas: 'Solo control', estado: 'En laboratorio', codigo_armazon: 'XC9502' }),
    consulta({ id: 'con-rx', fecha: '2026-03-02', esfera_od: '-1.25', cilindro_od: '-0.50', eje_od: '180' })
  ];
  const [tarjeta] = unaTarjetaPorCedula(filas);
  // Lo COMERCIAL es de la ultima visita: es lo que se acaba de hacer.
  assert.equal(tarjeta.codigo_armazon, 'XC9502', 'el armazon debe ser el de la ultima visita');
  assert.equal(tarjeta.estado, 'En laboratorio');
  // La RECETA viene de la ultima visita que la tenia, aunque sea mas antigua.
  assert.equal(tarjeta.esfera_od, '-1.25', 'la receta debe ser la ultima que existe');
  assert.equal(tarjeta.cilindro_od, '-0.50');
  assert.equal(tarjeta.eje_od, '180');
  // Y se dice de que fecha es, para no hacer pasar una receta vieja por nueva.
  assert.equal(tarjeta.fecha_receta, '2026-03-02');
  assert.equal(tarjeta.fecha, '2026-09-30', 'la fecha de la tarjeta es la de la ultima visita');
});

test('una Rx nueva SI tapa una Rx antigua, y sin marcar fecha aparte', () => {
  // Si la ultima visita trae receta, esa es la ultima receta: no hace falta
  // distinguirla de la fecha de la tarjeta.
  const filas = [
    consulta({ id: 'nueva', fecha: '2026-09-27', esfera_od: '-2.00' }),
    consulta({ id: 'anterior', fecha: '2025-01-10', esfera_od: '-1.00' })
  ];
  const [tarjeta] = unaTarjetaPorCedula(filas);
  assert.equal(tarjeta.id, 'nueva');
  assert.equal(tarjeta.esfera_od, '-2.00', 'la receta mas reciente gana');
  assert.equal(tarjeta.fecha_receta, '2026-09-27');
});

test('si ninguna visita tiene receta, gana la mas reciente', () => {
  // Mejor una tabla con guiones, con la fecha de la ultima visita, que una
  // tarjeta anclada en una consulta antigua que el optometria no reconoce.
  const filas = [
    consulta({ id: 'reciente', fecha: '2026-09-27' }),
    consulta({ id: 'antigua', fecha: '2024-01-01' })
  ];
  const [tarjeta] = unaTarjetaPorCedula(filas);
  assert.equal(tarjeta.id, 'reciente');
});

test('un cero es una receta: el paciente con esfera 0.00 tambien cuenta', () => {
  // Si el cero se tratara como "vacio", un paciente con esfera 0.00 perderia su
  // ultima Rx en la tarjeta.
  assert.equal(tieneRefraccion({ esfera_od: 0, cilindro_od: 0 }), true);
  assert.equal(tieneRefraccion({ esfera_od: '   ' }), false);
  assert.equal(tieneRefraccion({}), false);
  assert.equal(tieneRefraccion(null), false);
});

test('solo se agrupan las consultas del MISMO paciente', () => {
  const filas = [
    consulta({ id: 'a1', cedula: '1712345678', fecha: '2026-09-27', estado: 'En laboratorio' }),
    consulta({ id: 'b1', cedula: '0912345678', fecha: '2026-09-28', estado: 'Entregado' }),
    consulta({ id: 'a2', cedula: '1712345678', fecha: '2026-01-01', esfera_od: '-1.00' })
  ];
  const tarjetas = unaTarjetaPorCedula(filas);
  assert.equal(tarjetas.length, 2, 'una tarjeta por paciente');
  const a = tarjetas.find(t => t.cedula === '1712345678');
  const b = tarjetas.find(t => t.cedula === '0912345678');
  assert.equal(a.estado, 'En laboratorio', 'comercial de la visita mas reciente');
  assert.equal(a.esfera_od, '-1.00', 'receta de la visita que la tenia');
  assert.equal(b.estado, 'Entregado', 'el otro paciente no se mezcla');
});

test('el buscador de la pantalla usa la MISMA regla que el historial', () => {
  // Estaban las dos reglas por separado y no tenian por que coincidir: la
  // buscador podia enseñar una cosa y la lista otra, para la misma paciente.
  const filas = [
    consulta({ id: 'control', fecha: '2026-09-27', estado: 'En laboratorio' }),
    consulta({ id: 'con-rx', fecha: '2026-03-02', esfera_od: '-1.25' })
  ];
  const tarjeta = agruparPorCedula(filas)[0];
  assert.equal(tarjeta.esfera_od, '-1.25', 'el buscador enseña la receta igual que el historial');
  assert.equal(tarjeta.estado, 'En laboratorio', 'y el comercial de la ultima visita');
});

test('fusionar no pisa el armazon de la ultima venta con el de una anterior', () => {
  // El bug del armazon persistente, en la parte de la tarjeta: al fusionar la
  // receta de una visita antigua, sus campos COMERCIES no deben colarse.
  const filas = [
    consulta({ id: 'reciente', fecha: '2026-09-30', estado: 'En laboratorio', venta: '68' }),
    consulta({ id: 'vieja', fecha: '2025-01-01', esfera_od: '-1.00', codigo_armazon: 'XC9502', venta: '200', estado: 'Entregado' })
  ];
  const [tarjeta] = unaTarjetaPorCedula(filas);
  assert.equal(tarjeta.venta, '68', 'el importe debe ser el de la ultima venta');
  assert.equal(tarjeta.estado, 'En laboratorio');
  assert.equal(tarjeta.esfera_od, '-1.00', 'pero la receta si se conserva');
});

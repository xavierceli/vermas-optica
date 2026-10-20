// ---------------------------------------------------------------------------
// CLIC EN "VER+ OPTICA" = RECARGAR SIN PERDER TRABAJO
// ---------------------------------------------------------------------------
// Antes de recargar se comprueba si hay algo escrito: la app no guarda
// borradores en el disco, asi que lo que esta en el formulario se pierde.
// Tambien se busca la version nueva del service worker para que la recarga
// muestre la ultima version y no la copia guardada por la PWA.
// ---------------------------------------------------------------------------
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearEstadoPaciente, INV_INICIAL, PRECIO_INICIAL } from './fichaClinica.js';
import {
  hayDatosEscritos,
  tieneTrabajoSinGuardar,
  prepararVersionNueva,
  actualizarPagina
} from './recarga.js';

const fichaVacia = () => crearEstadoPaciente('2026-01-01');

test('una ficha recien creada no cuenta como trabajo sin guardar', () => {
  assert.equal(hayDatosEscritos(fichaVacia(), fichaVacia()), false);
});

test('en cuanto se escribe un dato, la ficha cuenta como trabajo sin guardar', () => {
  assert.equal(hayDatosEscritos({ ...fichaVacia(), nombre: 'ANA PEREZ' }, fichaVacia()), true);
  assert.equal(hayDatosEscritos({ ...fichaVacia(), esfera_od: '-1.00' }, fichaVacia()), true);
});

test('abrir una ficha guardada (id, paciente_id) no dispara el aviso', () => {
  const guardada = { ...fichaVacia(), id: 'abc', paciente_id: 'def', pedido_id: 'ghi' };
  assert.equal(hayDatosEscritos(guardada, fichaVacia()), false);
});

test('la fecha que pone la app sola no dispara el aviso', () => {
  // Si la app queda abierta de un dia para otro, la ficha nueva trae otra fecha.
  assert.equal(
    hayDatosEscritos({ ...fichaVacia(), fecha: '2026-02-02' }, { ...fichaVacia(), fecha: '2026-02-01' }),
    false
  );
});

test('en las listas no hay nada que perder', () => {
  assert.equal(tieneTrabajoSinGuardar({ vistaActual: 'historial', paciente: fichaVacia() }), false);
  assert.equal(tieneTrabajoSinGuardar({ vistaActual: 'dashboard' }), false);
});

test('la consulta clinica solo avisa si hay algun dato escrito', () => {
  assert.equal(tieneTrabajoSinGuardar({
    vistaActual: 'nueva_medicion', paciente: fichaVacia(), estadoInicial: fichaVacia()
  }), false);

  assert.equal(tieneTrabajoSinGuardar({
    vistaActual: 'nueva_medicion',
    paciente: { ...fichaVacia(), cedula: '1712345678' },
    estadoInicial: fichaVacia()
  }), true);
});

test('la orden de trabajo abierta siempre se protege', () => {
  assert.equal(tieneTrabajoSinGuardar({ vistaActual: 'pedidos_form', pedidoSeleccionado: null }), false);
  assert.equal(tieneTrabajoSinGuardar({ vistaActual: 'pedidos_form', pedidoSeleccionado: { id: 'v1' } }), true);
});

test('inventario y tarifario avisan si hay un producto o precio empezado', () => {
  assert.equal(tieneTrabajoSinGuardar({
    vistaActual: 'inventario', nuevoItemInv: { ...INV_INICIAL }
  }), false);
  assert.equal(tieneTrabajoSinGuardar({
    vistaActual: 'inventario', nuevoItemInv: { ...INV_INICIAL, codigo: 'ARM-01' }
  }), true);
  assert.equal(tieneTrabajoSinGuardar({
    vistaActual: 'inventario', nuevoItemInv: { ...INV_INICIAL }, editandoInvId: 'abc'
  }), true);

  assert.equal(tieneTrabajoSinGuardar({
    vistaActual: 'precios', nuevoPrecio: { ...PRECIO_INICIAL }, precioInicial: PRECIO_INICIAL
  }), false);
  assert.equal(tieneTrabajoSinGuardar({
    vistaActual: 'precios', nuevoPrecio: { ...PRECIO_INICIAL, rango_medida: '0 a 2' }, precioInicial: PRECIO_INICIAL
  }), true);
});

test('sin version nueva se recarga enseguida', async () => {
  let recargas = 0;
  const resultado = await actualizarPagina({
    recargar: () => { recargas += 1; },
    obtenerServiceWorker: () => ({
      getRegistration: async () => ({ waiting: null, installing: null, update: async () => {} })
    })
  });

  assert.equal(resultado, 'recargado');
  assert.equal(recargas, 1);
});

test('sin service worker (desarrollo) tambien recarga', async () => {
  let recargas = 0;
  const resultado = await actualizarPagina({
    recargar: () => { recargas += 1; },
    obtenerServiceWorker: () => null
  });

  assert.equal(resultado, 'recargado');
  assert.equal(recargas, 1);
});

test('con trabajo escrito y el usuario cancelando, NO se recarga', async () => {
  let recargas = 0;
  let salidaPermitida = false;
  const resultado = await actualizarPagina({
    trabajoSinGuardar: true,
    confirmar: async () => false,
    recargar: () => { recargas += 1; },
    marcarSalidaPermitida: () => { salidaPermitida = true; }
  });

  assert.equal(resultado, 'cancelado');
  assert.equal(recargas, 0);
  assert.equal(salidaPermitida, false);
});

test('con trabajo escrito y sin dialogo disponible, tampoco se recarga', async () => {
  let recargas = 0;
  const resultado = await actualizarPagina({
    trabajoSinGuardar: true,
    recargar: () => { recargas += 1; }
  });

  assert.equal(resultado, 'cancelado');
  assert.equal(recargas, 0);
});

test('si el usuario acepta, se recarga y el navegador ya no vuelve a preguntar', async () => {
  let recargas = 0;
  let salidaPermitida = false;
  const resultado = await actualizarPagina({
    trabajoSinGuardar: true,
    confirmar: async () => true,
    recargar: () => { recargas += 1; },
    marcarSalidaPermitida: () => { salidaPermitida = true; }
  });

  assert.equal(resultado, 'recargado');
  assert.equal(recargas, 1);
  assert.equal(salidaPermitida, true);
});

test('con una version esperando, se activa y se recarga para estrenarla', async () => {
  const mensajes = [];
  let recargas = 0;
  const registro = {
    waiting: { postMessage: (m) => mensajes.push(m) },
    update: async () => { throw new Error('no deberia actualizar si ya hay una esperando'); }
  };

  const resultado = await actualizarPagina({
    obtenerServiceWorker: () => ({ getRegistration: async () => registro }),
    recargar: () => { recargas += 1; },
    programar: (fn) => fn()
  });

  assert.equal(resultado, 'actualizando');
  assert.deepEqual(mensajes, [{ type: 'SKIP_WAITING' }]);
  assert.equal(recargas, 1);
});

test('prepararVersionNueva espera a que termine de instalarse la version nueva', async () => {
  let alCambiarEstado = null;
  const instalando = {
    state: 'installing',
    addEventListener: (_evento, fn) => { alCambiarEstado = fn; }
  };
  const registro = {
    waiting: null,
    installing: instalando,
    update: async () => {}
  };

  const preparada = prepararVersionNueva(registro, 1000);
  await new Promise(resolver => setTimeout(resolver, 0)); // deja pasar el update()
  instalando.state = 'installed';
  alCambiarEstado();

  assert.equal(await preparada, true);
});

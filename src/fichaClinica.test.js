import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPOS_DE_VENTA, INV_INICIAL, PRECIO_INICIAL, TRATAMIENTOS,
  aplicarCedula, crearEstadoPaciente, hoyISO
} from './fichaClinica.js';

// Al teclear la cedula de un paciente que ya existe, la ficha se reemplaza por
// la guardada. Si aqui se equivoca un campo, se pierde una consulta entera.
// Estos tests fijan el comportamiento y, sobre todo, dos garantias que antes no
// existian: que la ficha siempre trae TODOS los campos del formulario y que
// ningun campo de dinero o nota del paciente anterior sobreviva.

const HOY = '2026-09-28';
const fichaVacia = () => crearEstadoPaciente(HOY);

// Campos que se restablecen a un valor concreto (no a texto vacio).
const RESETEADOS = ['descuento', 'forma_pago', 'estado'];
const CAMPOS_ELEGIBLES = /^(venta|abono|notas|notas_clinicas|pago_nota|comprobante_url|costo_\w+|tratam_\w+_nota)$/;

test('el formulario vacio trae todos sus valores por defecto', () => {
  const ficha = fichaVacia();
  assert.match(ficha.fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(ficha.descuento, '0');
  assert.equal(ficha.forma_pago, 'Efectivo');
  assert.equal(ficha.estado, 'Ninguno');
  for (const casilla of TRATAMIENTOS) assert.equal(ficha[casilla], 'NO', casilla);
  assert.ok(Object.keys(ficha).length > 100, 'el formulario tiene mas de 100 campos');
  assert.equal(INV_INICIAL.categoria, 'Armazon');
  assert.equal(PRECIO_INICIAL.tipo_lente, 'Monofocal');
});

test('hoyISO devuelve la fecha local en formato AAAA-MM-DD', () => {
  assert.match(hoyISO(), /^\d{4}-\d{2}-\d{2}$/);
});

// --- Garantia 1: ningun campo de dinero sobrevive -------------------------
test('todo campo de dinero o nota del formulario se limpia al cambiar de paciente', () => {
  const sucios = Object.keys(fichaVacia())
    .filter(campo => CAMPOS_ELEGIBLES.test(campo))
    .filter(campo => !CAMPOS_DE_VENTA.includes(campo) && !RESETEADOS.includes(campo));
  assert.deepEqual(
    sucios,
    [],
    'estos campos se copiarian del paciente anterior y se le cobrarian: ' + sucios.join(', ')
  );
});

test('todos los campos de la lista de venta existen en el formulario', () => {
  // Un nombre mal escrito en la lista crearia un campo nuevo y NO limpiaria el
  // de verdad: el fallo seria invisible.
  const inexistentes = CAMPOS_DE_VENTA.filter(campo => !(campo in fichaVacia()));
  assert.deepEqual(inexistentes, [], 'nombres que no existen en la ficha: ' + inexistentes.join(', '));
});
// --- Comportamiento -------------------------------------------------------
const PACIENTE_TECLEANDO = { ...crearEstadoPaciente(HOY), esfera_od: '-1.25', notas_clinicas: 'Miopia alta' };

test('una cedula incompleta NO borra lo que ya se tecleo', () => {
  const { ficha, encontro } = aplicarCedula({
    paciente: PACIENTE_TECLEANDO, valor: '1712', historial: [{ cedula: '1712345678', nombre: 'ANA' }], hoy: HOY
  });
  assert.equal(encontro, false);
  assert.equal(ficha.esfera_od, '-1.25');
  assert.equal(ficha.notas_clinicas, 'Miopia alta');
  assert.equal(ficha.cedula, '1712');
});

test('una cedula que no existe en el historial NO borra el formulario', () => {
  const { ficha, encontro } = aplicarCedula({
    paciente: PACIENTE_TECLEANDO, valor: '0999999999', historial: [{ cedula: '1712345678', nombre: 'ANA' }], hoy: HOY
  });
  assert.equal(encontro, false);
  assert.equal(ficha.esfera_od, '-1.25');
});

test('el paciente que ya existe trae su ultima ficha, pero con la venta en cero', () => {
  const historial = [{
    id: 7, pedido_id: 3, cedula: '1712345678', nombre: 'ANA', fecha: '2020-01-01',
    esfera_od: -1.25, cilindro_od: null,
    venta: '120', abono: '50', descuento: '10', forma_pago: 'Transferencia', estado: 'Pagado',
    comprobante_url: 'comprobante_1.jpg', notas_clinicas: 'Control yearly',
    codigo_armazon: 'AR-1', costo_armazon_int: '30', tratam_foto: 'SI', tratam_foto_nota: 'Gris'
  }];
  const { ficha, encontro } = aplicarCedula({
    paciente: fichaVacia(), valor: '1712345678', historial, hoy: HOY
  });

  assert.equal(encontro, true);
  // Se trae la clinica...
  assert.equal(ficha.nombre, 'ANA');
  assert.equal(ficha.esfera_od, -1.25);
  // ...y se abre una consulta nueva: sin id, sin pedido y con la fecha de hoy.
  assert.equal(ficha.id, '');
  assert.equal(ficha.pedido_id, '');
  assert.equal(ficha.fecha, HOY);
  // La venta anterior NO se copia.
  assert.equal(ficha.venta, '');
  assert.equal(ficha.abono, '');
  assert.equal(ficha.comprobante_url, '');
  assert.equal(ficha.codigo_armazon, '');
  assert.equal(ficha.costo_armazon_int, '');
  assert.equal(ficha.notas_clinicas, '');
  assert.equal(ficha.tratam_foto_nota, '');
  assert.equal(ficha.descuento, '0');
  assert.equal(ficha.forma_pago, 'Efectivo');
  assert.equal(ficha.estado, 'Ninguno');
  for (const casilla of TRATAMIENTOS) assert.equal(ficha[casilla], 'NO', casilla);
});

test('nunca se trae la ficha de CONSUMIDOR FINAL', () => {
  const { ficha, encontro } = aplicarCedula({
    paciente: PACIENTE_TECLEANDO,
    valor: '9999999999',
    historial: [{ cedula: '9999999999', nombre: 'CONSUMIDOR FINAL', esfera_od: -9 }],
    hoy: HOY
  });
  assert.equal(encontro, false);
  assert.equal(ficha.esfera_od, '-1.25', 'no debe traer la ficha del consumidor final');
});

// --- Garantia 2: la ficha nunca queda incompleta --------------------------
test('traer la ficha de un paciente NO deja campos en null ni sin valor', () => {
  // El fallo que motivo este modulo: la base devuelve null en los campos que
  // el paciente no tiene medido y el input se quedaba con null.
  const historial = [{ id: 7, cedula: '1712345678', nombre: 'ANA', esfera_od: null, avcl_od: undefined }];
  const { ficha } = aplicarCedula({ paciente: fichaVacia(), valor: '1712345678', historial, hoy: HOY });

  for (const campo of Object.keys(fichaVacia())) {
    assert.ok(campo in ficha, 'falta el campo ' + campo);
    assert.notEqual(ficha[campo], null, campo + ' quedo en null');
    assert.notEqual(ficha[campo], undefined, campo + ' quedo undefined');
  }
  assert.equal(ficha.esfera_od, '');
});

test('una cedula con espacios de mas tambien encuentra al paciente', () => {
  const { encontro } = aplicarCedula({
    paciente: fichaVacia(),
    valor: '1712345678 ',
    historial: [{ cedula: '1712345678', nombre: 'ANA' }],
    hoy: HOY
  });
  assert.equal(encontro, true);
});
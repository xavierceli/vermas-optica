import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CAMPOS_DE_VENTA, CLAVES_ACEPTADAS, INV_INICIAL, PRECIO_INICIAL, TRATAMIENTOS,
  aplicarCedula, buscarCoincidenciasPacientes, crearEstadoPaciente, hoyISO
} from './fichaClinica.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)));
const leer = nombre => readFileSync(join(SRC, nombre), 'utf8');

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
    paciente: PACIENTE_TECLEANDO, value: '1712', historial: [{ cedula: '1712345678', nombre: 'ANA' }], hoy: HOY
  });
  assert.equal(encontro, false);
  assert.equal(ficha.esfera_od, '-1.25');
  assert.equal(ficha.notas_clinicas, 'Miopia alta');
  assert.equal(ficha.cedula, '1712');
});

test('una cedula que no existe en el historial NO borra el formulario', () => {
  const { ficha, encontro } = aplicarCedula({
    paciente: PACIENTE_TECLEANDO, value: '0999999999', historial: [{ cedula: '1712345678', nombre: 'ANA' }], hoy: HOY
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
    paciente: fichaVacia(), value: '1712345678', historial, hoy: HOY
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
    value: '9999999999',
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
  const { ficha } = aplicarCedula({ paciente: fichaVacia(), value: '1712345678', historial, hoy: HOY });

  for (const campo of Object.keys(fichaVacia())) {
    assert.ok(campo in ficha, 'falta el campo ' + campo);
    assert.notEqual(ficha[campo], null, campo + ' quedo en null');
    assert.notEqual(ficha[campo], undefined, campo + ' quedo undefined');
  }
  assert.equal(ficha.esfera_od, '');
});

// --- El buscador de pacientes ---------------------------------------------
// Fallo real: los resultados de la nube se guardaban en un estado que nunca se
// volcaba a la lista visible, asi que en Clinica un paciente que no estuviera
// descargado en el dispositivo no aparecia nunca (aunque en el Historial, que
// si consulta la nube, se encontraba).
test('el buscador incluye los pacientes que solo estan en la nube', () => {
  const encontrados = buscarCoincidenciasPacientes({
    locales: [{ cedula: '1111111111', nombre: 'LOCAL' }],
    nube: [{ cedula: '0750577042', nombre: 'PRUEBA' }],
    texto: '0750577'
  });
  assert.deepEqual(encontrados.map(p => p.nombre), ['PRUEBA']);
});

test('el buscador encuentra por cedula, por nombre y por alias', () => {
  const lista = [
    { cedula: '0750577042', nombre: 'PRUEBA', alias: 'Vecino' },
    { cedula: '1111111111', nombre: 'ANA RUIZ', alias: '' }
  ];
  assert.equal(buscarCoincidenciasPacientes({ locales: lista, texto: '07505' }).length, 1);
  assert.equal(buscarCoincidenciasPacientes({ locales: lista, texto: 'ana ru' }).length, 1);
  assert.equal(buscarCoincidenciasPacientes({ locales: lista, texto: 'vecino' }).length, 1);
});

test('el buscador nunca ofrece CONSUMIDOR FINAL', () => {
  const encontrados = buscarCoincidenciasPacientes({
    locales: [{ cedula: '9999999999', nombre: 'CONSUMIDOR FINAL' }],
    texto: '999999'
  });
  assert.deepEqual(encontrados, []);
});

test('el buscador no repite un paciente que esta en la nube y en local', () => {
  const encontrados = buscarCoincidenciasPacientes({
    locales: [{ id: 'l', cedula: '0750577042', nombre: 'PRUEBA' }],
    nube: [{ id: 'n', cedula: '0750577042', nombre: 'PRUEBA' }],
    texto: '0750577042'
  });
  assert.equal(encontrados.length, 1, 'la version de la nube es la buena');
  assert.equal(encontrados[0].id, 'n');
});

test('con menos de dos letras no busca nada', () => {
  assert.deepEqual(buscarCoincidenciasPacientes({ locales: [{ cedula: '111', nombre: 'A' }], texto: '1' }), []);
});

// --- El contrato entre useGestor y esta funcion --------------------------
test('useGestor le pasa a aplicarCedula los NOMBRES que la funcion entiende', () => {
  // Fallo real: la funcion esperaba `valor` y el hook le pasaba `value`. Nada
  // reventaba, los tests de la funcion pasaban, y el resultado era que el
  // optometria NO PUEDE ESCRIBIR la cedula (llegaba undefined y el input se
  // quedaba vacio). Este test compara los dos lados de la llamada.
  const fuente = leer('useGestor.js');
  const llamada = /aplicarCedula\(\{([\s\S]*?)\}\)/.exec(fuente);
  assert.ok(llamada, 'debe existir la llamada a aplicarCedula en useGestor');

  const claves = llamada[1]
    .split(',')
    .map(parte => parte.split(':')[0].trim())
    .filter(Boolean);
  assert.ok(claves.length > 0, 'la llamada debe pasar alguna clave');

  for (const clave of claves) {
    assert.ok(
      CLAVES_ACEPTADAS.includes(clave),
      `aplicarCedula no entiende "${clave}": se perderia en silencio y el `
      + `optometria no podria escribir la cedula. Acepta: ${CLAVES_ACEPTADAS.join(', ')}`
    );
  }
});

test('una cedula que llega como undefined no borra nada ni rompe', () => {
  // Guarda de seguridad: si alguien rompe el contrato otra vez, el formulario
  // al menos no se queda con campos en undefined.
  const { ficha, encontro } = aplicarCedula({ paciente: PACIENTE_TECLEANDO, historial: [], hoy: HOY });
  assert.equal(encontro, false);
  assert.equal(ficha.esfera_od, '-1.25');
});

test('una cedula con espacios de mas tambien encuentra al paciente', () => {
  const { encontro } = aplicarCedula({
    paciente: fichaVacia(),
    value: '1712345678 ',
    historial: [{ cedula: '1712345678', nombre: 'ANA' }],
    hoy: HOY
  });
  assert.equal(encontro, true);
});
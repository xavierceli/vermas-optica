import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarFichaClinica,
  documentoValido,
  motivoDocumentoInvalido,
  construirMensajeFaltantes,
  refraccionFaltante,
  medidasOrdenFaltantes,
  CAMPOS_DE_LA_ORDEN,
  ETIQUETAS_CAMPOS
} from './validacion.js';

// Bugs reales que estos tests fijan:
//  1) Se podia guardar una ficha clinica con solo cedula y SIN NOMBRE. La venta
//     de ese paciente fallaba despues con "El nombre del paciente es obligatorio".
//  2) El mensaje de validacion decia "FALTAN DATOS" sin decir QUE campo, y con 18
//     campos de refraccion el usuario no tenia forma de saber cual faltaba.

const refraccionCompleta = () => {
  const base = {};
  for (const campo of Object.keys(ETIQUETAS_CAMPOS)) base[campo] = '0.00';
  return base;
};

const fichaValida = () => ({
  cedula: '1712345678',
  nombre: 'MARIA FERNANDEZ',
  ...refraccionCompleta()
});

test('una ficha completa es valida', () => {
  const r = validarFichaClinica(fichaValida());
  assert.equal(r.ok, true);
  assert.equal(r.mensaje, null);
});

test('NO se puede guardar una ficha sin nombre', () => {
  // Este es el bug principal: antes la cédula era suficiente.
  const r = validarFichaClinica({ ...fichaValida(), nombre: '' });
  assert.equal(r.ok, false, 'una ficha sin nombre debe rechazarse');
  assert.match(r.mensaje, /nombre/i);
});

test('NO se puede guardar una ficha sin cedula', () => {
  const r = validarFichaClinica({ ...fichaValida(), cedula: '' });
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /c[eé]dula/i);
});

test('se reportan TODOS los problemas a la vez, no solo el primero', () => {
  // Si solo reportara el primero, el usuario corregiria uno, guardaria, y
  // descubriria el siguiente. Era un ciclo de varios intentos.
  const r = validarFichaClinica({ cedula: '', nombre: '' });
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /c[eé]dula/i);
  assert.match(r.mensaje, /nombre/i);
});

test('el mensaje nombra los campos de refraccion que faltan', () => {
  const ficha = fichaValida();
  delete ficha.esfera_od;
  ficha.eje_oi = '';
  const r = validarFichaClinica(ficha);
  assert.equal(r.ok, false);
  assert.equal(r.sinRefraccion.length, 2);
  assert.match(r.mensaje, /Esfera OD/);
  assert.match(r.mensaje, /Eje OI/);
});

test('con muchos campos faltantes el mensaje los resume', () => {
  const r = validarFichaClinica({ cedula: '1712345678', nombre: 'TEST' });
  assert.equal(r.ok, false);
  assert.equal(r.sinRefraccion.length, 18);
  // Con 18 campos enumerarlos todos saturaria la pantalla.
  assert.match(r.mensaje, /18 datos de refracci[oó]n/);
  assert.match(r.mensaje, /y 12 m[aá]s/);
});

test('el documento valido depende del formato', () => {
  assert.equal(documentoValido('1712345678'), true, 'cedula de 10 digitos');
  assert.equal(documentoValido('1712345678901'), true, 'cedula de 13 digitos');
  assert.equal(documentoValido('9999999999'), true, 'consumidor final');
  assert.equal(documentoValido('AB1234'), true, 'pasaporte');
  assert.equal(documentoValido(''), false);
  assert.equal(documentoValido('123'), false, 'muy corto');
  assert.equal(documentoValido('17123456789'), false, '11 digitos: ni cedula ni pasaporte');
  assert.equal(documentoValido('ABCDE'), false, 'solo letras, sin digitos: no es un documento');
  assert.equal(documentoValido('PASAPORTE123'), true, '12 caracteres: dentro del limite de 20');
  assert.equal(documentoValido('ABCDEFGHIJKLMNOPQRSTU1'), false, '21 caracteres: excede el limite');
  assert.equal(documentoValido('AB12CD'), true, 'letras y digitos: pasaporte valido');
});

test('el motivo explica por que falla el documento', () => {
  assert.match(motivoDocumentoInvalido(''), /falta la c[eé]dula/i);
  assert.match(motivoDocumentoInvalido('123'), /no es v[aá]lida/i);
  assert.equal(motivoDocumentoInvalido('1712345678'), null);
});

test('un espacio en blanco no cuenta como nombre', () => {
  const r = validarFichaClinica({ ...fichaValida(), nombre: '   ' });
  assert.equal(r.ok, false, 'solo espacios no es un nombre');
});

test('sin faltantes no hay mensaje', () => {
  assert.equal(construirMensajeFaltantes([]), null);
});

// --- Que falte exactamente, y en el orden de la tabla ----------------------
// La pantalla de la consulta avisa en vivo "faltan 3" y lleva al primero que
// falta. Si esta lista no coincidiera con la validacion, el aviso enganaria al
// optometra: diria "completa" y el guardado lo rechazaria (o al reves).
test('una ficha vacia tiene los 18 datos de refraccion pendientes', () => {
  const faltan = refraccionFaltante({});
  assert.equal(faltan.length, 18);
  assert.equal(faltan[0].campo, 'avsl_od');
  assert.equal(faltan[0].etiqueta, 'AVS Lejos OD');
  assert.equal(faltan[faltan.length - 1].campo, 'avcc_oi');
});

test('el orden de la lista es el de la tabla (OD antes que OI)', () => {
  const campos = refraccionFaltante({}).map(f => f.campo);
  assert.ok(campos.indexOf('esfera_od') < campos.indexOf('esfera_oi'));
  assert.deepEqual(campos.slice(0, 2), ['avsl_od', 'avsc_od']);
});

test('solo se listan los que estan vacios, y los espacios no cuentan', () => {
  const paciente = refraccionCompleta();
  delete paciente.eje_od;
  paciente.dnp_oi = '   ';
  assert.deepEqual(
    refraccionFaltante(paciente).map(f => f.campo),
    ['eje_od', 'dnp_oi']
  );
});

test('una ficha completa no tiene faltantes', () => {
  assert.deepEqual(refraccionFaltante(refraccionCompleta()), []);
});

test('el aviso y la validacion cuentan lo MISMO', () => {
  const aMedias = { ...refraccionCompleta(), eje_od: '', avcc_oi: '' };
  const aviso = refraccionFaltante(aMedias);
  const validacion = validarFichaClinica({ cedula: '1712345678', nombre: 'ANA', ...aMedias });
  assert.equal(aviso.length, validacion.sinRefraccion.length);
  assert.deepEqual(aviso.map(f => f.etiqueta), validacion.sinRefraccion);
  assert.equal(validacion.ok, false, 'con datos de refraccion vacios no se guarda');
});

// --- Medidas de la ORDEN (lo que imprime el laboratorio) -------------------
// La venta no se bloquea (un armazon no lleva receta), pero la pantalla avisa.
// Lo que se imprime son las 5 medidas por ojo, no las agudezas visuales.
test('una orden sin nada escrito tiene las 10 medidas pendientes', () => {
  const faltan = medidasOrdenFaltantes({});
  assert.equal(faltan.length, 10);
  assert.equal(faltan[0].campo, 'esfera_od');
  assert.equal(faltan[0].etiqueta, 'Esfera OD');
  assert.equal(faltan[faltan.length - 1].campo, 'dnp_oi');
  // Son las mismas etiquetas que ve el optometra en la consulta.
  assert.ok(faltan.every(f => ETIQUETAS_CAMPOS[f.campo] === f.etiqueta));
});

test('la orden ignora lo que no imprime (agudezas visuales)', () => {
  const campos = CAMPOS_DE_LA_ORDEN;
  assert.ok(!campos.includes('avsl_od'), 'AVS Lejos no va en la orden');
  assert.ok(!campos.includes('avcc_oi'));
  assert.ok(!campos.includes('altura_od'), 'la altura se pide aparte, solo si hay adicion');
});

test('con la mitad escrita solo faltan las que quedan, y los espacios no cuentan', () => {
  const pedido = {};
  for (const campo of CAMPOS_DE_LA_ORDEN) pedido[campo] = '0';
  pedido.eje_od = '';
  pedido.dnp_oi = '   ';
  assert.deepEqual(
    medidasOrdenFaltantes(pedido).map(f => f.campo),
    ['eje_od', 'dnp_oi']
  );
});

test('medidas completas: ni un aviso', () => {
  const pedido = {};
  for (const campo of CAMPOS_DE_LA_ORDEN) pedido[campo] = '0.00';
  assert.deepEqual(medidasOrdenFaltantes(pedido), []);
});

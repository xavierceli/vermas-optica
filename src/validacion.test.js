import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarFichaClinica,
  documentoValido,
  motivoDocumentoInvalido,
  construirMensajeFaltantes,
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
  assert.match(r.mensaje, /cedula/i);
});

test('se reportan TODOS los problemas a la vez, no solo el primero', () => {
  // Si solo reportara el primero, el usuario corregiria uno, guardaria, y
  // descubriria el siguiente. Era un ciclo de varios intentos.
  const r = validarFichaClinica({ cedula: '', nombre: '' });
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /cedula/i);
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
  assert.match(r.mensaje, /18 datos de refraccion/);
  assert.match(r.mensaje, /y 12 mas/);
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
  assert.match(motivoDocumentoInvalido(''), /falta la cedula/i);
  assert.match(motivoDocumentoInvalido('123'), /no es valida/i);
  assert.equal(motivoDocumentoInvalido('1712345678'), null);
});

test('un espacio en blanco no cuenta como nombre', () => {
  const r = validarFichaClinica({ ...fichaValida(), nombre: '   ' });
  assert.equal(r.ok, false, 'solo espacios no es un nombre');
});

test('sin faltantes no hay mensaje', () => {
  assert.equal(construirMensajeFaltantes([]), null);
});

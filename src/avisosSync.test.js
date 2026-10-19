import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cuandoSube,
  textoColaPendiente,
  textoVentaPendiente,
  textoConsultaPendiente,
  textoFotoPendiente,
  textoComprobantePendiente
} from './avisosSync.js';

// BUG REAL: con el PIN local activo (modo sin conexión) la app decía "se subirá
// al recuperar conexión" o "en unos segundos". Era falso: sin sesión no se sube
// nada aunque haya internet. El usuario esperaba sentado una subida que solo
// ocurre al iniciar sesión.

test('sin sesión el aviso manda a iniciar sesión, no a esperar la conexión', () => {
  assert.equal(cuandoSube(true), 'al iniciar sesión');
});

test('con sesión y sin internet el aviso sigue hablando de la conexión', () => {
  assert.equal(cuandoSube(false), 'al recuperar conexión');
});

test('sin sesión, ningún aviso de guardado promete subida automática', () => {
  const avisos = [textoVentaPendiente, textoConsultaPendiente, textoFotoPendiente, textoComprobantePendiente];
  for (const aviso of avisos) {
    assert.match(aviso(true), /al iniciar sesión/, `debe mandar a iniciar sesión: ${aviso(true)}`);
    assert.doesNotMatch(aviso(true), /conexión|segundos/, `no debe hablar de la conexión: ${aviso(true)}`);
  }
});

test('con sesión los avisos conservan su promesa original', () => {
  assert.equal(textoVentaPendiente(false), 'Venta guardada localmente. Se subirá al recuperar conexión.');
  assert.equal(textoConsultaPendiente(false), 'Consulta guardada en este dispositivo. Se subirá a la nube en unos segundos.');
  assert.equal(textoFotoPendiente(false), 'Producto guardado. La fotografía se subirá a la nube al recuperar conexión.');
  assert.equal(textoComprobantePendiente(false), 'Comprobante guardado localmente. Se subirá al recuperar conexión.');
});

test('la barra de estado anuncia la cola con el motivo correcto', () => {
  assert.equal(textoColaPendiente(true), 'Se subirán al iniciar sesión');
  assert.equal(textoColaPendiente(false), 'Se subirán al recuperar conexión');
});

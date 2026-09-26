import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrolarDispositivo,
  leerEnrolamiento,
  estaEnrolado,
  intentarDesbloqueo,
  revocarEnrolamiento,
  pinValido,
  generarSal,
  calcularHuella,
  MAX_INTENTOS,
  ITERACIONES_PBKDF2
} from './seguridad.js';

// Emula la tabla meta de Dexie: clave primaria "key" y el dato dentro de "value".
// Asi la prueba reproduce el mismo contrato que la base real.
const crearMeta = () => {
  const filas = new Map();
  return {
    put: async fila => {
      if (!fila?.key) throw new Error('meta.put exige la clave primaria "key"');
      filas.set(fila.key, fila);
    },
    get: async key => filas.get(key),
    delete: async key => { filas.delete(key); }
  };
};

test('el PIN nunca se guarda, solo su huella con sal', async () => {
  const meta = crearMeta();
  await enrolarDispositivo({ pin: '4821', identidad: 'admin@vermas', meta });
  const enrolamiento = await leerEnrolamiento(meta);

  assert.ok(enrolamiento.huella, 'debe guardar una huella');
  assert.ok(enrolamiento.sal, 'debe guardar una sal');
  const guardado = JSON.stringify(enrolamiento);
  assert.equal(guardado.includes('4821'), false, 'el PIN no debe aparecer en ningun campo');
  assert.equal(enrolamiento.identidad, 'admin@vermas');
});

test('dos dispositivos con el mismo PIN tienen huellas distintas', async () => {
  const metaA = crearMeta();
  const metaB = crearMeta();
  await enrolarDispositivo({ pin: '1111', meta: metaA });
  await enrolarDispositivo({ pin: '1111', meta: metaB });
  const a = await leerEnrolamiento(metaA);
  const b = await leerEnrolamiento(metaB);
  assert.notEqual(a.sal, b.sal, 'cada enrolamiento usa una sal distinta');
  assert.notEqual(a.huella, b.huella, 'la huella depende de la sal');
});

test('el PIN correcto desbloquea y el incorrecto no', async () => {
  const meta = crearMeta();
  await enrolarDispositivo({ pin: '7391', identidad: 'admin', meta });

  const mal = await intentarDesbloqueo({ pin: '7392', meta });
  assert.equal(mal.ok, false);
  assert.equal(mal.restantes, MAX_INTENTOS - 1);

  const bien = await intentarDesbloqueo({ pin: '7391', meta });
  assert.equal(bien.ok, true);
  assert.equal(bien.identidad, 'admin');
});

test('tras un acierto se reinicia el contador de intentos', async () => {
  const meta = crearMeta();
  await enrolarDispositivo({ pin: '7391', meta });
  await intentarDesbloqueo({ pin: '0000', meta });
  await intentarDesbloqueo({ pin: '0000', meta });
  await intentarDesbloqueo({ pin: '7391', meta });
  const siguiente = await intentarDesbloqueo({ pin: '0000', meta });
  assert.equal(siguiente.restantes, MAX_INTENTOS - 1, 'el contador debe volver a cero tras acertar');
});

test('al agotar los intentos se bloquea, se borra el enrolamiento y se limpia el dispositivo', async () => {
  const meta = crearMeta();
  await enrolarDispositivo({ pin: '7391', meta });
  let limpio = 0;
  const alBloquear = async () => { limpio += 1; };

  let ultimo;
  for (let i = 0; i < MAX_INTENTOS; i += 1) ultimo = await intentarDesbloqueo({ pin: '0000', meta, alBloquear });

  assert.equal(ultimo.ok, false);
  assert.equal(ultimo.bloqueado, true);
  assert.equal(await estaEnrolado(meta), false, 'el enrolamiento debe desaparecer tras el bloqueo');
  assert.ok(limpio >= 1, 'debe ejecutarse la limpieza del dispositivo');
});

test('tras el bloqueo el dispositivo queda sin acceso sin conexion', async () => {
  const meta = crearMeta();
  await enrolarDispositivo({ pin: '7391', meta });
  for (let i = 0; i < MAX_INTENTOS; i += 1) await intentarDesbloqueo({ pin: '0000', meta });

  // El bloqueo borra el enrolamiento: el dispositivo queda como recien salido
  // de fabrica y ni el PIN correcto puede reabrirlo.
  assert.equal(await estaEnrolado(meta), false, 'el enrolamiento debe eliminarse');
  const tras = await intentarDesbloqueo({ pin: '7391', meta, alBloquear: async () => {} });
  assert.equal(tras.ok, false, 'ni con el PIN correcto se regain acceso');
  assert.match(tras.error, /no tiene acceso/i);
});

test('un dispositivo no enrolado no se puede desbloquear', async () => {
  const resultado = await intentarDesbloqueo({ pin: '1234', meta: crearMeta() });
  assert.equal(resultado.ok, false);
  assert.match(resultado.error, /no tiene acceso/i);
});

test('se rechazan PINs con formato invalido', () => {
  assert.equal(pinValido('1234'), true);
  assert.equal(pinValido('12345678'), true);
  assert.equal(pinValido('123'), false);
  assert.equal(pinValido('123456789'), false);
  assert.equal(pinValido('abcd'), false);
  assert.equal(pinValido(''), false);
  assert.equal(pinValido(null), false);
});

test('rechaza enrolar un PIN invalido', async () => {
  await assert.rejects(() => enrolarDispositivo({ pin: '12', meta: crearMeta() }), /4 y 8/);
});

test('la huella es determinista con la misma sal', async () => {
  const sal = generarSal();
  assert.equal(await calcularHuella('7391', sal), await calcularHuella('7391', sal));
  assert.notEqual(await calcularHuella('7391', sal), await calcularHuella('7392', sal));
});

test('se puede revocar el acceso sin conexion', async () => {
  const meta = crearMeta();
  await enrolarDispositivo({ pin: '7391', meta });
  assert.equal(await estaEnrolado(meta), true);
  await revocarEnrolamiento(meta);
  assert.equal(await estaEnrolado(meta), false);
});

test('usa PBKDF2 con las iteraciones recomendadas por OWASP', () => {
  assert.ok(ITERACIONES_PBKDF2 >= 210000, 'debe usar al menos 210000 iteraciones');
  assert.ok(globalThis.crypto?.subtle, 'WebCrypto debe estar disponible');
});

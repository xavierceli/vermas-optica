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

test('al agotar los intentos se bloquea SIN borrar el enrolamiento ni los datos', async () => {
  const meta = crearMeta();
  await enrolarDispositivo({ pin: '7391', meta });
  let avisos = 0;
  const alBloquear = async () => { avisos += 1; };

  let ultimo;
  for (let i = 0; i < MAX_INTENTOS; i += 1) ultimo = await intentarDesbloqueo({ pin: '0000', meta, alBloquear });

  assert.equal(ultimo.ok, false);
  assert.equal(ultimo.bloqueado, true);
  assert.ok(avisos >= 1, 'debe avisar al usuario');
  // Este es el punto del cambio: bloquear el acceso frena la fuerza bruta, pero
  // NO puede costarle el trabajo al optometra. Borrar el enrolamiento (y con el
  // la base local) solo destruia datos a cambio de nada.
  assert.equal(await estaEnrolado(meta), true, 'el enrolamiento debe sobrevivir al bloqueo');
});

test('durante la espera el PIN correcto tambien es rechazado', async () => {
  const meta = crearMeta();
  await enrolarDispositivo({ pin: '7391', meta });
  for (let i = 0; i < MAX_INTENTOS; i += 1) await intentarDesbloqueo({ pin: '0000', meta });

  const duranteEspera = await intentarDesbloqueo({ pin: '7391', meta, alBloquear: async () => {} });
  assert.equal(duranteEspera.ok, false, 'aun con el PIN correcto no se entra durante la espera');
  assert.equal(duranteEspera.bloqueado, true);
  assert.ok(duranteEspera.minutos > 0, 'debe informar de los minutos restantes');
});

test('vencida la espera se concede una oportunidad nueva y el PIN correcto funciona', async () => {
  const meta = crearMeta();
  await enrolarDispositivo({ pin: '7391', meta });
  for (let i = 0; i < MAX_INTENTOS; i += 1) await intentarDesbloqueo({ pin: '0000', meta });

  // Se simula el paso del tiempo sin esperar 15 minutos reales.
  const fila = (await meta.get('dispositivoEnrolado')).value;
  await meta.put({
    key: 'dispositivoEnrolado',
    value: { ...fila, bloqueadoHasta: Date.now() - 1000 },
    updatedAt: new Date().toISOString()
  });

  const trasEspera = await intentarDesbloqueo({ pin: '7391', meta, alBloquear: async () => {} });
  assert.equal(trasEspera.ok, true, 'el PIN correcto debe funcionar una vez vencida la espera');
  assert.equal(trasEspera.identidad ?? null, null);
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

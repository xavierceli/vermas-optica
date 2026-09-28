// ---------------------------------------------------------------------------
// ACCESO SIN CONEXION (PIN local del dispositivo)
// El acceso offline NO es autenticacion: no genera ningun token de Supabase y
// no da permiso sobre el servidor. Solo desbloquea los datos que YA estan en este
// dispositivo, y la sincronizacion queda suspendida hasta que haya una sesion
// real. Si alguien obtiene el PIN gana acceso a los datos locales de este
// dispositivo, nada mas.
// La clave nunca se guarda: se guarda PBKDF2(sal + PIN) con SHA-256.
// ---------------------------------------------------------------------------

const ITERACIONES = 210000; // Recomendacion OWASP para PBKDF2-SHA256
export const MAX_INTENTOS = 5;
const CLAVE_META = 'dispositivoEnrolado';

const aBase64 = bytes => {
  if (typeof btoa === 'function') {
    let binario = '';
    bytes.forEach(byte => { binario += String.fromCharCode(byte); });
    return btoa(binario);
  }
  // Solo en Node (pruebas). En el navegador nunca se llega aqui.
  return globalThis.Buffer.from(bytes).toString('base64');
};

const desdeBase64 = texto => {
  if (typeof atob === 'function') {
    const binario = atob(texto);
    return Uint8Array.from(binario, caracter => caracter.charCodeAt(0));
  }
  return new Uint8Array(globalThis.Buffer.from(texto, 'base64'));
};

const requireWebCrypto = () => {
  const webcrypto = globalThis.crypto;
  if (!webcrypto?.subtle) {
    throw new Error('Este dispositivo no permite cifrar el acceso local. Usa https:// o localhost.');
  }
  return webcrypto;
};

export const generarSal = () => {
  const webcrypto = requireWebCrypto();
  return aBase64(webcrypto.getRandomValues(new Uint8Array(16)));
};

export const calcularHuella = async (pin, sal) => {
  const webcrypto = requireWebCrypto();
  const clave = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(pin)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: desdeBase64(sal), iterations: ITERACIONES, hash: 'SHA-256' },
    clave,
    256
  );
  return aBase64(new Uint8Array(bits));
};

// Comparacion de tiempo constante: evita filtrar el PIN caracter a caracter.
const comparar = (a, b) => {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i += 1) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
};

export const MINIMO_PIN = 4;
export const ITERACIONES_PBKDF2 = ITERACIONES;

export const pinValido = pin => /^\d{4,8}$/.test(String(pin || '').trim());

export const enrolarDispositivo = async ({ pin, identidad, meta }) => {
  if (!pinValido(pin)) throw new Error('El PIN debe tener entre 4 y 8 digitos.');
  const sal = generarSal();
  const huella = await calcularHuella(String(pin).trim(), sal);
  await meta.put({
    key: CLAVE_META,
    value: { sal, huella, identidad: identidad || null, intentosFallidos: 0, enroladoEn: new Date().toISOString() },
    updatedAt: new Date().toISOString()
  });
  return true;
};

export const leerEnrolamiento = async meta => (await meta.get(CLAVE_META))?.value || null;

export const estaEnrolado = async meta => Boolean(await leerEnrolamiento(meta));

// Tiempo de espera tras agotar los intentos. Antes de este cambio, el quinto
// fallo BORRABA la base de datos local entera (ver useGestor.js: alBloquear).
// Eso no era seguridad: un atacante que ya leyo los datos no gana nada, y en
// cambio un error de tecleo o un colega probando el teclado destruia la semana
// de trabajo sin sincronizar. Ahora el bloqueo frena la fuerza bruta (el PIN es
// de 4 a 8 digitos) y el trabajo legitimo del optometra queda intacto.
export const MINUTOS_BLOQUEO = 15;
const MS_BLOQUEO = MINUTOS_BLOQUEO * 60 * 1000;

/**
 * Intenta desbloquear. Devuelve
 * { ok: true }
 * | { ok: false, restantes }
 * | { ok: false, bloqueado: true, minutos }
 */
export const intentarDesbloqueo = async ({ pin, meta, alBloquear }) => {
  const enrolamiento = await leerEnrolamiento(meta);
  if (!enrolamiento) return { ok: false, error: 'Este dispositivo no tiene acceso sin conexion configurado.' };

  const ahora = Date.now();

  // Dentro de la ventana de espera no entra ni el PIN correcto.
  if (enrolamiento.bloqueadoHasta && ahora < enrolamiento.bloqueadoHasta) {
    const minutos = Math.max(1, Math.ceil((enrolamiento.bloqueadoHasta - ahora) / 60000));
    return { ok: false, bloqueado: true, minutos };
  }

  // Vencida la espera el contador vuelve a cero, pero el PIN se comprueba en el
  // MISMO intento. Reiniciar primero y preguntar despues desperdiciaria el
  // primer intento del optometra justo cuando por fin puede volver a entrar.
  const intentosPrevios = enrolamiento.bloqueadoHasta
    ? 0
    : (enrolamiento.intentosFallidos || 0);

  const huella = await calcularHuella(String(pin ?? '').trim(), enrolamiento.sal);
  if (comparar(huella, enrolamiento.huella)) {
    // OJO: la fila de meta siempre va envuelta en { key, value }. Escribir el
    // objeto plano borra el key y deja el enrolamiento ilegible para el
    // siguiente intento (y con el, el acceso sin conexion del dispositivo).
    await meta.put({
      key: CLAVE_META,
      value: { ...enrolamiento, intentosFallidos: 0, bloqueadoHasta: null },
      updatedAt: new Date().toISOString()
    });
    return { ok: true, identidad: enrolamiento.identidad };
  }

  const intentosFallidos = intentosPrevios + 1;
  const restantes = MAX_INTENTOS - intentosFallidos;

  if (restantes <= 0) {
    // Se bloquea el acceso, pero NO se borra ni el enrolamiento ni los datos:
    // alBloquear solo informa al usuario.
    await meta.put({
      key: CLAVE_META,
      value: { ...enrolamiento, intentosFallidos, bloqueadoHasta: ahora + MS_BLOQUEO },
      updatedAt: new Date().toISOString()
    });
    if (alBloquear) await alBloquear();
    return { ok: false, bloqueado: true, minutos: MINUTOS_BLOQUEO };
  }

  await meta.put({
    key: CLAVE_META,
    value: { ...enrolamiento, intentosFallidos, bloqueadoHasta: null },
    updatedAt: new Date().toISOString()
  });
  return { ok: false, restantes };
};

export const revocarEnrolamiento = async meta => {
  await meta.delete(CLAVE_META);
  return true;
};
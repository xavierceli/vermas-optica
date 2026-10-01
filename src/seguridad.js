// ---------------------------------------------------------------------------
// ACCESO SIN CONEXION (PIN local del dispositivo)
// ---------------------------------------------------------------------------
// El acceso offline NO es autenticación de servidor: no genera tokens de
// Supabase ni otorga permisos sobre la API remota. Desbloquea de forma segura
// los datos locales persistidos en este dispositivo bajo PBKDF2(sal + PIN)
// con SHA-256 (210,000 iteraciones según recomendaciones OWASP).
// ---------------------------------------------------------------------------

const ITERACIONES = 210000;
export const MAX_INTENTOS = 5;
const CLAVE_META = 'dispositivoEnrolado';

const aBase64 = bytes => {
  if (typeof btoa === 'function') {
    let binario = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i += 1) {
      binario += String.fromCharCode(bytes[i]);
    }
    return btoa(binario);
  }
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

// Comparación de tiempo constante contra ataques de temporización
const comparar = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i += 1) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferencia === 0;
};

export const MINIMO_PIN = 4;
export const ITERACIONES_PBKDF2 = ITERACIONES;

export const pinValido = pin => /^\d{4,8}$/.test(String(pin || '').trim());

export const enrolarDispositivo = async ({ pin, identidad, meta }) => {
  if (!pinValido(pin)) throw new Error('El PIN debe tener entre 4 y 8 dígitos numéricos.');
  const sal = generarSal();
  const huella = await calcularHuella(String(pin).trim(), sal);
  await meta.put({
    key: CLAVE_META,
    value: { 
      sal, 
      huella, 
      identidad: identidad || null, 
      intentosFallidos: 0, 
      bloqueadoHasta: null,
      enroladoEn: new Date().toISOString() 
    },
    updatedAt: new Date().toISOString()
  });
  return true;
};

export const leerEnrolamiento = async meta => (await meta.get(CLAVE_META))?.value || null;

export const estaEnrolado = async meta => Boolean(await leerEnrolamiento(meta));

export const MINUTOS_BLOQUEO = 15;
const MS_BLOQUEO = MINUTOS_BLOQUEO * 60 * 1000;

/**
 * Procesa el intento de desbloqueo mediante PIN.
 * Devuelve:
 *  - { ok: true, identidad }
 *  - { ok: false, restantes }
 *  - { ok: false, bloqueado: true, minutos }
 */
export const intentarDesbloqueo = async ({ pin, meta, alBloquear }) => {
  const enrolamiento = await leerEnrolamiento(meta);
  if (!enrolamiento) return { ok: false, error: 'Este dispositivo no tiene acceso sin conexión configurado.' };

  const ahora = Date.now();

  // 1. Verificación de ventana activa de bloqueo
  if (enrolamiento.bloqueadoHasta && ahora < enrolamiento.bloqueadoHasta) {
    const minutos = Math.max(1, Math.ceil((enrolamiento.bloqueadoHasta - ahora) / 60000));
    return { ok: false, bloqueado: true, minutos };
  }

  // 2. Si la ventana de bloqueo ya expiró, reinicia el contador de intentos
  const bloqueoExpirado = Boolean(enrolamiento.bloqueadoHasta && ahora >= enrolamiento.bloqueadoHasta);
  const intentosPrevios = bloqueoExpirado ? 0 : (enrolamiento.intentosFallidos || 0);

  const huella = await calcularHuella(String(pin ?? '').trim(), enrolamiento.sal);
  
  if (comparar(huella, enrolamiento.huella)) {
    await meta.put({
      key: CLAVE_META,
      value: { ...enrolamiento, intentosFallidos: 0, bloqueadoHasta: null },
      updatedAt: new Date().toISOString()
    });
    return { ok: true, identidad: enrolamiento.identidad };
  }

  // 3. Manejo de fallo de PIN
  const intentosFallidos = intentosPrevios + 1;
  const restantes = MAX_INTENTOS - intentosFallidos;

  if (restantes <= 0) {
    await meta.put({
      key: CLAVE_META,
      value: { ...enrolamiento, intentosFallidos, bloqueadoHasta: ahora + MS_BLOQUEO },
      updatedAt: new Date().toISOString()
    });
    if (typeof alBloquear === 'function') await alBloquear();
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
// ---------------------------------------------------------------------------
// REGLAS DE NEGOCIO COMPARTIDAS
// ---------------------------------------------------------------------------
// Fuente única de verdad para las reglas clínicas, financieras y de pricing.
// El cálculo comercial replica con exactitud de centavo la función de PostgreSQL:
// round(venta - venta * descuento / 100, 2)
// ---------------------------------------------------------------------------

// A partir de 47.00 D se considera queratometría alta (límite inclusivo).
export const LIMITE_QUERATOMETRIA = 47;
export const AVISO_QUERATOMETRIA = 'QUERATOMETRIAS ALTAS';

const aNumero = valor => {
  if (valor === null || valor === undefined || valor === '') return NaN;
  try {
    return Number(String(valor).trim().replace(',', '.'));
  } catch {
    return NaN;
  }
};

// --- Clínica ---------------------------------------------------------------

/** ¿El valor indicado en un campo de queratometría supera el límite clínico? */
export const esQueratometriaAlta = (registro, campo) => {
  const valor = aNumero(registro?.[campo]);
  return Number.isFinite(valor) && valor >= LIMITE_QUERATOMETRIA;
};

/** ¿Alguno de los meridianos principales (K1/K2) del ojo indicado es alto? */
export const ojoConQueratometriaAlta = (registro, ojo) => ['k1_d_', 'k2_d_']
  .some(campo => esQueratometriaAlta(registro, `${campo}${ojo}`));

/**
 * Devuelve una copia del registro con el aviso agregado en las observaciones
 * del ojo sin sobreescribir lo escrito por el especialista.
 */
export const aplicarAvisoQueratometria = (registro, ojo) => {
  const claveObs = `obs_k_${ojo}`;
  const textoActual = String(registro?.[claveObs] ?? '').trim();
  const tieneAviso = textoActual.toUpperCase().includes(AVISO_QUERATOMETRIA);

  if (ojoConQueratometriaAlta(registro, ojo)) {
    if (tieneAviso) return registro;
    const siguiente = { ...registro };
    siguiente[claveObs] = textoActual ? `${textoActual}\n${AVISO_QUERATOMETRIA}` : AVISO_QUERATOMETRIA;
    return siguiente;
  }

  if (tieneAviso && textoActual === AVISO_QUERATOMETRIA) {
    const siguiente = { ...registro };
    siguiente[claveObs] = '';
    return siguiente;
  }
  return registro;
};

// --- Pricing y Finanzas ----------------------------------------------------

const ESCALA = 1000000n; // 6 decimales de precisión intermedia

/** Convierte a número devolviendo 0 ante valores vacíos o no numéricos. */
export const aMonto = valor => {
  const parsed = aNumero(valor);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Acota el porcentaje de descuento al rango válido (0 a 100). */
export const normalizarDescuento = descuento => {
  const base = aMonto(descuento);
  return Math.min(100, Math.max(0, base));
};

/** Escala un monto a entero de 6 decimales para evitar imprecisión de coma flotante. */
const aEscala = valor => {
  const numero = aMonto(valor);
  if (!Number.isFinite(numero)) return 0n;
  return BigInt(Math.round(numero * 1e6));
};

/** División entera redondeando como PostgreSQL: .5 hacia arriba. */
const dividirRedondeando = (dividendo, divisor) => {
  const entero = dividendo / divisor;
  const resto = dividendo % divisor;
  return resto * 2n >= divisor ? entero + 1n : entero;
};

/** Redondea a 2 decimales emulando round(numeric, 2) de PostgreSQL. */
const redondearSql = valorEscalado => {
  const negativo = valorEscalado < 0n;
  const absoluto = negativo ? -valorEscalado : valorEscalado;
  const centavos = dividirRedondeando(absoluto, ESCALA / 100n);
  const conSigno = negativo ? -centavos : centavos;
  return Number(conSigno) / 100;
};

/**
 * Total a pagar = venta - venta * descuento / 100.
 * Utiliza enteros escalados (BigInt) para evitar desajustes de centavos con la base de datos.
 */
export const calcularTotal = (venta, descuento) => {
  const base = aEscala(venta);
  const porcentaje = aEscala(normalizarDescuento(descuento));
  const descuentoEscalado = dividirRedondeando(base * porcentaje, 100n * ESCALA);
  return redondearSql(base - descuentoEscalado);
};

/** Monto líquido del descuento otorgado. */
export const calcularMontoDescuento = (venta, descuento) => {
  const total = calcularTotal(venta, descuento);
  const monto = Number((aMonto(venta) - total).toFixed(2));
  return monto > 0 ? monto : 0;
};

/**
 * Saldo pendiente = total - abono.
 * Evita que imprecisiones de coma flotante devuelvan -0.00.
 */
export const calcularSaldo = (venta, descuento, abono) => {
  const saldo = Number((calcularTotal(venta, descuento) - aMonto(abono)).toFixed(2));
  return Math.abs(saldo) < 0.0001 ? 0 : saldo;
};

/**
 * Determina si un error corresponde a pérdida de conectividad o rechazo de servidor.
 */
export const esFalloDeRed = (error) => {
  const texto = String(error?.message || error || '').toLowerCase();
  
  // Errores de lógica de negocio, autenticación o restricciones del servidor
  if (/rechaz|rechazo|violat|constraint|duplicate key|foreign key|401|403|409|400|42501|pgrst/.test(texto)) {
    return false;
  }

  // Pérdida física de conectividad, caídas de DNS o timeouts
  return /failed to fetch|network|load failed|aborted|tiempo agotado|timeout|conexion|conexión|dns|socket|502|503|504|offline|err_|internet connection/i.test(texto)
    || error?.name === 'TypeError';
};
/**
 * Revisa el valor de la venta y el descuento con las mismas reglas del servidor:
 * venta >= 0, descuento entre 0 y 100, y como maximo dos decimales en ambos.
 * Los campos vacios cuentan como 0. Devuelve el mensaje del problema, o null si todo esta bien.
 */
export const validarMontosVenta = ({ venta, descuento } = {}) => {
  const dosDecimales = n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
  const vacio = v => v === null || v === undefined || String(v).trim() === '';

  if (!vacio(venta)) {
    const n = aNumero(venta);
    if (!Number.isFinite(n)) return 'El valor de la venta no es un número válido.';
    if (n < 0) return 'El valor de la venta no puede ser negativo.';
    if (!dosDecimales(n)) return 'El valor de la venta admite como máximo dos decimales.';
  }
  if (!vacio(descuento)) {
    const d = aNumero(descuento);
    if (!Number.isFinite(d)) return 'El descuento no es un número válido.';
    if (d < 0 || d > 100) return 'El descuento debe estar entre 0 y 100.';
    if (!dosDecimales(d)) return 'El descuento admite como máximo dos decimales.';
  }
  return null;
};
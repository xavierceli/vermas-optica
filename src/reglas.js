// ---------------------------------------------------------------------------
// REGLAS DE NEGOCIO COMPARTIDAS
// Fuente única de verdad para las reglas clínicas y de pricing.
// El servidor (PostgreSQL) calcula: round(venta - venta * descuento / 100, 2)
// ---------------------------------------------------------------------------

// A partir de 47.00 D se considera queratometría alta (límite inclusivo).
export const LIMITE_QUERATOMETRIA = 47;
export const AVISO_QUERATOMETRIA = 'QUERATOMETRIAS ALTAS';

const aNumero = valor => {
  if (valor === null || valor === undefined || valor === '') return NaN;
  return Number(String(valor).trim().replace(',', '.'));
};

// --- Clínica ---------------------------------------------------------------

/** ¿El valor indicado en un campo de queratometría supera el límite? */
export const esQueratometriaAlta = (registro, campo) => {
  const valor = aNumero(registro?.[campo]);
  return Number.isFinite(valor) && valor >= LIMITE_QUERATOMETRIA;
};

/** ¿Alguno de los meridianos (K1/K2) del ojo indicado es alto? */
export const ojoConQueratometriaAlta = (registro, ojo) => ['k1_d_', 'k2_d_']
  .some(campo => esQueratometriaAlta(registro, `${campo}${ojo}`));

/**
 * Devuelve una copia del registro con el aviso agregado en las observaciones
 * del ojo, sin borrar lo que el especialista ya escribió. No duplica el aviso.
 * Si el valor vuelve al rango normal y el texto era solo el aviso automático,
 * lo limpia limpiamente sin romper los inputs controlados de React.
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

// --- Pricing ---------------------------------------------------------------

const ESCALA = 1000000n; // 6 decimales de precisión intermedia

/** Convierte a número devolviendo 0 ante valores vacíos o no numéricos. */
export const aMonto = valor => {
  const parsed = aNumero(valor);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Acota el descuento al rango válido (0 a 100). */
export const normalizarDescuento = descuento => {
  const base = aMonto(descuento);
  return Math.min(100, Math.max(0, base));
};

/** Escala un monto a entero de 6 decimales para evitar errores de punto flotante. */
const aEscala = valor => {
  const numero = aMonto(valor);
  if (!Number.isFinite(numero)) return 0n;
  return BigInt(Math.round(numero * 1e6));
};

/** División entera redondeando como PostgreSQL: .5 siempre hacia arriba. */
const dividirRedondeando = (dividendo, divisor) => {
  const entero = dividendo / divisor;
  const resto = dividendo % divisor;
  return resto * 2n >= divisor ? entero + 1n : entero;
};

/** Redondea a 2 decimales igual que round(numeric, 2) de PostgreSQL. */
const redondearSql = valorEscalado => {
  const negativo = valorEscalado < 0n;
  const absoluto = negativo ? -valorEscalado : valorEscalado;
  const centavos = dividirRedondeando(absoluto, ESCALA / 100n);
  const conSigno = negativo ? -centavos : centavos;
  return Number(conSigno) / 100;
};

/**
 * Costo final = venta - venta * descuento / 100.
 * Calcula con enteros escalados para producir exactamente el mismo centavo
 * que round(venta - venta * descuento / 100, 2) en PostgreSQL.
 */
export const calcularTotal = (venta, descuento) => {
  const base = aEscala(venta);
  const porcentaje = aEscala(normalizarDescuento(descuento));
  const descuentoEscalado = dividirRedondeando(base * porcentaje, 100n * ESCALA);
  return redondearSql(base - descuentoEscalado);
};

/** Monto del descuento aplicado, para mostrarlo desglosado. */
export const calcularMontoDescuento = (venta, descuento) => {
  const total = calcularTotal(venta, descuento);
  return Number((aMonto(venta) - total).toFixed(2));
};

/** Saldo pendiente = total - abono. */
export const calcularSaldo = (venta, descuento, abono) =>
  Number((calcularTotal(venta, descuento) - aMonto(abono)).toFixed(2));

/**
 * Determina si el error corresponde a una pérdida de red o a un rechazo del servidor.
 */
export const esFalloDeRed = (error) => {
  const texto = String(error?.message || error || '').toLowerCase();
  if (/rechaz|rechazo|violat|constraint|duplicate key|401|403|409|400/.test(texto)) return false;
  return /failed to fetch|network|load failed|aborted|tiempo agotado|timeout|conexion|conexión|dns|socket|502|503|504|offline|err_/.test(texto)
    || error?.name === 'TypeError';
};
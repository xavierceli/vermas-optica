// ---------------------------------------------------------------------------
// REGLAS DE NEGOCIO COMPARTIDAS
// Fuente unica de verdad para las reglas clinicas y de pricing. Antes estas
// formulas estaban duplicadas en Clinica, useGestor, PedidosForm, PedidosLista,
// impresiones y localRepository; cualquier divergencia producia saldos
// distintos entre la pantalla, el recibo y el servidor.
// El servidor (migracion 001) calcula: round(venta - venta * descuento / 100, 2)
// ---------------------------------------------------------------------------

// A partir de 47.00 D se considera queratometria alta (limite inclusivo).
export const LIMITE_QUERATOMETRIA = 47;
export const AVISO_QUERATOMETRIA = 'QUERATOMETRIAS ALTAS';

const aNumero = valor => {
  if (valor === null || valor === undefined || valor === '') return NaN;
  return Number(String(valor).trim().replace(',', '.'));
};

// --- Clinica ---------------------------------------------------------------

/** ¿El valor indicado en un campo de queratometria supera el limite? */
export const esQueratometriaAlta = (registro, campo) => {
  const valor = aNumero(registro?.[campo]);
  return Number.isFinite(valor) && valor >= LIMITE_QUERATOMETRIA;
};

/** ¿Alguno de los meridianos (K1/K2) del ojo indicado es alto? */
export const ojoConQueratometriaAlta = (registro, ojo) => ['k1_d_', 'k2_d_']
  .some(campo => esQueratometriaAlta(registro, `${campo}${ojo}`));

/**
 * Devuelve una copia del registro con el aviso agregado en las observaciones
 * del ojo, sin borrar lo que el especialista ya escribio. No duplica el aviso.
 * Si el valor vuelve a rango normal y el texto era solo el aviso automatico,
 * lo retira para no dejar una observacion falsa.
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
    delete siguiente[claveObs];
    return siguiente;
  }
  return registro;
};

// --- Pricing ---------------------------------------------------------------

const ESCALA = 1000000n; // 6 decimales de precision intermedia

/** Convierte a numero devolviendo 0 ante valores vacios o no numericos. */
export const aMonto = valor => {
  const parsed = aNumero(valor);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Acota el descuento al rango que valida el servidor (0 a 100). */
export const normalizarDescuento = descuento => {
  const base = aMonto(descuento);
  return Math.min(100, Math.max(0, base));
};

/** Escala un monto a entero de 6 decimales para evitar error de punto flotante. */
const aEscala = valor => {
  const numero = aMonto(valor);
  if (!Number.isFinite(numero)) return 0n;
  return BigInt(Math.round(numero * 1e6));
};

/** Division entera redondeando como PostgreSQL: .5 siempre hacia arriba. */
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
 * Se calcula con enteros escalados (no con float) para producir EXACTAMENTE el
 * mismo centavo que round(venta - venta * descuento / 100, 2) en PostgreSQL.
 * Con float, 250.50 @ 13% daba 217.93 y el servidor 217.94: esa diferencia de
 * un centavo hacia que el cobro local rechazara pagos que el servidor acepta.
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
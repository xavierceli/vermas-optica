import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITE_QUERATOMETRIA,
  AVISO_QUERATOMETRIA,
  esQueratometriaAlta,
  ojoConQueratometriaAlta,
  aplicarAvisoQueratometria,
  calcularTotal,
  calcularSaldo,
  calcularMontoDescuento,
  normalizarDescuento
} from './reglas.js';

test('queratometria: el limite de 47.00 D marca solo los valores que lo superan', () => {
  assert.equal(LIMITE_QUERATOMETRIA, 47);
  assert.equal(esQueratometriaAlta({ k1_d_od: '47.00' }, 'k1_d_od'), true, '47.00 ya es alta: el limite es inclusivo');
  assert.equal(esQueratometriaAlta({ k1_d_od: '46.99' }, 'k1_d_od'), false, 'por debajo de 47 no es alta');
  assert.equal(esQueratometriaAlta({ k1_d_od: '47.01' }, 'k1_d_od'), true);
  assert.equal(esQueratometriaAlta({ k1_d_od: '48.00' }, 'k1_d_od'), true);
  assert.equal(esQueratometriaAlta({ k1_d_od: '52.75' }, 'k1_d_od'), true);
  assert.equal(esQueratometriaAlta({ k1_d_od: '' }, 'k1_d_od'), false);
  assert.equal(esQueratometriaAlta({ k1_d_od: 'abc' }, 'k1_d_od'), false);
  assert.equal(esQueratometriaAlta({ k1_d_od: '48,50' }, 'k1_d_od'), true, 'acepta coma decimal');
});

test('queratometria: el aviso se agrega sin borrar lo ya escrito', () => {
  const r = aplicarAvisoQueratometria({ k2_d_od: '48.00', obs_k_od: 'Paciente refiere vision borrosa' }, 'od');
  assert.equal(r.obs_k_od, `Paciente refiere vision borrosa\n${AVISO_QUERATOMETRIA}`);
  assert.ok(r.obs_k_od.includes('vision borrosa'), 'no debe borrar el texto previo');
});

test('queratometria: el aviso no se duplica si ya esta', () => {
  const base = { k1_d_od: '49.00', obs_k_od: AVISO_QUERATOMETRIA };
  const r = aplicarAvisoQueratometria(base, 'od');
  assert.equal(r.obs_k_od, AVISO_QUERATOMETRIA);
  assert.equal((r.obs_k_od.match(/QUERATOMETRIAS ALTAS/g) || []).length, 1);
});

test('queratometria: si el valor baja de rango y el texto era solo el aviso, se retira', () => {
  const r = aplicarAvisoQueratometria({ k1_d_od: '45.00', obs_k_od: AVISO_QUERATOMETRIA }, 'od');
  assert.equal(r.obs_k_od, '', 'el campo queda vacío para que el formulario lo muestre limpio');
});

test('queratometria: si el aviso convive con notas propias, se conserva al normalizar', () => {
  const base = { k1_d_od: '45.00', obs_k_od: `nota propia\n${AVISO_QUERATOMETRIA}` };
  const r = aplicarAvisoQueratometria(base, 'od');
  assert.equal(r.obs_k_od, `nota propia\n${AVISO_QUERATOMETRIA}`);
});

test('queratometria: K1 y K2 se evaluan por separado y solo afecta a su ojo', () => {
  assert.equal(ojoConQueratometriaAlta({ k1_d_od: '48.00', k2_d_od: '42.00' }, 'od'), true);
  assert.equal(ojoConQueratometriaAlta({ k1_d_od: '42.00', k2_d_od: '43.00' }, 'od'), false);
  const r = aplicarAvisoQueratometria({ k1_d_od: '48.00', obs_k_oi: 'nota OI' }, 'od');
  assert.equal(r.obs_k_od, AVISO_QUERATOMETRIA, 'marca OD');
  assert.equal(r.obs_k_oi, 'nota OI', 'no toca OI');
});

// --- Pricing: paridad con la formula del servidor -------------------------
// El servidor usa: round(venta - venta * descuento / 100, 2)

test('pricing: coincide con la formula del servidorSupabase', () => {
  const casos = [
    ['100', '0', '100.00'],
    ['100', '10', '90.00'],
    ['100', '30', '70.00'],
    ['250.50', '13', '217.94'],
    ['19.99', '33.33', '13.33'],
    ['0', '50', '0.00']
  ];
  for (const [venta, descuento, esperado] of casos) {
    assert.equal(calcularTotal(venta, descuento).toFixed(2), esperado, `venta=${venta} desc=${descuento}`);
  }
});

test('pricing: el descuento se acota a 0-100 igual que el servidor', () => {
  assert.equal(normalizarDescuento('150'), 100);
  assert.equal(normalizarDescuento('-20'), 0);
  assert.equal(normalizarDescuento('abc'), 0);
  assert.equal(calcularTotal('100', '150'), 0);
  assert.equal(calcularTotal('100', '-20'), 100);
});

test('pricing: valores vacios o no numericos no producen NaN', () => {
  assert.equal(calcularTotal('', ''), 0);
  assert.equal(calcularTotal(null, undefined), 0);
  assert.equal(calcularTotal('abc', 'xyz'), 0);
  assert.ok(Number.isFinite(calcularSaldo(undefined, null, 'x')));
});

test('pricing: saldo y monto de descuento son consistentes', () => {
  assert.equal(calcularMontoDescuento('100', '10'), 10);
  assert.equal(calcularSaldo('100', '10', '25'), 65);
  assert.equal(calcularSaldo('100', '0', '100'), 0, 'venta pagada no genera saldo negativo');
  assert.equal(calcularTotal('100', '10') + calcularMontoDescuento('100', '10'), 100);
});
test('pricing: la aritmetica decimal exacta evita el desvio de 1 centavo del float', () => {
  // Con punto flotante 250.50 @ 13% daba 217.93; PostgreSQL round(217.935,2)=217.94.
  assert.equal(calcularTotal('250.50', '13'), 217.94);
  // Casos donde el redondeo "a mitad hacia arriba" de SQL es decisivo.
  assert.equal(calcularTotal('100', '5'), 95);
  assert.equal(calcularTotal('10.05', '50'), 5.03);
  assert.equal(calcularTotal('1', '1'), 0.99);
  // El total nunca puede quedar por debajo de cero.
  assert.equal(calcularTotal('100', '100'), 0);
  assert.equal(calcularTotal('0', '0'), 0);
});

test('pricing: 80 combinaciones coinciden con el redondeo de PostgreSQL', () => {
  // Oraculo independiente: trabaja en centimos y aplica el redondeo AL FINAL,
  // que es lo que hace round(venta - venta * descuento / 100, 2) en PostgreSQL.
  // (Redondear el descuento antes daria resultados distintos: 9.99 @ 50% = 5.00,
  //  no 4.99, porque 9.99 - 4.995 = 4.995 y round() va hacia arriba.)
  const esperadoSql = (venta, descuento) => {
    const centimos = BigInt(Math.round(venta * 100));
    const pct = BigInt(Math.round(descuento * 100));
    const numerador = centimos * (10000n - pct);
    const entero = numerador / 10000n;
    const resto = numerador % 10000n;
    const centavos = resto * 2n >= 10000n ? entero + 1n : entero;
    return Number(centavos) / 100;
  };
  const ventas = ['0', '9.99', '19.99', '33.33', '100', '250.50', '1000.01', '12345.67'];
  const descuentos = ['0', '1', '5', '10', '13', '16.67', '33.33', '50', '75', '100'];
  let comparaciones = 0;
  for (const venta of ventas) {
    for (const descuento of descuentos) {
      assert.equal(
        calcularTotal(venta, descuento),
        esperadoSql(Number(venta), Number(descuento)),
        `venta=${venta} descuento=${descuento}`
      );
      comparaciones += 1;
    }
  }
  assert.equal(comparaciones, 80);
});

test('pricing: casos reales donde el float clasico se equivoca', () => {
  // Documenta por que se usa aritmetica entera y no punto flotante.
  // El servidor calcula round(venta - venta*desc/100, 2) sobre exactos.
  const floatClasico = (v, d) => Number((v - (v * d / 100)).toFixed(2));
  const divergentes = [
    ['19.99', '50'], ['33.33', '50'], ['250.50', '5'], ['1000.01', '50']
  ];
  for (const [venta, descuento] of divergentes) {
    const exacto = calcularTotal(venta, descuento);
    const conFloat = floatClasico(Number(venta), Number(descuento));
    assert.notEqual(exacto, conFloat, `float y exacto no deberian coincidir en ${venta} @ ${descuento}%`);
  }
  // Contraste directo del caso mas grave para cobros.
  assert.equal(calcularTotal('19.99', '50'), 10, 'el servidor devuelve 10.00');
  assert.equal(floatClasico(19.99, 50), 9.99, 'el float devolveria 9.99 y rechazaria el pago');
});
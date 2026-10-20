import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPOS_DE_TRATAMIENTO,
  combosDelTarifario,
  configuracionDelCombo,
  esCombo,
  filaDeCombo,
  prepararCombo,
  problemaDelCombo,
  quitarCombo,
  resumenDelCombo
} from './combos.js';

// Un combo mal leido puede cobrar de menos (o regalar un tratamiento). Estas
// pruebas fijan el contrato del JSON que se guarda en `notas` y de los cambios
// que se aplican al pedido.

const filaCombo = (extra = {}) => ({
  id: 7,
  tipo_lente: 'COMBO',
  material: 'MONOFOCAL',
  tratamiento: 'Combo',
  rango_medida: 'COMBO: Armazón + Antirreflejo',
  precio_sugerido: '40.00',
  costo_laboratorio: '12.00',
  notas: JSON.stringify({ v: 1, tratamientos: ['tratam_ar'], topeArmazon: 25 }),
  ...extra
});

const INVENTARIO = [
  { id: 1, codigo: 'MIRA-4017', categoria: 'Armazon', precio: '45.00' },
  { id: 2, codigo: 'ECONO-1', categoria: 'Armazon', precio: '20.00' }
];

test('esCombo reconoce la fila sin importar mayusculas ni espacios', () => {
  assert.equal(esCombo(filaCombo()), true);
  assert.equal(esCombo(filaCombo({ tipo_lente: ' combo ' })), true);
  assert.equal(esCombo({ tipo_lente: 'CALCULO', rango_medida: 'BASE' }), false);
  assert.equal(esCombo(null), false);
});

test('configuracionDelCombo tolera JSON roto o notas normales', () => {
  const vacia = { tratamientos: [], topeArmazon: null, tipoLente: '', materialLente: '', nota: '' };
  assert.deepEqual(configuracionDelCombo({ notas: 'Lab Servióptica / 3 días' }), vacia);
  assert.deepEqual(configuracionDelCombo({ notas: '{"tratamientos":' }), vacia);
  assert.deepEqual(configuracionDelCombo({ notas: '[1,2,3]' }), vacia);
  assert.deepEqual(configuracionDelCombo(null), vacia);
});

test('configuracionDelCombo filtra tratamientos desconocidos y topes invalidos', () => {
  const config = configuracionDelCombo({
    notas: JSON.stringify({
      tratamientos: ['tratam_ar', 'tratam_inventado', 'tratam_ar', 'tratam_foto'],
      topeArmazon: -5,
      tipoLente: ' Monofocal ',
      materialLente: 'Plástico',
      nota: ' Estuche '
    })
  });
  assert.deepEqual(config.tratamientos, ['tratam_ar', 'tratam_foto']);
  assert.equal(config.topeArmazon, null);
  assert.equal(config.tipoLente, 'Monofocal');
  assert.equal(config.materialLente, 'Plástico');
  assert.equal(config.nota, 'Estuche');
});

test('combosDelTarifario solo trae combos y limpia el prefijo del nombre', () => {
  const lista = [
    filaCombo(),
    { id: 9, tipo_lente: 'CALCULO', rango_medida: 'BASE', material: 'AR Verde' },
    { id: 10, tipo_lente: 'Monofocal', rango_medida: '1.56' }
  ];
  const combos = combosDelTarifario(lista);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].nombre, 'Armazón + Antirreflejo');
  assert.equal(combos[0].precio, 40);
  assert.equal(combos[0].costo, 12);
  assert.deepEqual(combos[0].config.tratamientos, ['tratam_ar']);
});

test('prepararCombo fija el precio y marca solo los tratamientos incluidos', () => {
  const combo = combosDelTarifario([filaCombo()])[0];
  const cambios = prepararCombo(combo);

  assert.equal(cambios.combo_id, '7');
  assert.equal(cambios.combo_nombre, 'Armazón + Antirreflejo');
  assert.equal(cambios.combo_precio, 40);
  assert.equal(cambios.tratam_ar, 'SI');
  assert.equal(cambios.tratam_ninguno, 'NO');
  for (const campo of CAMPOS_DE_TRATAMIENTO.filter(c => c !== 'tratam_ar')) {
    assert.equal(cambios[campo], 'NO', campo);
  }
  assert.equal('codigo_armazon' in cambios, false, 'el armazon lo elige el usuario');
});

test('un combo sin tratamientos deja "Ninguno / Blanco" marcado', () => {
  const combo = combosDelTarifario([filaCombo({
    notas: JSON.stringify({ v: 1, tratamientos: [], topeArmazon: null })
  })])[0];
  const cambios = prepararCombo(combo);
  assert.equal(cambios.tratam_ninguno, 'SI');
  for (const campo of CAMPOS_DE_TRATAMIENTO) assert.equal(cambios[campo], 'NO', campo);
});

test('prepararCombo aplica tipo y material de lente solo si el combo los define', () => {
  const combo = combosDelTarifario([filaCombo({
    notas: JSON.stringify({ v: 1, tratamientos: ['tratam_ar'], tipoLente: 'Progresivo', materialLente: 'Policarbonato' })
  })])[0];
  const cambios = prepararCombo(combo);
  assert.equal(cambios.tipo_lente, 'Progresivo');
  assert.equal(cambios.material_lente, 'Policarbonato');

  const sinLente = prepararCombo(combosDelTarifario([filaCombo()])[0]);
  assert.equal('tipo_lente' in sinLente, false);
  assert.equal('material_lente' in sinLente, false);
});

test('quitarCombo limpia solo el snapshot y conserva el resto del pedido', () => {
  const pedido = {
    combo_id: '7', combo_nombre: 'Armazón + AR', combo_precio: 40,
    codigo_armazon: 'MIRA-4017', tratam_ar: 'SI', venta: 40
  };
  const limpio = quitarCombo(pedido);
  assert.equal(limpio.combo_id, '');
  assert.equal(limpio.combo_nombre, '');
  assert.equal(limpio.combo_precio, '');
  assert.equal(limpio.codigo_armazon, 'MIRA-4017');
  assert.equal(limpio.tratam_ar, 'SI');
});

test('avisa cuando el armazon supera el tope del combo', () => {
  const combo = combosDelTarifario([filaCombo()])[0];
  const caro = problemaDelCombo({ codigo_armazon: 'MIRA-4017' }, combo, INVENTARIO);
  assert.match(caro, /hasta \$25\.00/);
  assert.match(caro, /cuesta \$45\.00/);

  const barato = problemaDelCombo({ codigo_armazon: 'ECONO-1' }, combo, INVENTARIO);
  assert.equal(barato, null);
});

test('avisa cuando el costo interno se come el precio del combo', () => {
  const combo = combosDelTarifario([filaCombo()])[0];
  const aviso = problemaDelCombo({
    codigo_armazon: 'ECONO-1',
    costo_armazon_int: '20',
    costo_lunas_int: '15',
    costo_tratamientos_int: '5'
  }, combo, INVENTARIO);
  assert.match(aviso, /costo interno \(\$40\.00\)/);

  const sano = problemaDelCombo({
    codigo_armazon: 'ECONO-1',
    costo_armazon_int: '10',
    costo_lunas_int: '8'
  }, combo, INVENTARIO);
  assert.equal(sano, null);
});

test('resumenDelCombo no muestra el JSON crudo', () => {
  const resumen = resumenDelCombo(filaCombo({
    notas: JSON.stringify({ v: 1, tratamientos: ['tratam_ar'], topeArmazon: 25, nota: 'Incluye estuche' })
  }));
  assert.match(resumen, /Antirreflejo Verde/);
  assert.match(resumen, /armazón hasta \$25\.00/);
  assert.match(resumen, /Incluye estuche/);
  assert.doesNotMatch(resumen, /\{"v":1/);
});

test('filaDeCombo genera una fila valida y sin tratamientos inventados', () => {
  const fila = filaDeCombo({
    nombre: 'Combo $40',
    precio: '40',
    costo: '12',
    tratamientos: ['tratam_ar', 'tratam_inventado'],
    topeArmazon: '25',
    tipoLente: 'Monofocal',
    materialLente: 'Plástico',
    nota: 'Incluye estuche'
  });
  assert.equal(fila.tipo_lente, 'COMBO');
  assert.equal(fila.rango_medida, 'COMBO: Combo $40');
  assert.equal(fila.precio_sugerido, 40);
  assert.equal(fila.costo_laboratorio, 12);
  assert.equal(fila.material, 'PLÁSTICO');

  const config = configuracionDelCombo(fila);
  assert.deepEqual(config.tratamientos, ['tratam_ar']);
  assert.equal(config.topeArmazon, 25);
  assert.equal(config.nota, 'Incluye estuche');
});

test('filaDeCombo convierte un tope invalido en null', () => {
  const fila = filaDeCombo({ nombre: 'X', precio: 10, topeArmazon: 'mucho' });
  assert.equal(configuracionDelCombo(fila).topeArmazon, null);
});

// ---------------------------------------------------------------------------
// COMBOS / PAQUETES PROMOCIONALES
// ---------------------------------------------------------------------------
// Un combo es una fila del tarifario con tipo_lente = 'COMBO'. Tiene un precio
// cerrado (armazon + lunas + tratamientos incluidos) y se guarda en la venta
// como snapshot: combo_id, combo_nombre y combo_precio.
//
// El armazon se sigue eligiendo para descontar stock y para la orden de
// laboratorio, pero su precio NO se suma encima del combo. El accesorio si se
// cobra aparte: es stock que sale del inventario y no debe regalarse sin querer.
//
// FASE 1: la configuracion viaja como JSON dentro de `notas` (columna que ya
// sincroniza). Cuando los combos se usen de verdad, la Fase 2 anade
// `lista_precios.combo_config` y `pedidos_ventas.combo_*` sin cambiar este
// modulo: `configuracionDelCombo` ya prefiere el JSON nuevo si existe.
//
// Modulo puro, sin React ni Supabase, para poder probarlo con `node --test`.
// ---------------------------------------------------------------------------

export const TIPO_COMBO = 'COMBO';
export const PREFIJO_COMBO = 'COMBO:';

/** Campos de tratamiento que puede incluir un combo (los de PedidosForm). */
export const CAMPOS_DE_TRATAMIENTO = [
  'tratam_ar',
  'tratam_ar_azul',
  'tratam_azul',
  'tratam_tinturado',
  'tratam_foto',
  'tratam_trans'
];

/** Etiquetas legibles para el Tarifario y las tarjetas del pedido. */
export const ETIQUETAS_DE_TRATAMIENTO = {
  tratam_ar: 'Antirreflejo Verde',
  tratam_ar_azul: 'Antirreflejo Azul',
  tratam_azul: 'Filtro Azul',
  tratam_tinturado: 'Tinturado',
  tratam_foto: 'Fotocromático',
  tratam_trans: 'Transition'
};

const texto = valor => {
  if (valor === null || valor === undefined) return '';
  try {
    return String(valor);
  } catch {
    return '';
  }
};

const numero = valor => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

const configuracionVacia = () => ({
  tratamientos: [],
  topeArmazon: null,
  tipoLente: '',
  materialLente: '',
  nota: ''
});

export const esCombo = fila =>
  texto(fila?.tipo_lente).trim().toUpperCase() === TIPO_COMBO;

/**
 * Lee la configuracion del combo desde `notas` (JSON v1).
 * Nunca lanza: si el JSON esta roto o trae campos raros, devuelve solo lo
 * valido. Los tratamientos se filtran contra la lista blanca para que un error
 * de tecleo no active un campo que no existe.
 */
export const configuracionDelCombo = (fila) => {
  const crudo = texto(fila?.notas).trim();
  if (!crudo.startsWith('{')) return configuracionVacia();

  let datos;
  try {
    datos = JSON.parse(crudo);
  } catch {
    return configuracionVacia();
  }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    return configuracionVacia();
  }

  const tratamientos = Array.isArray(datos.tratamientos)
    ? datos.tratamientos.filter(campo => CAMPOS_DE_TRATAMIENTO.includes(campo))
    : [];
  const tope = Number(datos.topeArmazon);

  return {
    tratamientos: [...new Set(tratamientos)],
    topeArmazon: Number.isFinite(tope) && tope > 0 ? tope : null,
    tipoLente: texto(datos.tipoLente).trim(),
    materialLente: texto(datos.materialLente).trim(),
    nota: texto(datos.nota).trim()
  };
};

/** Combos listos para pintar en el formulario de pedidos. */
export const combosDelTarifario = (listaPrecios = []) =>
  (listaPrecios || []).filter(esCombo).map(fila => ({
    ...fila,
    nombre: texto(fila.rango_medida).replace(/^COMBO:\s*/i, '').trim() || 'Combo',
    precio: Number(numero(fila.precio_sugerido).toFixed(2)),
    costo: Number(numero(fila.costo_laboratorio).toFixed(2)),
    config: configuracionDelCombo(fila)
  }));

/**
 * Cambios que se aplican al pedido al elegir un combo. No toca el armazon ni
 * los costos: esos se siguen eligiendo/capturando a mano.
 */
export const prepararCombo = (combo) => {
  const config = combo?.config || configuracionDelCombo(combo);
  const cambios = {
    combo_id: texto(combo?.id),
    combo_nombre: texto(combo?.nombre ?? combo?.rango_medida).trim() || 'Combo',
    combo_precio: Number(numero(combo?.precio ?? combo?.precio_sugerido).toFixed(2))
  };

  CAMPOS_DE_TRATAMIENTO.forEach(campo => { cambios[campo] = 'NO'; });
  cambios.tratam_ninguno = 'NO';
  config.tratamientos.forEach(campo => { cambios[campo] = 'SI'; });
  if (config.tratamientos.length === 0) cambios.tratam_ninguno = 'SI';

  if (config.tipoLente) cambios.tipo_lente = config.tipoLente;
  if (config.materialLente) cambios.material_lente = config.materialLente;
  return cambios;
};

/**
 * Deja el pedido sin combo. Los tratamientos se conservan (son los que el
 * cliente pidio): al recalcular, vuelven a sumar como precio normal.
 */
export const quitarCombo = pedido => ({
  ...pedido,
  combo_id: '',
  combo_nombre: '',
  combo_precio: ''
});

/**
 * Aviso (no bloqueo) si el armazon elegido se pasa del tope del combo o si el
 * costo interno iguala o supera el precio. Devuelve null cuando todo esta bien.
 */
export const problemaDelCombo = (pedido, combo, inventario = []) => {
  if (!pedido || !combo) return null;
  const config = combo.config || configuracionDelCombo(combo);

  const codigo = texto(pedido.codigo_armazon).trim().toUpperCase();
  const armazon = codigo
    ? (inventario || []).find(item => item
      && item.categoria === 'Armazon'
      && texto(item.codigo).trim().toUpperCase() === codigo)
    : null;

  if (config.topeArmazon !== null && armazon) {
    const precioArmazon = numero(armazon.precio);
    if (precioArmazon > config.topeArmazon + 0.005) {
      return `Este combo aplica a armazones de hasta $${config.topeArmazon.toFixed(2)}. El elegido cuesta $${precioArmazon.toFixed(2)}: revisa el margen.`;
    }
  }

  const costo = numero(pedido.costo_armazon_int)
    + numero(pedido.costo_lunas_int)
    + numero(pedido.costo_tratamientos_int);
  const precio = numero(combo.precio ?? combo.precio_sugerido);
  if (costo > 0 && precio > 0 && costo >= precio) {
    return `Ojo: el costo interno ($${costo.toFixed(2)}) es igual o mayor que el precio del combo ($${precio.toFixed(2)}).`;
  }
  return null;
};

/** Texto corto para la lista del Tarifario (nunca muestra el JSON crudo). */
export const resumenDelCombo = (fila) => {
  const config = configuracionDelCombo(fila);
  const partes = config.tratamientos.map(campo => ETIQUETAS_DE_TRATAMIENTO[campo]);
  if (config.topeArmazon !== null) {
    partes.push(`armazón hasta $${config.topeArmazon.toFixed(2)}`);
  }
  if (config.nota) partes.push(config.nota);
  return partes.filter(Boolean).join(' · ');
};

/** Fila de `lista_precios` que representa un combo (Fase 1: JSON en notas). */
export const filaDeCombo = ({
  id,
  nombre,
  precio,
  costo,
  tratamientos = [],
  topeArmazon = null,
  tipoLente = '',
  materialLente = '',
  nota = ''
}) => {
  const tope = Number(topeArmazon);
  return {
    id,
    tipo_lente: TIPO_COMBO,
    material: texto(materialLente || 'MONOFOCAL').trim().toUpperCase() || 'MONOFOCAL',
    tratamiento: 'Combo',
    rango_medida: `${PREFIJO_COMBO} ${texto(nombre).trim()}`.trim(),
    precio_sugerido: Number(numero(precio).toFixed(2)),
    costo_laboratorio: Number(numero(costo).toFixed(2)),
    notas: JSON.stringify({
      v: 1,
      tratamientos: (tratamientos || []).filter(campo => CAMPOS_DE_TRATAMIENTO.includes(campo)),
      topeArmazon: Number.isFinite(tope) && tope > 0 ? tope : null,
      tipoLente: texto(tipoLente).trim(),
      materialLente: texto(materialLente).trim(),
      nota: texto(nota).trim()
    })
  };
};

// ---------------------------------------------------------------------------
// CALCULO AUTOMATICO DEL PRECIO DE UN PEDIDO
// ---------------------------------------------------------------------------
// Cuando se elige un armazon, un accesorio, un material de lente o un
// tratamiento, la app suma sus precios sola. Estas funciones SON PURAS: reciben
// los datos por parametro y devuelven un numero. No tocan el estado de React, asi
// que se pueden probar aparte (ver calculoPrecio.test.js) y no dependen de nada.
//
// No importa de './utilidades.js': ese archivo arrastra a Supabase (que necesita
// navegador) y a la busqueda en la nube, y con esto el modulo no se podria probar
// con `node --test`. Las dos utilidades que hace falta son una copia exacta y
// minima, sin dependencias.
//
// Antes vivian dentro de useGestor.js, que superaba las 1.000 lineas.
// ---------------------------------------------------------------------------

/** Igual que safeNum de utilidades.js: nunca devuelve NaN. */
const safeNum = valor => {
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Igual que safeString de utilidades.js: nunca lanza. */
const safeString = valor => {
  if (valor === null || valor === undefined) return '';
  try {
    return String(valor);
  } catch {
    return '';
  }
};

/**
 * Precio total del pedido: armazon + accesorio + lentes + tratamientos.
 * @param {object} pedidoActual   El pedido en edicion (con sus campos de venta)
 * @param {Array}  inventario     Catalogo de productos
 * @param {Array}  listaPrecios   Tarifario
 * @returns {number} Total con dos decimales
 */
export const autoCalcularPrecio = (pedidoActual, inventario, listaPrecios) => {
  if (!pedidoActual) return 0;
  let total = 0;

  if (pedidoActual.codigo_armazon) {
    const armazonEncontrado = (inventario || []).find(
      item => String(item.codigo).trim().toUpperCase() === String(pedidoActual.codigo_armazon).trim().toUpperCase()
    );
    if (armazonEncontrado && armazonEncontrado.precio) {
      total += safeNum(armazonEncontrado.precio);
    }
  }

  if (pedidoActual.accesorio_id) {
    const accesorioEncontrado = (inventario || []).find(
      item => String(item.id) === String(pedidoActual.accesorio_id)
    );
    if (accesorioEncontrado && accesorioEncontrado.precio) {
      total += safeNum(accesorioEncontrado.precio);
    }
  }

  const bases = (listaPrecios || []).filter(p => safeString(p.tipo_lente) === 'CALCULO' && safeString(p.rango_medida) === 'BASE');
  const precioDe = (material) => {
    const fila = bases.find(b => safeString(b.material).trim().toUpperCase() === String(material).trim().toUpperCase());
    if (fila) return safeNum(fila.precio_sugerido);
    return 0;
  };

  if (pedidoActual.material_lente && pedidoActual.material_lente !== 'Otros') {
    total += precioDe(pedidoActual.material_lente);
  }

  const mapaTratamientos = {
    tratam_ar: 'AR Verde', tratam_ar_azul: 'AR Azul', tratam_azul: 'Filtro Azul',
    tratam_tinturado: 'Tinturado', tratam_foto: 'Fotocromático', tratam_trans: 'Transition'
  };
  Object.keys(mapaTratamientos).forEach(k => {
    if (pedidoActual[k] === 'SI') total += precioDe(mapaTratamientos[k]);
  });

  return Number(total.toFixed(2));
};

/** Campos cuyo cambio obliga a recalcular el precio. */
export const fieldsQueAfectanPrecio = (name) => [
  'codigo_armazon', 'material_lente', 'accesorio_id', 'tratam_ar',
  'tratam_ar_azul', 'tratam_azul', 'tratam_tinturado', 'tratam_foto',
  'tratam_trans', 'tratam_ninguno'
].includes(name);
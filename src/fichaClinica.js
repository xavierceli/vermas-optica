// ---------------------------------------------------------------------------
// FICHA CLINICA: el formulario de la consulta
// ---------------------------------------------------------------------------
// Modulo puro, sin React ni Supabase, para poder probarlo con node --test. Es
// la parte de useGestor.js mas delicada y la que mas datos ha costado: cuando
// el optometria teclea la cedula de un paciente que ya existe, la ficha se
// reemplaza por la guardada. Si aqui se equivoca un campo, se pierde trabajo.
//
// QUE HACE ESTE MODULO
//   - Define el formulario vacio (unos 120 campos de refraccion).
//   - Al teclear una cedula, decide si el paciente es nuevo o si hay que traer
//     su ultima ficha, y en ese caso limpia los campos de la VENTA anterior.
//
// GARANTIA IMPORTANTE
//   La ficha que devuelve `aplicarCedula` tiene TODOS los campos del formulario,
//   y ninguno vale null ni undefined. Antes, al mezclar la ficha guardada se
//   perdian los valores por defecto de los campos que la base no devolvia
//   (el input recibia null en lugar de texto), que es como un formulario
//   empezaba a calcular esferas con ceros sin avisar.
export const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Igual que safeString de utilidades.js, pero sin importar supabaseClient. */
const aTexto = valor => (valor === null || valor === undefined ? '' : String(valor));

export const crearEstadoPaciente = (fecha = hoyISO()) => ({
  id: '', paciente_id: '', pedido_id: '',
  fecha, cedula: '', nombre: '', alias: '', telefono: '', correo: '', notas_clinicas: '', fecha_nacimiento: '', antecedentes: '',
  avsl_od: '', avsc_od: '', esfera_od: '', cilindro_od: '', eje_od: '', adicion_od: '', dnp_od: '', altura_od: '', avcl_od: '', avcc_od: '',
  avsl_oi: '', avsc_oi: '', esfera_oi: '', cilindro_oi: '', eje_oi: '', adicion_oi: '', dnp_oi: '', altura_oi: '', avcl_oi: '', avcc_oi: '',
  k1_d_od: '', k2_d_od: '', k1_mm_od: '', k2_mm_od: '', eje_k1_od: '', eje_k2_od: '', astig_corneal_od: '', eje_astig_od: '', obs_k_od: '',
  k1_d_oi: '', k2_d_oi: '', k1_mm_oi: '', k2_mm_oi: '', eje_k1_oi: '', eje_k2_oi: '', astig_corneal_oi: '', eje_astig_oi: '', obs_k_oi: '',
  auto_esf_od: '', auto_cil_od: '', auto_eje_od: '', auto_esf_oi: '', auto_cil_oi: '', auto_eje_oi: '',
  auto_esf_od_2: '', auto_cil_od_2: '', auto_eje_od_2: '', auto_esf_oi_2: '', auto_cil_oi_2: '', auto_eje_oi_2: '',
  lenso_esf_od: '', lenso_cil_od: '', lenso_eje_od: '', lenso_add_od: '', lenso_avl_od: '', lenso_avc_od: '',
  lenso_esf_oi: '', lenso_cil_oi: '', lenso_eje_oi: '', lenso_add_oi: '', lenso_avl_oi: '', lenso_avc_oi: '',
  venta: '', abono: '', descuento: '0', forma_pago: 'Efectivo', pago_nota: '', estado: 'Ninguno', notas: '', comprobante_url: '',
  codigo_armazon: '', tipo_armazon: '', param_horizontal: '', param_puente: '', param_vertical: '', param_diagonal: '',
  tipo_lente: '', material_lente: '', material_nota: '', accesorio_id: '',
  tratam_ninguno: 'NO', tratam_ar: 'NO', tratam_ar_azul: 'NO', tratam_azul: 'NO',
  tratam_tinturado: 'NO', tratam_tinturado_nota: '',
  tratam_foto: 'NO', tratam_foto_nota: '',
  tratam_trans: 'NO', tratam_trans_nota: '',
  costo_armazon_int: '', costo_lunas_int: '', costo_accesorio_int: '', costo_tratamientos_int: '', costo_varios_int: ''
});

export const INV_INICIAL = {
  categoria: 'Armazon', codigo: '', tipo_armazon: '', material: '', descripcion: '', material_nota: '',
  param_horizontal: '', param_puente: '', param_vertical: '', param_diagonal: '', param_frontal: '', param_varillas: '',
  nombre_accesorio: '', caracteristica: '', costo_compra: '', precio: '', stock: '', imagen_url: ''
};

export const PRECIO_INICIAL = {
  tipo_lente: 'Monofocal', material: 'Plástico', tratamiento: 'Ninguno', rango_medida: '',
  costo_laboratorio: '', precio_sugerido: '', notas: ''
};
// Campos que pertenecen a la VENTA anterior: al traer la ficha de un paciente
// hay que vaciarlos, o se le cobraria a este paciente el pedido del anterior.
export const CAMPOS_DE_VENTA = [
  'venta', 'abono', 'notas', 'notas_clinicas',
  'codigo_armazon', 'tipo_armazon',
  'param_horizontal', 'param_puente', 'param_vertical', 'param_diagonal',
  'tipo_lente', 'material_lente', 'material_nota',
  'tratam_tinturado_nota', 'tratam_foto_nota', 'tratam_trans_nota',
  'pago_nota', 'accesorio_id',
  'costo_armazon_int', 'costo_lunas_int', 'costo_accesorio_int', 'costo_tratamientos_int', 'costo_varios_int',
  'comprobante_url'
];

// Casillas de tratamiento: se marcan en "NO" para no copiar una eleccion ajena.
export const TRATAMIENTOS = [
  'tratam_ninguno', 'tratam_ar', 'tratam_ar_azul', 'tratam_azul',
  'tratam_tinturado', 'tratam_foto', 'tratam_trans'
];

const LONGITUD_CEDULA = 10;

// Nombres que esta funcion entiende. El test los compara con los que realmente
// le pasa useGestor: si los dos lados no coinciden, la peticion se pierde en
// silencio y el optometria no puede escribir la cedula. Pasó una vez.
export const CLAVES_ACEPTADAS = ['paciente', 'value', 'historial', 'hoy'];

/**
 * Que pasa al teclear una cedula.
 *   - Cedula incompleta o de un paciente que no existe: NO se toca nada mas.
 *     Regla que ya se respeta desde hace tiempo: teclear un digito de mas
 *     jamas puede borrar el formulario que el optometria lleva media hora
 *     llenando.
 *   - Paciente que ya existe: se trae su ultima ficha clinica y se vacia la
 *     parte economica, porque la venta nueva empieza en cero.
 *
 * El parametro se llama `value` (no `valor`) a proposito: es el nombre que usan
 * los manejadores de cambio de toda la app, el que viene de `e.target`.
 *
 * @returns {{ ficha: object, encontro: boolean }}
 */
export const aplicarCedula = ({ paciente, value, historial = [], hoy = hoyISO() } = {}) => {
  const documento = aTexto(value).trim();
  const completa = documento.length >= LONGITUD_CEDULA;
  const existente = completa
    ? (historial || []).find(p =>
      aTexto(p?.cedula).trim() === documento && aTexto(p?.nombre).trim() !== 'CONSUMIDOR FINAL')
    : null;

  if (!existente) {
    return { ficha: { ...paciente, cedula: value }, encontro: false };
  }

  // Se parte del formulario COMPLETO y se encima lo guardado: asi ningun campo
  // se queda sin valor por defecto porque la base no lo devolvio. Los null se
  // convierten en texto vacio para que el input no reciba null.
  const ficha = crearEstadoPaciente(hoy);
  for (const [campo, dato] of Object.entries(existente)) {
    if (dato !== null && dato !== undefined) ficha[campo] = dato;
  }

  ficha.fecha = hoy;
  ficha.cedula = value;
  ficha.id = '';            // es una consulta NUEVA, no una edicion de la anterior
  ficha.pedido_id = '';

  CAMPOS_DE_VENTA.forEach(campo => { ficha[campo] = ''; });
  TRATAMIENTOS.forEach(campo => { ficha[campo] = 'NO'; });
  ficha.descuento = '0';
  ficha.forma_pago = 'Efectivo';
  ficha.estado = 'Ninguno';

  return { ficha, encontro: true };
};
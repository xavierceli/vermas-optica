// ---------------------------------------------------------------------------
// FICHA CLINICA: el formulario de la consulta
// ---------------------------------------------------------------------------
// Módulo puro, sin React ni Supabase, para poder probarlo con node --test.
//
// QUÉ HACE ESTE MÓDULO:
//   - Define el formulario inicial (campos clínicos, refracción y venta).
//   - Al teclear una cédula, decide si el paciente es nuevo o si hay que traer
//     su última ficha, limpiando únicamente los campos de la venta anterior.
//
// GARANTÍA:
//   La ficha devuelta tiene todos los campos necesarios y ninguno vale null.
// ---------------------------------------------------------------------------
export const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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

/**
 * Coincidencias del buscador de pacientes en historial local y nube.
 */
export const buscarCoincidenciasPacientes = ({ locales = [], nube = [], texto = '', limite = 5 } = {}) => {
  const val = String(texto || '').trim().toUpperCase();
  if (val.length < 2) return [];

  const coincide = h => Boolean(h)
    && aTexto(h.nombre).trim().toUpperCase() !== 'CONSUMIDOR FINAL'
    && (
      aTexto(h.cedula).toUpperCase().includes(val)
      || aTexto(h.nombre).toUpperCase().includes(val)
      || aTexto(h.alias).toUpperCase().includes(val)
    );

  const vistos = new Set();
  const salida = [];
  for (const h of [...nube, ...locales]) {
    if (!coincide(h)) continue;
    const clave = aTexto(h.cedula).trim().toUpperCase() || aTexto(h.id);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(h);
    if (salida.length >= limite) break;
  }
  return salida;
};

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

export const TRATAMIENTOS = [
  'tratam_ninguno', 'tratam_ar', 'tratam_ar_azul', 'tratam_azul',
  'tratam_tinturado', 'tratam_foto', 'tratam_trans'
];

const LONGITUD_CEDULA = 10;

export const CLAVES_ACEPTADAS = ['paciente', 'value', 'historial', 'hoy'];

/**
 * Maneja el cambio de cédula en el formulario clínico.
 */
export const aplicarCedula = ({ paciente, value, historial = [], hoy = hoyISO() } = {}) => {
  const documento = aTexto(value).trim().toUpperCase();
  const completa = documento.length >= LONGITUD_CEDULA;
  const existente = completa
    ? (historial || []).find(p =>
      aTexto(p?.cedula).trim().toUpperCase() === documento && 
      aTexto(p?.nombre).trim().toUpperCase() !== 'CONSUMIDOR FINAL')
    : null;

  if (!existente) {
    return { ficha: { ...paciente, cedula: value }, encontro: false };
  }

  const ficha = crearEstadoPaciente(hoy);
  for (const [campo, dato] of Object.entries(existente)) {
    if (dato !== null && dato !== undefined) {
      ficha[campo] = dato;
    }
  }

  ficha.fecha = hoy;
  ficha.cedula = value;
  ficha.id = ''; // Nueva consulta
  ficha.pedido_id = '';

  // Limpia datos de venta y notas específicas sin tocar la refracción.
  CAMPOS_DE_VENTA.forEach(campo => { ficha[campo] = ''; });
  TRATAMIENTOS.forEach(campo => { ficha[campo] = 'NO'; });
  ficha.descuento = '0';
  ficha.forma_pago = 'Efectivo';
  ficha.estado = 'Ninguno';

  return { ficha, encontro: true };
};

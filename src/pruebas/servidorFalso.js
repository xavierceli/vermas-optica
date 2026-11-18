// ---------------------------------------------------------------------------
// SERVIDOR FALSO DE SUPABASE PARA LAS PRUEBAS E2E
// ---------------------------------------------------------------------------
// Las pruebas de dos equipos necesitan un backend REAL y COMPARTIDO: dos
// contextos de navegador (dos dispositivos) contra el mismo estado. Supabase de
// verdad no sirve para esto: contamina datos, exige credenciales y depende de
// la red. Este modulo implementa lo justo de Supabase para ejercitar el camino
// completo: auth, PostgREST (lecturas y RPC) y las reglas de negocio que
// importan para detectar conflictos.
//
// Lo que reproduce del servidor real:
//   - aplicar_operaciones idempotente por id de operacion.
//   - guardar_consulta_clinica con comparacion de version (SQLSTATE 40001).
//   - crear_venta con comprobacion y descuento de stock (23514 si no alcanza).
//   - Las vistas vista_pacientes / vista_pacientes_versionada.
//   - Filtros, orden y paginacion de PostgREST que usa el cliente.
//
// Lo que NO reproduce: RLS, triggers, storage real ni Realtime. Para estas
// pruebas no hacen falta; el objetivo es el comportamiento entre dispositivos.
//
// El estado vive en el proceso de Node, asi que los dos navegadores comparten
// exactamente el mismo "servidor".
// ---------------------------------------------------------------------------

const json = (cuerpo, status = 200) => ({ status, cuerpo });

export const errorSql = (mensaje, sqlstate = 'P0001') => {
  const error = new Error(mensaje);
  error.sqlstate = sqlstate;
  return error;
};

const ahora = () => new Date().toISOString();

const nuevoId = (prefijo, estado) => {
  const n = (estado.secuencia = (estado.secuencia || 0) + 1);
  return `${prefijo}-${n}`;
};

// --- Datos de ejemplo -------------------------------------------------------

export const crearEstado = () => ({
  pacientes: new Map(),
  consultas: new Map(),
  ventas: new Map(),
  pagos: [],
  revisiones: [],
  inventario: new Map(),
  precios: new Map(),
  archivados: [],
  operaciones: new Map(),
  secuencia: 0
});

export const sembrar = estado => {
  estado.pacientes.set('11111111-1111-4111-8111-111111111111', {
    id: '11111111-1111-4111-8111-111111111111',
    cedula: '1712345678',
    nombre: 'Paciente Demo',
    telefono: '0991234567',
    correo: null,
    fecha_nacimiento: null,
    antecedentes: null,
    alias: null
  });

  estado.consultas.set('22222222-2222-4222-8222-222222222222', {
    id: '22222222-2222-4222-8222-222222222222',
    paciente_id: '11111111-1111-4111-8111-111111111111',
    fecha: '2026-01-15 10:00',
    k1_d_od: '42',
    k2_d_od: '43',
    obs_k_od: '',
    sync_version: 1,
    archived_at: null
  });

  estado.inventario.set(1, {
    id: 1,
    codigo: 'ARM-1',
    nombre_accesorio: 'Armazón Demo',
    categoria: 'Armazón',
    precio: '100',
    stock: 1,
    sync_version: 1
  });

  estado.precios.set(1, {
    id: 1,
    tipo: 'Armazón',
    detalle: 'Armazón Demo',
    precio: '100',
    sync_version: 1
  });

  return estado;
};

// --- Vistas ----------------------------------------------------------------

const ventaDeConsulta = (estado, consultaId) =>
  [...estado.ventas.values()].find(venta => venta.consulta_id === consultaId) || null;

export const filaVista = (estado, consulta) => {
  const paciente = estado.pacientes.get(consulta.paciente_id) || {};
  const venta = ventaDeConsulta(estado, consulta.id);

  return {
    ...consulta,
    id: consulta.id,
    paciente_id: consulta.paciente_id,
    patient_id: consulta.paciente_id,
    cedula: paciente.cedula ?? null,
    nombre: paciente.nombre ?? null,
    telefono: paciente.telefono ?? null,
    correo: paciente.correo ?? null,
    fecha_nacimiento: paciente.fecha_nacimiento ?? null,
    antecedentes: paciente.antecedentes ?? null,
    alias: paciente.alias ?? null,
    sync_version_consulta: Number(consulta.sync_version || 0),
    pedido_id: venta?.id ?? null,
    fecha_venta: venta?.fecha ?? null,
    venta: venta?.venta ?? null,
    abono: venta?.abono ?? '0',
    estado: venta?.estado ?? 'Ninguno',
    comprobante_url: venta?.comprobante_url ?? null
  };
};

export const vistaPacientes = estado =>
  [...estado.consultas.values()]
    .map(consulta => filaVista(estado, consulta))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

// --- Filtros, orden y paginacion de PostgREST ------------------------------

const valorIn = (params, campo) => {
  const valor = params.get(campo);
  if (!valor || !valor.startsWith('in.(')) return null;
  return valor.slice(4, -1).split(',').map(texto => texto.replace(/^"|"$/g, ''));
};

const aplicarFiltros = (filas, params) => {
  let resultado = filas;

  for (const [campo, valor] of params.entries()) {
    if (campo === 'select' || campo === 'order' || campo === 'limit' || campo === 'offset' || campo === 'apikey') {
      continue;
    }
    if (valor.startsWith('eq.')) {
      const esperado = valor.slice(3);
      resultado = resultado.filter(fila => String(fila?.[campo]) === String(esperado));
    } else if (valor.startsWith('in.(')) {
      const lista = valorIn(params, campo) || [];
      resultado = resultado.filter(fila => lista.includes(String(fila?.[campo])));
    } else if (valor === 'is.null') {
      resultado = resultado.filter(fila => fila?.[campo] === null || fila?.[campo] === undefined);
    }
  }

  const or = params.get('or');
  if (or) {
    const terminos = [...or.matchAll(/ilike\.%?([^%,)]+)/gi)].map(match => match[1].toLowerCase());
    if (terminos.length > 0) {
      resultado = resultado.filter(fila => terminos.some(termino =>
        String(fila?.nombre || '').toLowerCase().includes(termino)
        || String(fila?.cedula || '').toLowerCase().includes(termino)
      ));
    }
  }

  return resultado;
};

const aplicarOrden = (filas, params) => {
  const orden = params.get('order');
  if (!orden) return filas;

  const criterios = orden.split(',').map(parte => {
    const [campo, direccion] = parte.split('.');
    return { campo, descendente: direccion === 'desc' };
  });

  return [...filas].sort((a, b) => {
    for (const { campo, descendente } of criterios) {
      const va = a?.[campo];
      const vb = b?.[campo];
      if (va === vb) continue;
      const comparacion = String(va ?? '').localeCompare(String(vb ?? ''));
      return descendente ? -comparacion : comparacion;
    }
    return 0;
  });
};

const aplicarRango = (filas, params) => {
  const desde = Number(params.get('offset') || 0);
  const limite = params.has('limit') ? Number(params.get('limit')) : filas.length;
  return filas.slice(desde, desde + limite);
};

const consultarTabla = (estado, tabla, params) => {
  let filas;
  switch (tabla) {
    case 'vista_pacientes':
    case 'vista_pacientes_versionada':
      filas = vistaPacientes(estado);
      break;
    case 'pacientes_archivados':
      return estado.archivados.map(cedula => ({ cedula }));
    case 'consultas_clinicas':
      filas = [...estado.consultas.values()].map(consulta => ({ ...consulta }));
      break;
    case 'pedidos_ventas':
      filas = [...estado.ventas.values()];
      break;
    case 'pacientes_perfil':
      filas = [...estado.pacientes.values()];
      break;
    case 'inventario':
      filas = [...estado.inventario.values()];
      break;
    case 'lista_precios':
      filas = [...estado.precios.values()];
      break;
    case 'pagos':
      filas = estado.pagos;
      break;
    default:
      // Tabla desconocida: respuesta valida y vacia para que la app degrade.
      return [];
  }

  filas = aplicarFiltros(filas, params);
  filas = aplicarOrden(filas, params);
  filas = aplicarRango(filas, params);
  return filas;
};

// --- Operaciones del outbox ------------------------------------------------

const upsertPaciente = (estado, perfil = {}) => {
  const cedula = String(perfil.cedula || '').trim().toUpperCase();
  let paciente = [...estado.pacientes.values()]
    .find(fila => String(fila.cedula || '').toUpperCase() === cedula);

  if (!paciente) {
    paciente = {
      id: perfil.id || nuevoId('paciente', estado),
      cedula,
      nombre: perfil.nombre || ''
    };
    estado.pacientes.set(paciente.id, paciente);
  }

  for (const campo of ['nombre', 'telefono', 'correo', 'fecha_nacimiento', 'antecedentes', 'alias']) {
    if (perfil[campo]) paciente[campo] = perfil[campo];
  }

  return paciente;
};

export const guardarConsultaFalsa = (estado, operacion) => {
  const id = operacion.payload?.p_consulta_id;
  const payload = operacion.payload?.p_payload || {};
  const perfil = payload.paciente || {};
  const consulta = { ...(payload.consulta || {}) };

  delete consulta.id;
  delete consulta.paciente_id;
  delete consulta.sync_version;
  delete consulta.server_updated_at;

  const paciente = upsertPaciente(estado, perfil);
  const actual = estado.consultas.get(id);
  const base = payload.base_version;

  if (actual && base !== null && base !== undefined && Number(actual.sync_version) !== Number(base)) {
    throw errorSql(
      `La evaluación clínica fue modificada en otro dispositivo (servidor ${actual.sync_version}, local ${base}).`,
      '40001'
    );
  }

  if (actual) {
    estado.revisiones.push({
      consulta_id: id,
      version: actual.sync_version,
      snapshot: { ...actual }
    });
  }

  const version = actual ? Number(actual.sync_version) + 1 : 0;

  estado.consultas.set(id, {
    ...(actual || {}),
    ...consulta,
    id,
    paciente_id: paciente.id,
    sync_version: version,
    archived_at: actual?.archived_at ?? null
  });

  return {
    consulta_id: id,
    paciente_id: paciente.id,
    creada: !actual,
    sync_version: version
  };
};

export const crearVentaFalsa = (estado, operacion) => {
  const ventaId = operacion.payload?.p_venta_id;
  const payload = operacion.payload?.p_payload || {};

  if (estado.ventas.has(ventaId)) {
    return {
      venta_id: ventaId,
      version: estado.ventas.get(ventaId).sync_version,
      items: []
    };
  }

  const paciente = upsertPaciente(estado, payload.paciente || {});
  let consultaId = payload.consulta_id || null;

  if (consultaId) {
    const consulta = estado.consultas.get(consultaId);
    if (!consulta) throw errorSql(`La consulta ${consultaId} no existe.`, '23503');
    if (consulta.paciente_id !== paciente.id) {
      throw errorSql(`La consulta ${consultaId} pertenece a otro paciente.`, '23514');
    }
  } else {
    consultaId = `consulta-venta-${ventaId}`;
    estado.consultas.set(consultaId, {
      id: consultaId,
      paciente_id: paciente.id,
      fecha: payload.consulta?.fecha || ahora().slice(0, 10),
      sync_version: 0,
      archived_at: null
    });
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const vistos = new Set();

  for (const item of items) {
    const producto = estado.inventario.get(Number(item.inventario_id));
    if (!producto) throw errorSql('Producto de inventario inexistente.', '23503');
    if (vistos.has(producto.id)) throw errorSql('Producto duplicado en items.', '22023');
    vistos.add(producto.id);

    const cantidad = Number(item.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      throw errorSql('Cantidad de item inválida.', '22023');
    }
    if (Number(producto.stock) < cantidad) {
      throw errorSql(
        `Stock insuficiente para el producto ${producto.codigo} (disponible: ${producto.stock}, solicitado: ${cantidad}).`,
        '23514'
      );
    }
  }

  for (const item of items) {
    const producto = estado.inventario.get(Number(item.inventario_id));
    producto.stock -= Number(item.cantidad);
    producto.sync_version = Number(producto.sync_version || 0) + 1;
  }

  const itemsPorInventario = {};
  for (const item of items) {
    const id = Number(item.inventario_id);
    itemsPorInventario[id] = (itemsPorInventario[id] || 0) + Number(item.cantidad);
  }

  const venta = {
    ...(payload.venta || {}),
    id: ventaId,
    paciente_id: paciente.id,
    consulta_id: consultaId,
    abono: '0',
    tipo_cambio: null,
    sync_version: 1,
    items_por_inventario: itemsPorInventario
  };
  estado.ventas.set(ventaId, venta);

  return { venta_id: ventaId, version: 1, items };
};

const registrarPagoFalso = (estado, operacion) => {
  const pedidoId = operacion.payload?.p_pedido_id;
  const clave = operacion.payload?.p_idempotency_key;
  const monto = Number(operacion.payload?.p_monto);

  if (estado.pagos.some(pago => pago.idempotency_key === clave)) {
    return { pago_id: estado.pagos.find(pago => pago.idempotency_key === clave).id, replay: true };
  }

  const venta = estado.ventas.get(pedidoId);
  if (!venta) throw errorSql(`El pedido ${pedidoId} no existe.`, 'P0002');

  const pago = {
    id: nuevoId('pago', estado),
    idempotency_key: clave,
    pedido_id: pedidoId,
    monto,
    metodo: operacion.payload?.p_metodo || 'Efectivo',
    created_at: ahora()
  };
  estado.pagos.push(pago);
  venta.abono = String(Number(venta.abono || 0) + monto);

  return { pago_id: pago.id, pedido_id: pedidoId, total_abonado: venta.abono };
};

const cambiarEstadoFalso = (estado, operacion) => {
  const venta = estado.ventas.get(operacion.payload?.p_venta_id);
  if (!venta) throw errorSql('La venta no existe.', 'P0002');
  venta.estado = operacion.payload?.p_estado;
  return { venta_id: venta.id, estado: venta.estado };
};

const anularVentaFalsa = (estado, operacion) => {
  const venta = estado.ventas.get(operacion.payload?.p_venta_id);
  if (!venta) throw errorSql('La venta no existe.', 'P0002');
  if (venta.estado === 'Anulado') return { venta_id: venta.id, estado: 'Anulado' };

  venta.estado = 'Anulado';
  venta.abono = '0';

  // Devolver stock de los items vendidos (como anular_venta real).
  for (const [inventarioId, cantidad] of Object.entries(venta.items_por_inventario || {})) {
    const producto = estado.inventario.get(Number(inventarioId));
    if (producto) producto.stock += Number(cantidad);
  }

  return { venta_id: venta.id, estado: 'Anulado' };
};

const archivarConsultaFalsa = (estado, operacion) => {
  const id = operacion.payload?.p_consulta_id;
  const consulta = estado.consultas.get(id);
  if (!consulta) return { consulta_id: id, archivada: false };
  consulta.archived_at = ahora();
  consulta.sync_version = Number(consulta.sync_version || 0) + 1;
  return { consulta_id: id, archivada: true };
};

const esConflicto = error =>
  error?.sqlstate === '40001'
  || error?.sqlstate === '23514'
  || /stock insuficiente|modificad[ao] en otro dispositivo/i.test(error?.message || '');

export const aplicarOperacion = (estado, operacion) => {
  if (estado.operaciones.has(operacion.id)) {
    return {
      id: operacion.id,
      status: 'applied',
      result: estado.operaciones.get(operacion.id),
      replay: true
    };
  }

  try {
    let resultado;
    switch (operacion.type) {
      case 'GUARDAR_CONSULTA':
        resultado = guardarConsultaFalsa(estado, operacion);
        break;
      case 'CREAR_VENTA':
        resultado = crearVentaFalsa(estado, operacion);
        break;
      case 'REGISTRAR_PAGO':
        resultado = registrarPagoFalso(estado, operacion);
        break;
      case 'CAMBIAR_ESTADO_VENTA':
        resultado = cambiarEstadoFalso(estado, operacion);
        break;
      case 'ANULAR_VENTA':
        resultado = anularVentaFalsa(estado, operacion);
        break;
      case 'ARCHIVAR_CONSULTA':
        resultado = archivarConsultaFalsa(estado, operacion);
        break;
      default:
        throw errorSql(`Tipo de operación no soportado: ${operacion.type}`, '22023');
    }

    estado.operaciones.set(operacion.id, resultado);
    return { id: operacion.id, status: 'applied', result: resultado, replay: false };
  } catch (error) {
    return {
      id: operacion.id,
      status: esConflicto(error) ? 'conflict' : 'failed',
      error: error.message,
      sqlstate: error.sqlstate
    };
  }
};

// --- Sesion falsa ----------------------------------------------------------

const base64url = objeto => Buffer.from(JSON.stringify(objeto)).toString('base64url');

export const crearSesion = (email = 'admin@vermas.test', id = 'usuario-admin') => {
  const expira = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = [
    base64url({ alg: 'HS256', typ: 'JWT' }),
    base64url({ sub: id, email, role: 'authenticated', exp: expira }),
    'firma-de-prueba'
  ].join('.');

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expira,
    refresh_token: 'refresh-de-prueba',
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      app_metadata: {},
      user_metadata: {},
      created_at: ahora()
    }
  };
};

// --- Router ----------------------------------------------------------------

export const atenderPeticion = (estado, { method, url, body }) => {
  const parsed = new URL(url, 'https://falso.supabase.co');
  const partes = parsed.pathname.split('/').filter(Boolean);

  if (method === 'OPTIONS') return { status: 204, cuerpo: null };

  // Auth
  if (partes[0] === 'auth' && partes[1] === 'v1') {
    if (partes[2] === 'token') {
      return json(crearSesion(body?.email));
    }
    if (partes[2] === 'logout') {
      return { status: 204, cuerpo: null };
    }
    if (partes[2] === 'user') {
      return json(crearSesion().user);
    }
    return json({});
  }

  // Storage: lo justo para que una subida no rompa la prueba.
  if (partes[0] === 'storage') {
    return json({ Key: 'archivo', Id: 'archivo' });
  }

  if (partes[0] !== 'rest' || partes[1] !== 'v1') {
    return json({ message: `Ruta no soportada: ${parsed.pathname}` }, 404);
  }

  // RPC
  if (partes[2] === 'rpc') {
    const funcion = partes[3];
    if (funcion === 'aplicar_operaciones') {
      const operaciones = Array.isArray(body?.p_operaciones) ? body.p_operaciones : [];
      return json({
        results: operaciones.map(operacion => aplicarOperacion(estado, operacion)),
        processed_at: ahora()
      });
    }
    if (funcion === 'mi_rol') return json('admin');
    if (funcion === 'contar_registros_paciente') {
      return json({ consultas: estado.consultas.size, ventas: estado.ventas.size, pagos: estado.pagos.length, total: 0 });
    }
    if (funcion === 'eliminar_paciente_definitivo') {
      return json({ eliminado: true, consultas: 0, ventas: 0 });
    }
    return json({ message: `RPC no soportada: ${funcion}` }, 404);
  }

  // Tabla
  const tabla = partes[2];
  return json(consultarTabla(estado, tabla, parsed.searchParams));
};

// --- Servidor listo para Playwright ---------------------------------------

export const crearServidorFalso = ({ semilla = true } = {}) => {
  const estado = crearEstado();
  if (semilla) sembrar(estado);

  const cabeceras = {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS'
  };

  return {
    estado,
    reiniciar({ volverASembrar = true } = {}) {
      const limpio = crearEstado();
      if (volverASembrar) sembrar(limpio);
      for (const clave of Object.keys(estado)) delete estado[clave];
      Object.assign(estado, limpio);
    },
    async manejarRuta(ruta) {
      const peticion = ruta.request();
      const metodo = peticion.method();
      let cuerpo = null;
      if (metodo !== 'GET' && metodo !== 'HEAD') {
        try {
          cuerpo = peticion.postDataJSON();
        } catch {
          cuerpo = null;
        }
      }

      const respuesta = atenderPeticion(estado, { method: metodo, url: peticion.url(), body: cuerpo });

      await ruta.fulfill({
        status: respuesta.status,
        headers: cabeceras,
        body: respuesta.cuerpo === null ? undefined : JSON.stringify(respuesta.cuerpo)
      });
    }
  };
};

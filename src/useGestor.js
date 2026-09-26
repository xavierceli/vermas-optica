import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { safeString, safeNum, comprimirImagen, calcularEdad } from './utilidades'
import { localDb, createUuid as generarId, resetLocalDatabase } from './localDb'
import { archivarConsultaLocal, guardarConsultaLocal, guardarInventarioLocal, guardarPrecioLocal, guardarVentaLocal, obtenerSnapshotLocal, importLegacyCache, anularVentaLocal, eliminarInventarioLocal, eliminarPrecioLocal, guardarAdjuntoLocal, anularVentaConReembolso } from './localRepository'
import { iniciarMotorSync, suscribirSync, sincronizarAhora, fijarSesionAusente } from './syncEngine'
import { enrolarDispositivo, leerEnrolamiento, intentarDesbloqueo, revocarEnrolamiento, pinValido } from './seguridad'
import { aplicarAvisoQueratometria } from './reglas'

export function useGestor() {
  const [estaAutenticado, setEstaAutenticado] = useState(false);
  const [cargandoAuth, setCargandoAuth] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const mostrarToast = (mensaje, tipo = 'success') => {
    setToast({ mensaje, tipo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500); 
  };

  const [confirmDialog, setConfirmDialog] = useState({ visible: false, mensaje: '', onConfirm: null });
  const solicitarConfirmacion = (mensaje, onConfirmCallback) => {
    setConfirmDialog({ visible: true, mensaje: mensaje, onConfirm: onConfirmCallback });
  };

  const dateObj = new Date();
  const hoy = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;

  const estadoInicial = {
    id: '', paciente_id: '', pedido_id: '',
    fecha: hoy, cedula: '', nombre: '', alias: '', telefono: '', correo: '', notas_clinicas: '', fecha_nacimiento: '', antecedentes: '',
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
  };
  
  const invInicial = { categoria: 'Armazon', codigo: '', tipo_armazon: '', material: '', descripcion: '', material_nota: '', param_horizontal: '', param_puente: '', param_vertical: '', param_diagonal: '', param_frontal: '', param_varillas: '', nombre_accesorio: '', caracteristica: '', costo_compra: '', precio: '', stock: '', imagen_url: '' };
  const precioInicial = { tipo_lente: 'Monofocal', material: 'Plástico', tratamiento: 'Ninguno', rango_medida: '', costo_laboratorio: '', precio_sugerido: '', notas: '' };

  const [paciente, setPaciente] = useState(estadoInicial);
  const [historial, setHistorial] = useState([]);
  const [inventario, setInventario] = useState([]);
  const [listaPrecios, setListaPrecios] = useState([]);
  
  const [nuevoItemInv, setNuevoItemInv] = useState(invInicial);
  const [nuevoPrecio, setNuevoPrecio] = useState(precioInicial);
  const [editandoInvId, setEditandoInvId] = useState(null);
  const [editandoPrecioId, setEditandoPrecioId] = useState(null);
  const [imagenSeleccionada, setImagenSeleccionada] = useState(null);
  const [cargandoImagen, setCargandoImagen] = useState(false);
  const [busqueda, setBusqueda] = useState(''); 
  const [busquedaPrecio, setBusquedaPrecio] = useState('');
  const [editandoId, setEditandoId] = useState(null); 
  const [vistaActual, setVistaActual] = useState('historial'); 
  const [intentadoGuardar, setIntentadoGuardar] = useState(false);
  
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);
  const [accesorioOriginalId, setAccesorioOriginalId] = useState('');
  const [medidasPaciente, setMedidasPaciente] = useState([]);

  // LOTE 6: números oficiales calculados por el servidor (exactos sobre TODA la base)
  const [statsRemotos, setStatsRemotos] = useState(null);
  const [syncEstado, setSyncEstado] = useState({ phase: 'idle', online: true, pending: 0, conflicts: 0, lastSync: null, lastError: null });
  // Entrada con PIN local: hay datos en el dispositivo pero no sesion del servidor.
  const [modoSinConexion, setModoSinConexion] = useState(false);
  const [dispositivo, setDispositivo] = useState({ enrolado: false, cargando: true, identidad: null });

  const refrescarDispositivo = async () => {
    const enrolamiento = await leerEnrolamiento(localDb.meta);
    setDispositivo({ enrolado: Boolean(enrolamiento), cargando: false, identidad: enrolamiento?.identidad || null });
  };

  const configurarAccesoSinConexion = async pin => {
    if (!pinValido(pin)) {
      mostrarToast('El PIN debe tener entre 4 y 8 dígitos.', 'warning');
      return false;
    }
    await enrolarDispositivo({ pin, identidad: dispositivo.identidad, meta: localDb.meta });
    await refrescarDispositivo();
    mostrarToast('Acceso sin conexión configurado en este dispositivo.', 'success');
    return true;
  };

  const desactivarAccesoSinConexion = async () => {
    await revocarEnrolamiento(localDb.meta);
    await refrescarDispositivo();
    mostrarToast('Acceso sin conexión desactivado.', 'success');
  };



  const cerrarSesion = () => {
    const estabaSinConexion = modoSinConexion;
    const aviso = estabaSinConexion
      ? 'Vas a salir del modo sin conexión. Los datos de este dispositivo NO se borran: puedes volver a entrar con tu PIN.'
      : '¿Estás seguro de cerrar sesión? Tendrás que volver a ingresar con tus credenciales.';
    solicitarConfirmacion(aviso, async () => {
      setModoSinConexion(false);
      fijarSesionAusente(false);
      if (!estabaSinConexion) await supabase.auth.signOut();
    });
  };

  const aplicarSnapshotLocal = snapshot => {
    if (!snapshot) return;
    setHistorial(snapshot.historial || []);
    setInventario(snapshot.inventory || []);
    setListaPrecios(snapshot.prices || []);
  };

  const obtenerDatos = async ({ sync = true } = {}) => {
    await importLegacyCache();
    const snapshot = await obtenerSnapshotLocal();
    aplicarSnapshotLocal(snapshot);
    const remoteStats = (await localDb.meta.get('remoteStats'))?.value || null;
    if (remoteStats) setStatsRemotos(remoteStats);
    if (sync) {
      void sincronizarAhora({ pull: true }).then(async () => {
        aplicarSnapshotLocal(await obtenerSnapshotLocal());
      });
    }
    return snapshot;
  };
  useEffect(() => {
    iniciarMotorSync();
    return suscribirSync(setSyncEstado);
  }, []);
  useEffect(() => {
    let vigente = true;
    leerEnrolamiento(localDb.meta).then(enrolamiento => {
      if (vigente) setDispositivo({ enrolado: Boolean(enrolamiento), cargando: false, identidad: enrolamiento?.identidad || null });
    });
    return () => { vigente = false; };
  }, []);
  // Desbloqueo con PIN local: abre los datos YA guardados en este dispositivo.
  // No genera ningun token del servidor, por lo que la sincronizacion queda
  // suspendida hasta que se vuelva a entrar con correo y contrasena.
  const entrarSinConexion = async pin => {
    const resultado = await intentarDesbloqueo({
      pin,
      meta: localDb.meta,
      alBloquear: async () => {
        await resetLocalDatabase();
        mostrarToast('Demasiados intentos. Los datos de este dispositivo se borraron por seguridad.', 'error');
      }
    });
    if (resultado.ok) {
      setModoSinConexion(true);
      fijarSesionAusente(true);
      setEstaAutenticado(true);
      await obtenerDatos({ sync: false });
      mostrarToast('Modo sin conexión: los datos locales están disponibles.', 'warning');
      return { ok: true };
    }
    return resultado;
  };

  useEffect(() => {
    let montado = true;

    const timerSeguridad = setTimeout(() => {
      if (montado) setCargandoAuth(false);
    }, 1000);

    // Si viene de un enlace de recuperación, bloquear el acceso hasta crear la nueva clave
    const cambioClavePendiente = sessionStorage.getItem('vermas_cambio_clave') === '1';

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (montado) {
        clearTimeout(timerSeguridad);
        setEstaAutenticado(!!session && !cambioClavePendiente);
        if (session && !cambioClavePendiente) {
          fijarSesionAusente(false);
          setModoSinConexion(false);
          obtenerDatos();
        }
        setCargandoAuth(false);
      }
    }).catch(() => {
      if (montado) {
        clearTimeout(timerSeguridad);
        if (!cambioClavePendiente) obtenerDatos();
        setCargandoAuth(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (montado) {
        if (event === 'PASSWORD_RECOVERY') {
          sessionStorage.setItem('vermas_cambio_clave', '1');
          // Un restablecimiento de contrasena nunca debe coexistir con el acceso
          // por PIN: si alguien esta cambiando la clave, el dispositivo no puede
          // quedarse abierto con el desbloqueo local.
          setModoSinConexion(false);
          fijarSesionAusente(false);
          setEstaAutenticado(false);
          setCargandoAuth(false);
          return;
        }
        const siguePendiente = sessionStorage.getItem('vermas_cambio_clave') === '1';
        setEstaAutenticado(!!session && !siguePendiente);
        setCargandoAuth(false);
        if (session && !siguePendiente) obtenerDatos();
      }
    });

    return () => {
      montado = false;
      clearTimeout(timerSeguridad);
      subscription?.unsubscribe();
    };
    // La suscripción de auth debe vivir una sola vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const manejarCambio = (e) => {
    let { name, value, type, tagName } = e.target;
    if (name === 'correo') value = safeString(value).toLowerCase();
    else if (type === 'text' || tagName === 'TEXTAREA') value = safeString(value).toUpperCase();
    
    let nuevoPaciente = { ...paciente, [name]: value };

    // REGLA CLÍNICA: cualquier queratometría alta deja constancia en observaciones.
    const campoQueratometria = /^(k1_d|k2_d)_(od|oi)$/.exec(name);
    if (campoQueratometria) {
      nuevoPaciente = aplicarAvisoQueratometria(nuevoPaciente, campoQueratometria[2]);
    }
    if (name === 'cedula') {
      const docCompleto = String(value).length >= 10; // cédula completa (o pasaporte largo)
      const pacienteExistente = docCompleto
        ? (historial || []).find(p => safeString(p?.cedula) === safeString(value) && safeString(p?.nombre) !== 'CONSUMIDOR FINAL')
        : null;
      if (pacienteExistente) {
        nuevoPaciente = { ...pacienteExistente, fecha: hoy, cedula: value, id: '', pedido_id: '' };
        ['venta', 'abono', 'notas', 'notas_clinicas', 'codigo_armazon', 'tipo_armazon', 'param_horizontal', 'param_puente', 'param_vertical', 'param_diagonal', 'tipo_lente', 'material_lente', 'material_nota', 'tratam_tinturado_nota', 'tratam_foto_nota', 'tratam_trans_nota', 'pago_nota', 'accesorio_id', 'costo_armazon_int', 'costo_lunas_int', 'costo_accesorio_int', 'costo_tratamientos_int', 'costo_varios_int', 'comprobante_url'].forEach(k => nuevoPaciente[k] = '');
        ['tratam_ar', 'tratam_ar_azul', 'tratam_azul', 'tratam_tinturado', 'tratam_foto', 'tratam_trans', 'tratam_ninguno'].forEach(k => nuevoPaciente[k] = 'NO');
        nuevoPaciente.descuento = '0'; nuevoPaciente.forma_pago = 'Efectivo'; nuevoPaciente.estado = 'Ninguno';
      } else {
        // Paciente NUEVO o cédula incompleta: SOLO actualizar la cédula, jamás borrar el formulario
        nuevoPaciente = { ...paciente, cedula: value };
      }
    }
    setPaciente(nuevoPaciente);
    if (intentadoGuardar) setIntentadoGuardar(false);
  };

  const manejarCambioPrecio = (e) => {
    let { name, value, type, tagName } = e.target;
    if (type === 'text' || tagName === 'TEXTAREA') value = safeString(value).toUpperCase();
    setNuevoPrecio({ ...nuevoPrecio, [name]: value });
  };

  const guardarPrecio = async () => {
    try {
      if (!nuevoPrecio.rango_medida) return mostrarToast('Ingresa el rango de medida.', 'warning');
      const datosAGuardar = {
        ...nuevoPrecio,
        costo_laboratorio: Number(safeNum(nuevoPrecio.costo_laboratorio).toFixed(2)),
        precio_sugerido: Number(safeNum(nuevoPrecio.precio_sugerido).toFixed(2))
      };
      await guardarPrecioLocal({ id: editandoPrecioId || undefined, ...datosAGuardar });
      setNuevoPrecio(precioInicial);
      setEditandoPrecioId(null);
      await obtenerDatos({ sync: false });
      void sincronizarAhora({ pull: false });
      mostrarToast('Tarifa guardada en este dispositivo.', 'success');
    } catch (err) {
      mostrarToast('Error al guardar: ' + err.message, 'error');
    }
  };

  const cargarParaEditarPrecio = (item) => { setNuevoPrecio({ ...item }); setEditandoPrecioId(item.id); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const eliminarPrecio = (id) => {
    solicitarConfirmacion('¿Seguro que deseas eliminar?', async () => {
      try {
        await eliminarPrecioLocal(id);
        await obtenerDatos({ sync: false });
        void sincronizarAhora({ pull: false });
        mostrarToast('Tarifa eliminada localmente.', 'success');
      } catch (err) {
        mostrarToast('Error al eliminar: ' + err.message, 'error');
      }
    });
  };

  const manejarCambioInv = (e) => {
    let { name, value, type, tagName } = e.target;
    if (type === 'text' || tagName === 'TEXTAREA') value = safeString(value).toUpperCase();
    setNuevoItemInv({ ...nuevoItemInv, [name]: value });
  };
  
  const guardarItemInventario = async () => {
    try {
      setCargandoImagen(true);
      let urlImagen = nuevoItemInv.imagen_url || null;

      if (imagenSeleccionada) {
        const archivoComprimido = await comprimirImagen(imagenSeleccionada);
        const nombreArchivo = `producto_${Date.now()}_${generarId().substring(0, 8)}.jpg`;
        // Se intenta subir; si no hay red o el bucket falla, la foto se guarda
        // como Blob en el dispositivo y sube sola al recuperar conexion. Antes
        // se perdia en silencio pese a que el aviso prometia lo contrario.
        let subido = false;
        if (navigator.onLine) {
          try {
            const { error: errSubida } = await supabase.storage
              .from('inventario_imagenes')
              .upload(nombreArchivo, archivoComprimido, { contentType: 'image/jpeg', upsert: true });
            if (errSubida) throw new Error(errSubida.message);
            const { data } = supabase.storage.from('inventario_imagenes').getPublicUrl(nombreArchivo);
            urlImagen = data.publicUrl;
            subido = true;
          } catch (errImg) {
            console.warn('No se pudo subir la foto ahora, se guardara localmente:', errImg);
          }
        }
        if (!subido) {
          await guardarAdjuntoLocal({
            blob: archivoComprimido,
            nombre: nombreArchivo,
            mime: 'image/jpeg',
            bucket: 'inventario_imagenes',
            refType: 'inventario',
            refId: editandoInvId || nuevoItemInv.id || generarId()
          });
          urlImagen = null;
          mostrarToast('Sin conexión: la foto quedó guardada en este dispositivo y se subirá sola.', 'warning');
        }
      }

      const datosAGuardar = {
        ...nuevoItemInv,
        imagen_url: urlImagen,
        precio: Number(safeNum(nuevoItemInv.precio).toFixed(2)),
        costo_compra: Number(safeNum(nuevoItemInv.costo_compra).toFixed(2)),
        stock: nuevoItemInv.stock === '' || nuevoItemInv.stock === null ? 1 : Math.max(0, Math.round(safeNum(nuevoItemInv.stock)))
      };
      Object.keys(datosAGuardar).forEach(key => { if (datosAGuardar[key] === '') datosAGuardar[key] = null; });
      await guardarInventarioLocal({ id: editandoInvId || undefined, ...datosAGuardar });
      setNuevoItemInv(invInicial);
      setEditandoInvId(null);
      setImagenSeleccionada(null);
      await obtenerDatos({ sync: false });
      void sincronizarAhora({ pull: false });
      mostrarToast('Producto guardado en este dispositivo.', 'success');
    } catch (e) {
      mostrarToast('Error: ' + e.message, 'error');
    } finally {
      setCargandoImagen(false);
    }
  };

  const cargarParaEditarInventario = (item) => {
    let itemFormateado = { ...item };
    Object.keys(itemFormateado).forEach(key => { if (itemFormateado[key] === null) itemFormateado[key] = ''; });
    setNuevoItemInv(itemFormateado); setEditandoInvId(item.id); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const cancelarEdicionInventario = () => { setNuevoItemInv(invInicial); setEditandoInvId(null); setImagenSeleccionada(null); };
  const eliminarItemInventario = (id) => {
    solicitarConfirmacion('¿Eliminar ítem?', async () => {
      try {
        await eliminarInventarioLocal(id);
        await obtenerDatos({ sync: false });
        void sincronizarAhora({ pull: false });
        mostrarToast('Ítem eliminado localmente.', 'success');
      } catch (err) {
        mostrarToast('Error al eliminar: ' + err.message, 'error');
      }
    });
  };

  const validarDocumento = (doc) => {
    const str = String(doc).trim().toUpperCase();
    if (!str) return false;
    if (str === '9999999999') return true;
    if (/^\d{10}$/.test(str)) return true;
    if (/^\d{13}$/.test(str)) return true;
    if (/^[A-Z0-9]{5,20}$/.test(str) && /[A-Z]/.test(str)) return true;
    return false;
  };

  const guardarPacienteClinico = async () => {
    if (guardando) return;

    try {
      if (!validarDocumento(paciente.cedula)) return mostrarToast("DOCUMENTO INVÁLIDO.", "error");

      const camposRefraccionObligatorios = ['avsl_od', 'avsc_od', 'esfera_od', 'cilindro_od', 'eje_od', 'adicion_od', 'dnp_od', 'avcl_od', 'avcc_od', 'avsl_oi', 'avsc_oi', 'esfera_oi', 'cilindro_oi', 'eje_oi', 'adicion_oi', 'dnp_oi', 'avcl_oi', 'avcc_oi'];
      const faltantes = camposRefraccionObligatorios.filter(campo => safeString(paciente[campo]).trim() === '');
      
      if (faltantes.length > 0) {
        setIntentadoGuardar(true);
        return mostrarToast("FALTAN DATOS de Refracción obligatorios.", "warning");
      }

      setGuardando(true);

      const perfilData = { cedula: safeString(paciente.cedula), nombre: safeString(paciente.nombre), alias: safeString(paciente.alias), telefono: safeString(paciente.telefono), correo: safeString(paciente.correo), fecha_nacimiento: safeString(paciente.fecha_nacimiento), antecedentes: safeString(paciente.antecedentes) };
      Object.keys(perfilData).forEach(k => { if (perfilData[k] === '') perfilData[k] = null; });

      const camposClinica = ['fecha', 'notas_clinicas', 'avsl_od', 'avsc_od', 'esfera_od', 'cilindro_od', 'eje_od', 'adicion_od', 'dnp_od', 'altura_od', 'avcl_od', 'avcc_od', 'avsl_oi', 'avsc_oi', 'esfera_oi', 'cilindro_oi', 'eje_oi', 'adicion_oi', 'dnp_oi', 'altura_oi', 'avcl_oi', 'avcc_oi', 'k1_d_od', 'k2_d_od', 'k1_mm_od', 'k2_mm_od', 'eje_k1_od', 'eje_k2_od', 'astig_corneal_od', 'eje_astig_od', 'obs_k_od', 'k1_d_oi', 'k2_d_oi', 'k1_mm_oi', 'k2_mm_oi', 'eje_k1_oi', 'eje_k2_oi', 'astig_corneal_oi', 'eje_astig_oi', 'obs_k_oi', 'auto_esf_od', 'auto_cil_od', 'auto_eje_od', 'auto_esf_oi', 'auto_cil_oi', 'auto_eje_oi', 'auto_esf_od_2', 'auto_cil_od_2', 'auto_eje_od_2', 'auto_esf_oi_2', 'auto_cil_oi_2', 'auto_eje_oi_2', 'lenso_esf_od', 'lenso_cil_od', 'lenso_eje_od', 'lenso_add_od', 'lenso_avl_od', 'lenso_avc_od', 'lenso_esf_oi', 'lenso_cil_oi', 'lenso_eje_oi', 'lenso_add_oi', 'lenso_avl_oi', 'lenso_avc_oi'];
      let clinicaData = {};
      camposClinica.forEach(k => clinicaData[k] = paciente[k] === '' ? null : paciente[k]);

      const idConsulta = editandoId || safeString(paciente.id) || generarId();

      // Conservar el ID antes del envío permite reintentar sin duplicar la evaluación.
      if (!editandoId && !paciente.id) {
        setPaciente(prev => ({ ...prev, id: idConsulta }));
      }

      await guardarConsultaLocal({
        patient: { ...perfilData, patient_id: paciente.patient_id || paciente.id },
        consultation: { ...clinicaData, id: idConsulta }
      });

      mostrarToast('Consulta guardada en este dispositivo.', 'success');
      await terminarGuardado();
      void sincronizarAhora({ pull: false });
      return;
    } catch(e) { 
      mostrarToast("Error: " + e.message, "error"); 
    } finally {
      setGuardando(false);
    }
  };

  const terminarGuardado = async () => {
    setPaciente(estadoInicial);
    setEditandoId(null);
    setIntentadoGuardar(false);
    setVistaActual('historial');
    await obtenerDatos({ sync: false });
  };

  const borrarHistoriaClinica = async (item) => {
    if (item.pedido_id) {
      return mostrarToast('Esta consulta tiene una venta asociada. Anular la venta no elimina el historial clínico.', 'warning');
    }
    try {
      await archivarConsultaLocal(item.id);
      await obtenerDatos({ sync: false });
      void sincronizarAhora({ pull: false });
      mostrarToast('Consulta archivada localmente.', 'success');
    } catch (err) {
      mostrarToast('No se pudo archivar la consulta: ' + err.message, 'error');
    }
  };

  const cargarParaEditarClinico = (item) => {
    let itemFormateado = { ...item };
    Object.keys(itemFormateado).forEach(key => { if (itemFormateado[key] === null) itemFormateado[key] = ''; });
    setPaciente({ ...estadoInicial, ...itemFormateado }); setEditandoId(item.id); setVistaActual('nueva_medicion'); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const abrirPedido = (item) => {
    let itemFormateado = { ...item };
    Object.keys(itemFormateado).forEach(key => { if (itemFormateado[key] === null) itemFormateado[key] = ''; });
    ['tratam_ar', 'tratam_ar_azul', 'tratam_azul', 'tratam_tinturado', 'tratam_foto', 'tratam_trans', 'tratam_ninguno'].forEach(k => { if(!itemFormateado[k]) itemFormateado[k] = 'NO'; });
    if(!itemFormateado.descuento) itemFormateado.descuento = '0';
    if(!itemFormateado.forma_pago) itemFormateado.forma_pago = 'Efectivo';

    const esVentaNueva = !safeString(itemFormateado.pedido_id);
    itemFormateado._nueva_venta = esVentaNueva;
    if (esVentaNueva) itemFormateado.pedido_id = generarId();

    const visitas = (historial || []).filter(h => safeString(h?.cedula) === safeString(item.cedula) && safeString(h?.nombre) !== 'CONSUMIDOR FINAL');
    setMedidasPaciente(visitas); setPedidoSeleccionado(itemFormateado); setAccesorioOriginalId(itemFormateado.accesorio_id || ''); setVistaActual('pedidos_form');
  };

  const crearVentaDirecta = () => {
    const ventaNueva = {
      ...estadoInicial,
      pedido_id: generarId(),
      _nueva_venta: true,
      nombre: 'CONSUMIDOR FINAL',
      cedula: '9999999999',
      estado: 'Entregado'
    };
    setMedidasPaciente([]); setPedidoSeleccionado(ventaNueva); setAccesorioOriginalId(''); setVistaActual('pedidos_form');
  };

  const cambiarMedicionPedido = (e) => {
    const idVisit = e.target.value; const visit = (historial || []).find(h => String(h?.id) === String(idVisit));
    if (visit) setPedidoSeleccionado(prev => ({ ...prev, esfera_od: visit.esfera_od, cilindro_od: visit.cilindro_od, eje_od: visit.eje_od, adicion_od: visit.adicion_od, dnp_od: visit.dnp_od, altura_od: visit.altura_od, esfera_oi: visit.esfera_oi, cilindro_oi: visit.cilindro_oi, eje_oi: visit.eje_oi, adicion_oi: visit.adicion_oi, dnp_oi: visit.dnp_oi, altura_oi: visit.altura_oi }));
  };

  const autoCalcularPrecio = (pedidoActual) => {
    if (!pedidoActual) return 0;
    let total = 0;

    // ARMAZÓN (busca su precio en el inventario por código)
    if (pedidoActual.codigo_armazon) {
      const armazonEncontrado = (inventario || []).find(
        item => String(item.codigo).trim().toUpperCase() === String(pedidoActual.codigo_armazon).trim().toUpperCase()
      );
      if (armazonEncontrado && armazonEncontrado.precio) {
        total += safeNum(armazonEncontrado.precio);
      }
    }

    // ACCESORIO (busca su precio en el inventario por id)
    if (pedidoActual.accesorio_id) {
      const accesorioEncontrado = (inventario || []).find(
        item => String(item.id) === String(pedidoActual.accesorio_id)
      );
      if (accesorioEncontrado && accesorioEncontrado.precio) {
        total += safeNum(accesorioEncontrado.precio);
      }
    }

    // MATERIALES Y TRATAMIENTOS: leídos de TU TARIFARIO (tipo_lente='CALCULO', rango='BASE')
    // Si no existe la fila, usa el precio histórico de respaldo para no quedarte en $0
    const bases = (listaPrecios || []).filter(p => safeString(p.tipo_lente) === 'CALCULO' && safeString(p.rango_medida) === 'BASE');
    const precioDe = (material) => {
      const fila = bases.find(b => safeString(b.material).trim().toUpperCase() === String(material).trim().toUpperCase());
      if (fila) return safeNum(fila.precio_sugerido);
      const respaldo = { 'PLÁSTICO': 20, 'POLICARBONATO': 30, 'REDUCIDO': 50, 'HIPERREDUCIDO': 70, 'OTROS': 0,
        'AR VERDE': 20, 'AR AZUL': 20, 'FILTRO AZUL': 35, 'TINTURADO': 20, 'FOTOCROMÁTICO': 55, 'TRANSITION': 100 };
      return respaldo[String(material).trim().toUpperCase()] || 0;
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

  const forzarRecalculo = () => { 
    if (!pedidoSeleccionado) return; 
    setPedidoSeleccionado(prev => ({ ...prev, venta: autoCalcularPrecio(prev) || '' })); 
  };

  const manejarCambioPedido = (e) => {
    let { name, value, type, checked, tagName } = e.target;
    let val = type === 'checkbox' ? (checked ? 'SI' : 'NO') : value;
    if (type === 'text' || tagName === 'TEXTAREA') val = safeString(val).toUpperCase();
    
    if (name === 'venta') { 
      setPedidoSeleccionado(prev => ({ ...prev, venta: val })); 
      return; 
    }

    setPedidoSeleccionado(prev => {
      const nuevo = { ...prev, [name]: val };
      const camposQueAfectanPrecio = ['codigo_armazon', 'material_lente', 'accesorio_id', 'tratam_ar', 'tratam_ar_azul', 'tratam_azul', 'tratam_tinturado', 'tratam_foto', 'tratam_trans', 'tratam_ninguno'];

      if (camposQueAfectanPrecio.includes(name)) {
        if (name === 'tratam_ninguno' && val === 'SI') {
          nuevo.tratam_ar = 'NO'; nuevo.tratam_ar_azul = 'NO'; nuevo.tratam_azul = 'NO'; nuevo.tratam_tinturado = 'NO'; nuevo.tratam_foto = 'NO'; nuevo.tratam_trans = 'NO';
        } else if (name.startsWith('tratam_') && name !== 'tratam_ninguno' && val === 'SI') {
          nuevo.tratam_ninguno = 'NO';
        }
        nuevo.venta = autoCalcularPrecio(nuevo);
      }
      return nuevo;
    });
  };

  const guardarPedido = async ({ montoAdicional = 0 } = {}) => {
    if (!pedidoSeleccionado) return;

    try {
      if (!validarDocumento(pedidoSeleccionado.cedula)) {
        throw new Error('El documento del paciente no es válido.');
      }

      const idPedido = pedidoSeleccionado.pedido_id || pedidoSeleccionado.id || generarId();
      const consultationId = pedidoSeleccionado.id || generarId();
      const cedulaPaciente = safeString(pedidoSeleccionado.cedula).trim().toUpperCase();
      const nombrePaciente = safeString(pedidoSeleccionado.nombre).trim() || (cedulaPaciente === '9999999999' ? 'CONSUMIDOR FINAL' : '');
      if (!nombrePaciente) throw new Error('El nombre del paciente es obligatorio.');

      const patientId = pedidoSeleccionado.patient_id || pedidoSeleccionado.paciente_id || generarId();
      const camposPedido = ['venta', 'abono', 'descuento', 'forma_pago', 'pago_nota', 'estado', 'notas', 'comprobante_url', 'codigo_armazon', 'tipo_armazon', 'param_horizontal', 'param_puente', 'param_vertical', 'param_diagonal', 'tipo_lente', 'material_lente', 'material_nota', 'accesorio_id', 'tratam_ninguno', 'tratam_ar', 'tratam_ar_azul', 'tratam_azul', 'tratam_tinturado', 'tratam_tinturado_nota', 'tratam_foto', 'tratam_foto_nota', 'tratam_trans', 'tratam_trans_nota', 'costo_armazon_int', 'costo_lunas_int', 'costo_accesorio_int', 'costo_tratamientos_int', 'costo_varios_int'];
      const venta = {};
      camposPedido.forEach(k => { venta[k] = pedidoSeleccionado[k] === '' ? null : pedidoSeleccionado[k]; });
      venta.id = idPedido;
      venta.pedido_id = idPedido;
      venta.patient_id = patientId;
      venta.consultation_id = consultationId;
      venta.fecha = hoy;
      venta.abono = pedidoSeleccionado._nueva_venta ? '0' : safeString(pedidoSeleccionado.abono || '0');
      venta.pago_nota = pedidoSeleccionado.pago_nota || '';
      venta.descuento = venta.descuento ?? '0';
      venta.forma_pago = venta.forma_pago || 'Efectivo';
      venta.estado = venta.estado || 'En laboratorio';

      const montoAPagar = pedidoSeleccionado._nueva_venta
        ? Number(safeNum(pedidoSeleccionado.abono).toFixed(2))
        : Number(safeNum(montoAdicional).toFixed(2));
      const initialPayment = montoAPagar > 0
        ? {
            monto: montoAPagar,
            metodo: venta.forma_pago,
            referencia: safeString(pedidoSeleccionado.pago_nota) || null,
            comprobantePath: safeString(pedidoSeleccionado.comprobante_url) || null,
            idempotencyKey: idPedido
          }
        : null;

      await guardarVentaLocal({
        patient: {
          id: patientId,
          patient_id: patientId,
          cedula: cedulaPaciente,
          nombre: nombrePaciente,
          alias: pedidoSeleccionado.alias,
          telefono: pedidoSeleccionado.telefono,
          correo: pedidoSeleccionado.correo,
          fecha_nacimiento: pedidoSeleccionado.fecha_nacimiento,
          antecedentes: pedidoSeleccionado.antecedentes
        },
        consultationId,
        sale: venta,
        initialPayment
      });

      // El guardado local ya quedo persistido: navegamos y refrescamos en segundo
      // plano para que el boton no espere un snapshot completo de IndexedDB.
      setPedidoSeleccionado(null);
      setVistaActual('pedidos_lista');
      mostrarToast('Venta guardada en este dispositivo.', 'success');
      void obtenerDatos({ sync: false }).then(() => sincronizarAhora({ pull: false }));
      return true;
    } catch (e) {
      mostrarToast('Error al guardar pedido: ' + e.message, 'error');
      return false;
    }
  };
  const cancelarPedido = (item) => {
    if (!item.pedido_id) {
      return mostrarToast('Este registro todavía no tiene una venta local.', 'warning');
    }

    const abono = Number(safeNum(item.abono).toFixed(2));
    // El servidor prohibe anular una venta con dinero abonado. La salida
    // correcta para la optica es devolver ese dinero de forma explicita y
    // trazable, no anular en silencio.
    const mensaje = abono > 0
      ? `¿Anular la venta? Tiene $${abono.toFixed(2)} abonado: primero se le devolverá ese dinero y luego se devolverá el stock.`
      : '¿Anular la venta y devolver el stock local?';

    solicitarConfirmacion(mensaje, async () => {
      try {
        const resultado = abono > 0
          ? await anularVentaConReembolso({ saleId: item.pedido_id, method: 'Efectivo' })
          : await anularVentaLocal(item.pedido_id);
        await obtenerDatos({ sync: false });
        const estado = await sincronizarAhora({ pull: false });
        const falloServidor = estado?.phase === 'error' ? estado.lastError : null;
        if (falloServidor) {
          mostrarToast('Hecho en este dispositivo, pero el servidor lo rechazó: ' + falloServidor, 'error');
          return;
        }
        if (resultado?.productosAusentes?.length) {
          mostrarToast(
            'Venta anulada. El stock de ' + resultado.productosAusentes.length +
            ' producto(s) no se pudo devolver aquí porque no existen en este dispositivo; se devolverá al sincronizar.',
            'warning'
          );
        } else {
          mostrarToast('Venta anulada localmente.', 'success');
        }
      } catch (err) {
        mostrarToast('Error al anular: ' + err.message, 'error');
      }
    });
  };

  const enviarWhatsApp = (item) => {
    if (!item || !item.telefono) return mostrarToast("Sin teléfono.", "warning");
    const msj = `¡Hola, ${safeString(item.nombre).split(' ')[0]}! Tus lentes están listos en VER+ ÓPTICA.`;
    let telf = safeString(item.telefono).replace(/\D/g, ''); 
    if (telf.startsWith('09')) telf = '593' + telf.substring(1);
    window.open(`https://wa.me/${telf}?text=${encodeURIComponent(msj)}`, '_blank');
  };

  const queryGlobal = safeString(busqueda).toLowerCase();
  const pedidosFiltrados = (historial || []).filter(item => {
    if (!item) return false;
    const matchSearch = safeString(item.nombre).toLowerCase().includes(queryGlobal) || safeString(item.cedula).includes(queryGlobal);
    const tienePedido = safeString(item.estado) !== 'Ninguno' || safeNum(item.venta) > 0;
    return queryGlobal ? matchSearch : tienePedido;
  });

  const listaPreciosFiltrada = (listaPrecios || []).filter(item => {
    if (!item) return false;
    const q = safeString(busquedaPrecio).toLowerCase();
    return safeString(item.tipo_lente).toLowerCase().includes(q) || safeString(item.material).toLowerCase().includes(q) || safeString(item.rango_medida).toLowerCase().includes(q);
  });

  // LOTE 6: stats con doble fuente — servidor (exacto sobre TODA la base) o local (plan B sin internet)
  const stats = (() => {
    if (statsRemotos) {
      return {
        ventasMes: Number(statsRemotos.ventas_mes || 0),
        abonosPendientes: Number(statsRemotos.abonos_pendientes || 0),
        gastosMes: Number(statsRemotos.gastos_mes || 0),
        utilidadNeta: Number(statsRemotos.utilidad_neta || 0),
        totalPacientes: Number(statsRemotos.total_pacientes || 0),
        total: (historial || []).length
      };
    }
    try {
      const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
      let ventasMes = 0; let abonosPendientes = 0; let gastosMes = 0;
      const cedulasUnicas = new Set();
      (historial || []).forEach(p => {
        if (!p) return;
        const vFinal = Number((safeNum(p.venta) - (safeNum(p.venta) * safeNum(p.descuento) / 100)).toFixed(2));
        const fechaVentas = (safeNum(p.venta) > 0 && p.fecha_venta) ? p.fecha_venta : p.fecha;
        if (fechaVentas && fechaVentas >= inicioMes) {  
          ventasMes += vFinal;
          gastosMes += (safeNum(p.costo_lunas_int) + safeNum(p.costo_armazon_int) + 
                       safeNum(p.costo_accesorio_int) + safeNum(p.costo_tratamientos_int) + 
                       safeNum(p.costo_varios_int));
        }
        const abonoRedondeado = Number(safeNum(p.abono).toFixed(2));
        if (vFinal - abonoRedondeado > 0) abonosPendientes += (vFinal - abonoRedondeado);
        if (safeString(p.nombre) !== 'CONSUMIDOR FINAL' && safeString(p.cedula) !== '' && safeString(p.cedula) !== '9999999999') {
          cedulasUnicas.add(safeString(p.cedula));
        }
      });
      return { 
        ventasMes: Number(ventasMes.toFixed(2)), 
        abonosPendientes: Number(abonosPendientes.toFixed(2)),
        gastosMes: Number(gastosMes.toFixed(2)),
        utilidadNeta: Number((ventasMes - gastosMes).toFixed(2)),
        totalPacientes: cedulasUnicas.size,
        total: (historial || []).length 
      };
    } catch {
      return { ventasMes: 0, abonosPendientes: 0, gastosMes: 0, utilidadNeta: 0, totalPacientes: 0, total: 0 }; 
    }
  })();

  const edadActual = calcularEdad(paciente?.fecha_nacimiento);
  const claseInputRef = (campo, clasesExtra) => {
    const estaVacio = safeString(paciente[campo]).trim() === '';
    return (intentadoGuardar && estaVacio) ? `w-full p-2 text-center outline-none transition-all border-2 border-red-500 bg-red-100 ${clasesExtra}` : `w-full p-2 text-center outline-none ${clasesExtra}`;
  };

  return {
    guardando,
    obtenerDatos, solicitarConfirmacion,
    estaAutenticado, cargandoAuth, cerrarSesion,
    modoSinConexion, entrarSinConexion, dispositivo, configurarAccesoSinConexion, desactivarAccesoSinConexion,
    toast, confirmDialog, setConfirmDialog, vistaActual, setVistaActual, syncEstado, sincronizarAhora,
    historial, inventario, listaPrecios, paciente, setPaciente, estadoInicial, editandoId, setEditandoId, 
    guardarPacienteClinico, manejarCambio, borrarHistoriaClinica, cargarParaEditarClinico, edadActual, claseInputRef,
    busqueda, setBusqueda, pedidosFiltrados, stats, enviarWhatsApp,
    nuevoPrecio, setNuevoPrecio, precioInicial, editandoPrecioId, setEditandoPrecioId,
    manejarCambioPrecio, guardarPrecio, busquedaPrecio, setBusquedaPrecio, listaPreciosFiltrada, cargarParaEditarPrecio, eliminarPrecio,
    nuevoItemInv, editandoInvId, cargandoImagen, manejarCambioInv, setImagenSeleccionada, guardarItemInventario, cancelarEdicionInventario, cargarParaEditarInventario, eliminarItemInventario,
    pedidoSeleccionado, setPedidoSeleccionado, medidasPaciente, accesorioOriginalId, crearVentaDirecta, abrirPedido, cambiarMedicionPedido, forzarRecalculo, manejarCambioPedido, guardarPedido, cancelarPedido
  };
}
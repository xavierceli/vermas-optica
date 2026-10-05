import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { safeString, safeNum, comprimirImagen, calcularEdad } from './utilidades';
import { localDb, createUuid as generarId } from './localDb';
import { eliminarPacienteDefinitivo } from './eliminacionPaciente';
import { 
  archivarConsultaIndividualLocal, guardarConsultaLocal, guardarInventarioLocal,
  guardarPrecioLocal, guardarVentaLocal, obtenerSnapshotLocal, 
  importLegacyCache, anularVentaLocal, eliminarInventarioLocal, 
  eliminarPrecioLocal, anularVentaConReembolso
} from './localRepository';
import { 
  iniciarMotorSync, suscribirSync, sincronizarAhora, 
  fijarSesionAusente, obtenerDetalleCola, reintentarOperacion, 
  descartarOperacion, descartarTodoLoAtascado 
} from './syncEngine';
import { 
  enrolarDispositivo, leerEnrolamiento, intentarDesbloqueo, 
  revocarEnrolamiento, pinValido 
} from './seguridad';
import { aplicarAvisoQueratometria, validarMontosVenta } from './reglas';
import { autocompletarArmazon, fechaDelPedido, problemaFechaPedido } from './pedidos';
import { autoCalcularPrecio as calcularPrecioBase, fieldsQueAfectanPrecio } from './calculoPrecio';
import { unificarPedidos, filtrarPedidos, filtrarTarifario, calcularEstadisticas, prefijoDelMesActual } from './estadisticas';
import { limpiarHtml } from './escape';
import { validarFichaClinica, motivoDocumentoInvalido } from './validacion';
import { aplicarCedula, crearEstadoPaciente, hoyISO, INV_INICIAL, PRECIO_INICIAL, CAMPOS_DE_VENTA, TRATAMIENTOS } from './fichaClinica';
import { leerAviso, mostrarAviso, suscribirAvisos } from './avisos';

export function useGestor() {
  const [estaAutenticado, setEstaAutenticado] = useState(false);
  const [cargandoAuth, setCargandoAuth] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const [toast, setToast] = useState(() => leerAviso());
  useEffect(() => suscribirAvisos(setToast), []);

  const mostrarToast = (mensaje, tipo = 'success', duracion = 3500) =>
    mostrarAviso(mensaje, tipo, duracion);

  const [confirmDialog, setConfirmDialog] = useState({ visible: false, mensaje: '', onConfirm: null, onCancel: null });

  const cancelarConfirmacion = useCallback(() => {
    const pendiente = confirmDialog.onCancel;
    setConfirmDialog({ visible: false, mensaje: '', onConfirm: null, onCancel: null });
    if (typeof pendiente === 'function') pendiente();
  }, [confirmDialog]);

  const aceptarConfirmacion = () => {
    const pendiente = confirmDialog.onConfirm;
    setConfirmDialog({ visible: false, mensaje: '', onConfirm: null, onCancel: null });
    if (typeof pendiente === 'function') pendiente();
  };

  const solicitarConfirmacion = (mensaje, onConfirmCallback) => {
    setConfirmDialog({ visible: true, mensaje, onConfirm: onConfirmCallback, onCancel: null });
  };

  const confirmar = (mensaje, textoSi = 'Sí, Continuar') => new Promise(resolve => {
    let respondido = false;
    const responder = valor => {
      if (respondido) return;
      respondido = true;
      setConfirmDialog({ visible: false, mensaje: '', onConfirm: null, onCancel: null });
      resolve(valor);
    };
    setConfirmDialog({
      visible: true, mensaje, textoSi,
      onConfirm: () => responder(true), onCancel: () => responder(false)
    });
  });

  const hoy = hoyISO();
  const estadoInicial = crearEstadoPaciente(hoy);
  const invInicial = INV_INICIAL;
  const precioInicial = PRECIO_INICIAL;

  const [paciente, setPaciente] = useState(estadoInicial);
  const [historial, setHistorial] = useState([]);
  const [cedulasArchivadas, setCedulasArchivadas] = useState([]);
  const [ventasArchivadas, setVentasArchivadas] = useState([]);
  const [ventasLocales, setVentasLocales] = useState([]);
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

  const [syncEstado, setSyncEstado] = useState({ phase: 'idle', online: true, pending: 0, conflicts: 0, lastSync: null, lastError: null });
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

  const aplicarSnapshotLocal = useCallback(snapshot => {
    if (!snapshot) return;
    setHistorial(snapshot.historial || []);
    setVentasArchivadas(snapshot.ventasArchivadas || []);
    setInventario(snapshot.inventory || []);
    setListaPrecios(snapshot.prices || []);
    setCedulasArchivadas(snapshot.cedulasArchivadas || []);
    if (snapshot.sales) {
      setVentasLocales(snapshot.sales);
    }
  }, []);

  const obtenerDatos = useCallback(async ({ sync = true } = {}) => {
    try {
      await importLegacyCache();
    } catch (error) {
      console.warn('[datos] No se pudo migrar el caché antiguo:', error);
    }
    const snapshot = await obtenerSnapshotLocal();

    try {
      const ventasDirectas = await localDb.sales.toArray();
      if (ventasDirectas && ventasDirectas.length > 0) {
        snapshot.sales = ventasDirectas;
      }
    } catch (err) {
      console.warn('[datos] No se pudo leer localDb.sales:', err);
    }

    aplicarSnapshotLocal(snapshot);
    if (sync) {
      void sincronizarAhora({ pull: true }).then(async () => {
        const snapFresca = await obtenerSnapshotLocal();
        try {
          const vDirectas = await localDb.sales.toArray();
          if (vDirectas && vDirectas.length > 0) {
            snapFresca.sales = vDirectas;
          }
        } catch {
          // Las ventas pueden no estar disponibles temporalmente; el historial sí se muestra.
        }
        aplicarSnapshotLocal(snapFresca);
      });
    }
    return snapshot;
  }, [aplicarSnapshotLocal]);

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

  const entrarSinConexion = async pin => {
    const resultado = await intentarDesbloqueo({
      pin,
      meta: localDb.meta,
      alBloquear: async () => {
        mostrarToast('Demasiados intentos. Espera 15 minutos antes de volver a intentar.', 'error');
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
  }, [obtenerDatos]);

  const manejarCambio = (e) => {
    let { name, value, type, tagName } = e.target;
    if (name === 'correo') value = safeString(value).toLowerCase();
    else if (type === 'text' || tagName === 'TEXTAREA') value = limpiarHtml(value).toUpperCase();
    
    let nuevoPaciente = { ...paciente, [name]: value };

    const campoQueratometria = /^(k1_d|k2_d)_(od|oi)$/.exec(name);
    if (campoQueratometria) {
      nuevoPaciente = aplicarAvisoQueratometria(nuevoPaciente, campoQueratometria[2]);
    }
    if (name === 'cedula') {
      nuevoPaciente = aplicarCedula({ paciente, value, historial, hoy }).ficha;
    }
    setPaciente(nuevoPaciente);
    if (intentadoGuardar) setIntentadoGuardar(false);
  };

  const manejarCambioPrecio = (e) => {
    let { name, value, type, tagName } = e.target;
    if (type === 'text' || tagName === 'TEXTAREA') value = limpiarHtml(value).toUpperCase();
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

  const cargarParaEditarPrecio = (item) => { 
    setNuevoPrecio({ ...item }); 
    setEditandoPrecioId(item.id); 
    window.scrollTo({ top: 0, behavior: 'smooth' }); 
  };

  const eliminarPrecio = (id) => {
    solicitarConfirmacion('¿Seguro que deseas eliminar esta tarifa?', async () => {
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
    if (type === 'text' || tagName === 'TEXTAREA') value = limpiarHtml(value).toUpperCase();
    setNuevoItemInv({ ...nuevoItemInv, [name]: value });
  };
  
  const guardarItemInventario = async () => {
    try {
      setCargandoImagen(true);
      let urlImagen = nuevoItemInv.imagen_url || null;

      if (imagenSeleccionada) {
        // DECISIÓN DEL USUARIO: la foto de un armazón identifica el producto y se
        // consulta todo el tiempo (al vender, al imprimir la etiqueta). Antes se
        // guardaba "para subirla luego" y, como la app no encontraba el archivo
        // (ver src/imagenesInventario.js), el producto quedaba sin foto; y si el
        // equipo se perdia, la imagen se perdia con el. Ahora la foto se sube
        // SIEMPRE con conexion: sin internet se avisa y NO se guarda el producto
        // a medias, para no dejar un armazon sin la foto que lo identifica.
        if (!navigator.onLine) {
          mostrarToast('Sin conexión: no se pueden subir fotos de armazones. Conéctate y vuelve a intentar.', 'warning', 6000);
          return;
        }
        const archivoComprimido = await comprimirImagen(imagenSeleccionada);
        const nombreArchivo = `producto_${Date.now()}_${generarId().substring(0, 8)}.jpg`;
        try {
          const { error: errSubida } = await supabase.storage
            .from('inventario_imagenes')
            .upload(nombreArchivo, archivoComprimido, { contentType: 'image/jpeg', upsert: true });
          if (errSubida) throw new Error(errSubida.message);
          urlImagen = nombreArchivo;
        } catch (errImg) {
          // Con internet pero sin exito: tampoco se guarda el producto a medias.
          mostrarToast('No se pudo subir la foto: ' + (errImg?.message || 'error desconocido') + '. El producto no se guardó.', 'error', 7000);
          return;
        }
      }

      const esArmazon = nuevoItemInv.categoria === 'Armazon';
      const datosAGuardar = {
        categoria: nuevoItemInv.categoria,
        precio: Number(safeNum(nuevoItemInv.precio).toFixed(2)),
        costo_compra: Number(safeNum(nuevoItemInv.costo_compra).toFixed(2)),
        stock: nuevoItemInv.stock === '' || nuevoItemInv.stock === null ? 1 : Math.max(0, Math.round(safeNum(nuevoItemInv.stock))),
        ...(esArmazon
          ? {
              codigo: nuevoItemInv.codigo,
              tipo_armazon: nuevoItemInv.tipo_armazon,
              material: nuevoItemInv.material,
              descripcion: nuevoItemInv.descripcion,
              param_horizontal: nuevoItemInv.param_horizontal,
              param_puente: nuevoItemInv.param_puente,
              param_vertical: nuevoItemInv.param_vertical,
              param_diagonal: nuevoItemInv.param_diagonal,
              param_frontal: nuevoItemInv.param_frontal,
              param_varillas: nuevoItemInv.param_varillas
            }
          : {
              nombre_accesorio: nuevoItemInv.nombre_accesorio,
              caracteristica: nuevoItemInv.caracteristica
            })
      };

      if (urlImagen !== null) datosAGuardar.imagen_url = urlImagen;
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
    setNuevoItemInv(itemFormateado); 
    setEditandoInvId(item.id); 
    window.scrollTo({ top: 0, behavior: 'smooth' }); 
  };

  const cancelarEdicionInventario = () => { 
    setNuevoItemInv(invInicial); 
    setEditandoInvId(null); 
    setImagenSeleccionada(null); 
  };

  const eliminarItemInventario = (id) => {
    solicitarConfirmacion('¿Eliminar ítem del inventario?', async () => {
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

  const terminarGuardado = async () => {
    setPaciente(estadoInicial);
    setEditandoId(null);
    setIntentadoGuardar(false);
    setVistaActual('historial');
    await obtenerDatos({ sync: false });
  };

  const guardarPacienteClinico = async () => {
    if (guardando) return;

    try {
      const validacion = validarFichaClinica(paciente);
      if (!validacion.ok) {
        setIntentadoGuardar(true);
        return mostrarToast(validacion.mensaje, 'warning', 9000);
      }

      if (editandoId) {
        const original = (historial || []).find(h => String(h?.id) === String(editandoId));
        if (original && safeString(original.cedula).trim().toUpperCase() !== safeString(paciente.cedula).trim().toUpperCase()) {
          return mostrarToast('No se puede cambiar la cédula de una evaluación guardada. Si es otro paciente, regístralo desde Historial.', 'warning');
        }
      }

      setGuardando(true);

      const perfilData = { 
        cedula: safeString(paciente.cedula), 
        nombre: safeString(paciente.nombre), 
        alias: safeString(paciente.alias), 
        telefono: safeString(paciente.telefono), 
        correo: safeString(paciente.correo), 
        fecha_nacimiento: safeString(paciente.fecha_nacimiento), 
        antecedentes: safeString(paciente.antecedentes) 
      };
      Object.keys(perfilData).forEach(k => { if (perfilData[k] === '') perfilData[k] = null; });

      const camposClinica = [
        'fecha', 'notas_clinicas', 'avsl_od', 'avsc_od', 'esfera_od', 'cilindro_od', 
        'eje_od', 'adicion_od', 'dnp_od', 'altura_od', 'avcl_od', 'avcc_od', 
        'avsl_oi', 'avsc_oi', 'esfera_oi', 'cilindro_oi', 'eje_oi', 'adicion_oi', 
        'dnp_oi', 'altura_oi', 'avcl_oi', 'avcc_oi', 'k1_d_od', 'k2_d_od', 
        'k1_mm_od', 'k2_mm_od', 'eje_k1_od', 'eje_k2_od', 'astig_corneal_od', 
        'eje_astig_od', 'obs_k_od', 'k1_d_oi', 'k2_d_oi', 'k1_mm_oi', 'k2_mm_oi', 
        'eje_k1_oi', 'eje_k2_oi', 'astig_corneal_oi', 'eje_astig_oi', 'obs_k_oi', 
        'auto_esf_od', 'auto_cil_od', 'auto_eje_od', 'auto_esf_oi', 'auto_cil_oi', 
        'auto_eje_oi', 'auto_esf_od_2', 'auto_cil_od_2', 'auto_eje_od_2', 
        'auto_esf_oi_2', 'auto_cil_oi_2', 'auto_eje_oi_2', 'lenso_esf_od', 
        'lenso_cil_od', 'lenso_eje_od', 'lenso_add_od', 'lenso_avl_od', 
        'lenso_avc_od', 'lenso_esf_oi', 'lenso_cil_oi', 'lenso_eje_oi', 
        'lenso_add_oi', 'lenso_avl_oi', 'lenso_avc_oi'
      ];
      
      let clinicaData = {};
      camposClinica.forEach(k => { clinicaData[k] = paciente[k] === '' ? null : paciente[k]; });

      const ahora = new Date();
      const horas = String(ahora.getHours()).padStart(2, '0');
      const minutos = String(ahora.getMinutes()).padStart(2, '0');
      const horaActual = `${horas}:${minutos}`;

      const fechaBase = safeString(paciente.fecha) ? safeString(paciente.fecha).split(' ')[0] : hoy;
      if (!editandoId) {
        clinicaData.fecha = `${fechaBase} ${horaActual}`;
      } else if (!clinicaData.fecha) {
        clinicaData.fecha = `${fechaBase} ${horaActual}`;
      }

      const idConsulta = editandoId ? editandoId : generarId();

      await guardarConsultaLocal({
        patient: { ...perfilData, patient_id: paciente.patient_id || paciente.id || generarId() },
        consultation: { ...clinicaData, id: idConsulta }
      });

      await terminarGuardado();
      const estadoSync = await sincronizarAhora({ pull: false });
      const subio = estadoSync?.phase === 'synced' || (estadoSync?.pending || 0) === 0;
      
      mostrarToast(
        subio
          ? 'Consulta guardada y sincronizada con la nube.'
          : 'Consulta guardada en este dispositivo. Se subirá a la nube en unos segundos.',
        subio ? 'success' : 'warning'
      );
    } catch(e) { 
      mostrarToast("Error: " + e.message, "error"); 
    } finally {
      setGuardando(false);
    }
  };

  const archivarConsultaPuntual = async (item) => {
    try {
      await archivarConsultaIndividualLocal(item?.id);
      const estadoSync = await sincronizarAhora({ pull: false });
      await obtenerDatos({ sync: false });
      const sincronizada = estadoSync?.phase === 'synced' || (estadoSync?.pending || 0) === 0;
      mostrarToast(
        sincronizada
          ? 'Consulta archivada.'
          : 'Consulta archivada en este dispositivo. Se sincronizará al recuperar la conexión.',
        sincronizada ? 'success' : 'warning'
      );
      return true;
    } catch (error) {
      mostrarToast('No se pudo archivar la consulta: ' + error.message, 'error');
      return false;
    }
  };

    const borrarHistoriaClinica = async (item, { descargarCopia = false } = {}) => {
    const cedula = safeString(item?.cedula).trim();
    if (!cedula) return false;

    try {
      const resumen = await eliminarPacienteDefinitivo(cedula, { descargarCopia });

      const matchCedula = c => safeString(c).replace(/[^0-9A-Za-z]/g, '').toLowerCase() === cedula.replace(/[^0-9A-Za-z]/g, '').toLowerCase();
      setHistorial(prev => prev.filter(h => !matchCedula(h?.cedula)));
      setVentasLocales(prev => prev.filter(v => !matchCedula(v?.cedula)));
      setVentasArchivadas(prev => prev.filter(v => !matchCedula(v?.cedula)));

      await obtenerDatos({ sync: true });

      if (resumen.archivosPendientes.length > 0) {
        mostrarToast(
          'Paciente eliminado, pero ' + resumen.archivosPendientes.length
          + ' archivo(s) de comprobante no se pudieron confirmar como borrados del almacenamiento. Avísale a soporte.',
          'warning', 9000
        );
      } else if (!resumen.encontrado) {
        mostrarToast('El paciente ya no estaba en el servidor. Se limpió la copia de este equipo.', 'success');
      } else {
        mostrarToast(
          'Paciente eliminado definitivamente: ' + resumen.consultas + ' consulta(s), '
          + resumen.ventas + ' venta(s) y ' + resumen.cobros + ' movimiento(s) de pago.',
          'success', 7000
        );
      }
      return true;
    } catch (err) {
      console.error('[borrar] No se pudo eliminar al paciente:', err);
      mostrarToast('No se eliminó nada: ' + err.message, 'error', 8000);
      return false;
    }
  };

  const cargarParaEditarClinico = (item) => { 
    let itemFormateado = { ...item };
    Object.keys(itemFormateado).forEach(key => { if (itemFormateado[key] === null) itemFormateado[key] = ''; });
    setPaciente({ ...estadoInicial, ...itemFormateado }); 
    setEditandoId(item.id); 
    setVistaActual('nueva_medicion'); 
    window.scrollTo({ top: 0, behavior: 'smooth' }); 
  };

  const iniciarNuevaConsulta = (item) => {
    const estadoLimpio = crearEstadoPaciente(hoy);
    const nuevaFicha = {
      ...estadoLimpio,
      cedula: safeString(item?.cedula),
      nombre: safeString(item?.nombre),
      alias: safeString(item?.alias),
      telefono: safeString(item?.telefono),
      correo: safeString(item?.correo),
      fecha_nacimiento: safeString(item?.fecha_nacimiento),
      antecedentes: safeString(item?.antecedentes),
      patient_id: item?.patient_id || item?.paciente_id || item?.id,
      id: '',
      pedido_id: ''
    };
    CAMPOS_DE_VENTA.forEach(campo => { nuevaFicha[campo] = ''; });
    TRATAMIENTOS.forEach(campo => { nuevaFicha[campo] = 'NO'; });
    setPaciente(nuevaFicha);
    setEditandoId(null);
    setVistaActual('nueva_medicion');
    window.scrollTo({ top: 0, behavior: 'smooth' }); 
  };

  const abrirPedido = (item) => {
    let itemFormateado = { ...item };
    Object.keys(itemFormateado).forEach(key => { if (itemFormateado[key] === null) itemFormateado[key] = ''; });
    ['tratam_ar', 'tratam_ar_azul', 'tratam_azul', 'tratam_tinturado', 'tratam_foto', 'tratam_trans', 'tratam_ninguno'].forEach(k => { 
      if(!itemFormateado[k]) itemFormateado[k] = 'NO'; 
    });
    if(!itemFormateado.descuento) itemFormateado.descuento = '0';
    if(!itemFormateado.forma_pago) itemFormateado.forma_pago = 'Efectivo';

    const esVentaNueva = !safeString(itemFormateado.pedido_id);
    itemFormateado._nueva_venta = esVentaNueva;
    if (esVentaNueva) {
      itemFormateado.pedido_id = generarId();
      const CAMPOS_DE_LA_VENTA = [
        'codigo_armazon', 'tipo_armazon', 'param_horizontal', 'param_puente',
        'param_vertical', 'param_diagonal', 'tipo_lente', 'material_lente',
        'material_nota', 'accesorio_id', 'venta', 'abono', 'pago_nota',
        'estado', 'notas', 'comprobante_url', 'costo_armazon_int',
        'costo_lunas_int', 'costo_accesorio_int', 'costo_tratamientos_int',
        'costo_varios_int', 'codigo_armazon_confirmado', 'tratam_tinturado_nota',
        'tratam_foto_nota', 'tratam_trans_nota'
      ];
      CAMPOS_DE_LA_VENTA.forEach(k => { itemFormateado[k] = ''; });
      itemFormateado.descuento = '0';
      itemFormateado.forma_pago = 'Efectivo';
      itemFormateado.estado = 'En laboratorio';
      itemFormateado.tratam_ar = 'NO'; itemFormateado.tratam_ar_azul = 'NO';
      itemFormateado.tratam_azul = 'NO'; itemFormateado.tratam_tinturado = 'NO';
      itemFormateado.tratam_foto = 'NO'; itemFormateado.tratam_trans = 'NO';
      itemFormateado.tratam_ninguno = 'SI';
    }

    const visitas = (historial || []).filter(h => safeString(h?.cedula) === safeString(item.cedula) && safeString(h?.nombre) !== 'CONSUMIDOR FINAL');
    setMedidasPaciente(visitas); 
    setPedidoSeleccionado(itemFormateado); 
    setAccesorioOriginalId(itemFormateado.accesorio_id || ''); 
    setVistaActual('pedidos_form');
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
    setMedidasPaciente([]); 
    setPedidoSeleccionado(ventaNueva); 
    setAccesorioOriginalId(''); 
    setVistaActual('pedidos_form');
  };

  const cambiarMedicionPedido = (e) => {
    const idVisit = e.target.value; 
    const visit = (historial || []).find(h => String(h?.id) === String(idVisit));
    if (visit) {
      setPedidoSeleccionado(prev => ({ 
        ...prev, 
        esfera_od: visit.esfera_od, cilindro_od: visit.cilindro_od, eje_od: visit.eje_od, 
        adicion_od: visit.adicion_od, dnp_od: visit.dnp_od, altura_od: visit.altura_od, 
        esfera_oi: visit.esfera_oi, cilindro_oi: visit.cilindro_oi, eje_oi: visit.eje_oi, 
        adicion_oi: visit.adicion_oi, dnp_oi: visit.dnp_oi, altura_oi: visit.altura_oi 
      }));
    }
  };


  const forzarRecalculo = () => { 
    if (!pedidoSeleccionado) return; 
    setPedidoSeleccionado(prev => ({ ...prev, venta: calcularPrecioBase(prev, inventario, listaPrecios) || '' })); 
  };


  const manejarCambioPedido = (e) => {
    let { name, value, type, checked, tagName } = e.target;
    let val = type === 'checkbox' ? (checked ? 'SI' : 'NO') : value;
    if (type === 'text' || tagName === 'TEXTAREA') val = limpiarHtml(val).toUpperCase();
    
    if (name === 'venta') { 
      setPedidoSeleccionado(prev => ({ ...prev, venta: val })); 
      return; 
    }

    setPedidoSeleccionado(prev => {
      const nuevo = { ...prev, [name]: val };

      
      // Al elegir un armazon del inventario, sus datos (tipo y medidas) se copian al pedido.
      if (name === 'codigo_armazon') {
        Object.assign(nuevo, autocompletarArmazon({
          codigoAnterior: prev.codigo_armazon, codigoNuevo: val, actuales: prev, inventario
        }));
      }

      if (fieldsQueAfectanPrecio(name)) {
        if (name === 'tratam_ninguno' && val === 'SI') {
          nuevo.tratam_ar = 'NO'; nuevo.tratam_ar_azul = 'NO'; nuevo.tratam_azul = 'NO'; 
          nuevo.tratam_tinturado = 'NO'; nuevo.tratam_foto = 'NO'; nuevo.tratam_trans = 'NO';
        } else if (name.startsWith('tratam_') && name !== 'tratam_ninguno' && val === 'SI') {
          nuevo.tratam_ninguno = 'NO';
        }
        nuevo.venta = calcularPrecioBase(nuevo, inventario, listaPrecios);
      }
      return nuevo;
    });
  };

  const guardandoPedidoRef = useRef(false);
  const guardarPedido = async ({ montoAdicional = 0 } = {}) => {
    if (guardandoPedidoRef.current) return false;
    if (!pedidoSeleccionado) return;
    guardandoPedidoRef.current = true;

    try {
      const problemaDocumento = motivoDocumentoInvalido(pedidoSeleccionado.cedula);
      if (problemaDocumento) {
        mostrarToast('No se puede guardar el pedido: ' + problemaDocumento.toLowerCase() + '.', 'warning', 7000);
        return false;
      }

      const cedulaPedido = safeString(pedidoSeleccionado.cedula).trim().toUpperCase();
      const nombrePedido = safeString(pedidoSeleccionado.nombre).trim() || (cedulaPedido === '9999999999' ? 'CONSUMIDOR FINAL' : '');
      if (!nombrePedido) {
        mostrarToast('Falta el nombre del paciente. Sin nombre no se puede emitir el recibo.', 'warning', 7000);
        return false;
      }

      const problemaMontos = validarMontosVenta({ venta: pedidoSeleccionado.venta, descuento: pedidoSeleccionado.descuento });
      if (problemaMontos) {
        mostrarToast('No se puede guardar el pedido: ' + problemaMontos, 'warning', 7000);
        return false;
      }

      const idPedido = pedidoSeleccionado.pedido_id || pedidoSeleccionado.id || generarId();
      const consultationId = pedidoSeleccionado.id || generarId();
      const cedulaPaciente = cedulaPedido;
      const nombrePaciente = nombrePedido;

      const patientId = pedidoSeleccionado.patient_id || pedidoSeleccionado.paciente_id || generarId();
      const camposPedido = [
        'venta', 'abono', 'descuento', 'forma_pago', 'pago_nota', 'estado', 
        'notas', 'comprobante_url', 'codigo_armazon', 'tipo_armazon', 
        'param_horizontal', 'param_puente', 'param_vertical', 'param_diagonal', 
        'tipo_lente', 'material_lente', 'material_nota', 'accesorio_id', 
        'tratam_ninguno', 'tratam_ar', 'tratam_ar_azul', 'tratam_azul', 
        'tratam_tinturado', 'tratam_tinturado_nota', 'tratam_foto', 
        'tratam_foto_nota', 'tratam_trans', 'tratam_trans_nota', 
        'costo_armazon_int', 'costo_lunas_int', 'costo_accesorio_int', 
        'costo_tratamientos_int', 'costo_varios_int'
      ];
      
      const venta = {};
      camposPedido.forEach(k => { venta[k] = pedidoSeleccionado[k] === '' ? null : pedidoSeleccionado[k]; });
      venta.id = idPedido;
      venta.pedido_id = idPedido;
      venta.patient_id = patientId;
      venta.consultation_id = consultationId;
            const problemaFecha = problemaFechaPedido(pedidoSeleccionado, hoy);
      if (problemaFecha) {
        mostrarToast('No se puede guardar el pedido: ' + problemaFecha, 'warning', 7000);
        return false;
      }
      venta.fecha = fechaDelPedido(pedidoSeleccionado, hoy);
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
            idempotencyKey: pedidoSeleccionado._nueva_venta ? idPedido : generarId()
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

      // ACTUALIZACIÓN INMEDIATA DE ESTADOS EN REACT (Para no tener que recargar dos veces)
      const ventaActualizada = {
        ...pedidoSeleccionado,
        ...venta,
        id: consultationId,
        pedido_id: idPedido,
        abono: String(montoAPagar > 0 ? (safeNum(venta.abono) + montoAPagar).toFixed(2) : venta.abono)
      };

      setHistorial(prev => {
        const existe = prev.some(h => String(h.id) === String(consultationId) || (safeString(h.cedula) === cedulaPaciente && !h.pedido_id));
        if (existe) {
          return prev.map(h => (String(h.id) === String(consultationId) || (safeString(h.cedula) === cedulaPaciente && !h.pedido_id)) ? { ...h, ...ventaActualizada } : h);
        }
        return [ventaActualizada, ...prev];
      });

      setVentasLocales(prev => {
        const index = prev.findIndex(v => String(v.id) === String(idPedido));
        if (index >= 0) {
          const copia = [...prev];
          copia[index] = { ...copia[index], ...ventaActualizada };
          return copia;
        }
        return [ventaActualizada, ...prev];
      });

      setPedidoSeleccionado(null);
      setVistaActual('pedidos_lista');

      // HONESTIDAD AL GUARDAR (IMPORTANTE 5)
      // Antes se lanzaba la sincronizacion con `void` (sin esperar) y se mostraba
      // SIEMPRE "Venta guardada exitosamente". Eso miente: la venta queda guardada en
      // el dispositivo, pero puede no haber llegado al servidor. Sin internet, o si
      // el servidor la rechaza, el usuario se iba creyendo que estaba en la nube.
      // `guardarPacienteClinico` ya hacia esto bien; aqui se iguala.
      // No se bloquea la interfaz: se espera a la cola (que es rapido) y luego se
      // recarga en segundo plano.
      const estadoSync = await sincronizarAhora({ pull: false });
      void obtenerDatos({ sync: true });

      const pendientes = estadoSync?.pending || 0;
      const descartadas = estadoSync?.descartadas || 0;
      const fallos = (estadoSync?.fallos || []).length;

      if (fallos > 0 || descartadas > 0) {
        // El servidor la rechazo: sigue guardada aqui, pero no llego a la nube.
        mostrarToast(
          'Venta guardada SOLO en este dispositivo: el servidor la rechazó. Revisa el panel de sincronización antes de cerrar el equipo.',
          'error', 9000
        );
      } else if (pendientes > 0 || estadoSync?.phase === 'offline') {
        mostrarToast(
          'Venta guardada en este dispositivo. Se subirá a la nube al recuperar conexión. No cierres la app todavía.',
          'warning', 7000
        );
      } else if (estadoSync?.phase === 'error') {
        mostrarToast(
          'Venta guardada en este dispositivo, pero la subida falló: ' + String(estadoSync.lastError || 'sin detalle') + '. Se reintentará sola.',
          'warning', 8000
        );
      } else {
        mostrarToast('Venta guardada y sincronizada con la nube.', 'success');
      }
      return true;
    } catch (e) {
      mostrarToast('Error al guardar pedido: ' + e.message, 'error');
      return false;
    } finally {
      guardandoPedidoRef.current = false;
    }
  };

  const cancelarPedido = (item) => {
    if (!item.pedido_id) {
      return mostrarToast(
        'Este registro no tiene venta local, solo la consulta clínica. No hay nada que anular aquí.',
        'warning'
      );
    }

    const abono = Number(safeNum(item.abono).toFixed(2));
    const mensaje = abono > 0
      ? `¿Anular la venta? Tiene $${abono.toFixed(2)} abonado: primero se le devolverá ese dinero y luego se devolverá el stock.`
      : '¿Anular la venta y devolver el stock local?';

    solicitarConfirmacion(mensaje, async () => {
      try {
        const resultado = abono > 0
          ? await anularVentaConReembolso({ saleId: item.pedido_id, method: 'Efectivo' })
          : await anularVentaLocal(item.pedido_id);
          
        await obtenerDatos({ sync: false });
        const estado = await sincronizarAhora({ pull: true });
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

  const todosLosPedidosUnificados = useMemo(
    () => unificarPedidos({ historial, ventasArchivadas, ventasLocales }),
    [historial, ventasArchivadas, ventasLocales]
  );

  const pedidosFiltrados = useMemo(
    () => filtrarPedidos(todosLosPedidosUnificados, queryGlobal),
    [todosLosPedidosUnificados, queryGlobal]
  );

  const listaPreciosFiltrada = useMemo(
    () => filtrarTarifario(listaPrecios, busquedaPrecio),
    [listaPrecios, busquedaPrecio]
  );

  const mesActual = useMemo(() => prefijoDelMesActual(), []);

  const stats = useMemo(
    () => calcularEstadisticas({ pedidos: todosLosPedidosUnificados, historial, mesActual }),
    [todosLosPedidosUnificados, historial, mesActual]
  );
  const edadActual = calcularEdad(paciente?.fecha_nacimiento);
  const claseInputRef = (campo, clasesExtra) => {
    const estaVacio = safeString(paciente[campo]).trim() === '';
    return (intentadoGuardar && estaVacio) 
      ? `w-full p-2 text-center outline-none transition-all border-2 border-red-500 bg-red-100 ${clasesExtra}` 
      : `w-full p-2 text-center outline-none ${clasesExtra}`;
  };

  return {
    guardando,
    obtenerDatos, solicitarConfirmacion, confirmar, cancelarConfirmacion, aceptarConfirmacion,
    estaAutenticado, cargandoAuth, cerrarSesion,
    modoSinConexion, entrarSinConexion, dispositivo, configurarAccesoSinConexion, desactivarAccesoSinConexion,
    toast, confirmDialog, setConfirmDialog, vistaActual, setVistaActual, syncEstado, sincronizarAhora,
    obtenerDetalleCola, reintentarOperacion, descartarOperacion, descartarTodoLoAtascado,
    historial, ventasArchivadas, ventasLocales, inventario, listaPrecios, paciente, setPaciente, estadoInicial, editandoId, setEditandoId,
    cedulasArchivadas, 
    guardarPacienteClinico, manejarCambio, borrarHistoriaClinica, archivarConsultaPuntual, cargarParaEditarClinico, iniciarNuevaConsulta, edadActual, claseInputRef,
    busqueda, setBusqueda, pedidosFiltrados, stats, enviarWhatsApp,
    nuevoPrecio, setNuevoPrecio, precioInicial, editandoPrecioId, setEditandoPrecioId,
    manejarCambioPrecio, guardarPrecio, busquedaPrecio, setBusquedaPrecio, listaPreciosFiltrada, cargarParaEditarPrecio, eliminarPrecio,
    nuevoItemInv, editandoInvId, cargandoImagen, manejarCambioInv, setImagenSeleccionada, guardarItemInventario, cancelarEdicionInventario, cargarParaEditarInventario, eliminarItemInventario,
    pedidoSeleccionado, setPedidoSeleccionado, medidasPaciente, accesorioOriginalId, crearVentaDirecta, abrirPedido, cambiarMedicionPedido, forzarRecalculo, manejarCambioPedido, guardarPedido, cancelarPedido
  };
}

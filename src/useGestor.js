import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from './supabaseClient'
import { safeString, safeNum, comprimirImagen, calcularEdad } from './utilidades'
import { localDb, createUuid as generarId } from './localDb'
import { archivarConsultaLocal, guardarConsultaLocal, guardarInventarioLocal, guardarPrecioLocal, guardarVentaLocal, obtenerSnapshotLocal, importLegacyCache, anularVentaLocal, eliminarInventarioLocal, eliminarPrecioLocal, guardarAdjuntoLocal, anularVentaConReembolso } from './localRepository'
import { iniciarMotorSync, suscribirSync, sincronizarAhora, fijarSesionAusente, obtenerDetalleCola, reintentarOperacion, descartarOperacion, descartarTodoLoAtascado } from './syncEngine'
import { enrolarDispositivo, leerEnrolamiento, intentarDesbloqueo, revocarEnrolamiento, pinValido } from './seguridad'
import { aplicarAvisoQueratometria, calcularTotal } from './reglas'
import { limpiarHtml } from './escape'
import { validarFichaClinica, motivoDocumentoInvalido } from './validacion'
import { aplicarCedula, crearEstadoPaciente, hoyISO, INV_INICIAL, PRECIO_INICIAL } from './fichaClinica'
import { leerAviso, mostrarAviso, suscribirAvisos } from './avisos'

export function useGestor() {
  const [estaAutenticado, setEstaAutenticado] = useState(false);
  const [cargandoAuth, setCargandoAuth] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // El aviso en pantalla vive en el almacen global (avisos.js) para que
  // CUALQUIER modulo pueda avisar, incluso los que no usan React (el boton del
  // comprobante, las descargas). Aqui solo se refleja en el estado.
  const [toast, setToast] = useState(() => leerAviso());
  useEffect(() => suscribirAvisos(setToast), []);

  // `duracion` permite que los mensajes de validacion, que son largos y listan
  // varios campos, permanezcan mas tiempo en pantalla que un ok simple.
  const mostrarToast = (mensaje, tipo = 'success', duracion = 3500) =>
    mostrarAviso(mensaje, tipo, duracion);

  const [confirmDialog, setConfirmDialog] = useState({ visible: false, mensaje: '', onConfirm: null, onCancel: null });

  // Cancelar (boton o clic en el fondo). Se extrae para no repetir la logica y
  // para que el dialogo quede SIEMPRE cerrado, llegue como llegue el clic.
  const cancelarConfirmacion = () => {
    const pendiente = confirmDialog.onCancel;
    setConfirmDialog({ visible: false, mensaje: '', onConfirm: null, onCancel: null });
    if (typeof pendiente === 'function') pendiente();
  };

  // Aceptar. Cierra SIEMPRE y despues lanza lo que hubiera: asi sirve tanto para
  // la confirmacion por promesa (que ya se resuelve sola) como para la antigua
  // por callback (que no cierra nada por su cuenta).
  const aceptarConfirmacion = () => {
    const pendiente = confirmDialog.onConfirm;
    setConfirmDialog({ visible: false, mensaje: '', onConfirm: null, onCancel: null });
    if (typeof pendiente === 'function') pendiente();
  };

  const solicitarConfirmacion = (mensaje, onConfirmCallback) => {
    setConfirmDialog({ visible: true, mensaje, onConfirm: onConfirmCallback, onCancel: null });
  };

  /**
   * Confirmacion como PROMESA. Sustituye a window.confirm, que congela la pagina
   * y corta el flujo a mitad de una venta.
   *
   * IMPORTANTE: todas las salidas (Sí, Cancelar y el clic en el fondo) resuelven
   * la promesa, y solo la primera vez. Una promesa que se queda colgada
   * reproduce justo el bug de "Actualizando..." infinito que ya arrastramos.
   */
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

  // El formulario de consulta, el de inventario y el de tarifas viven ahora en
  // fichaClinica.js: son puro dato, sin React, y se pueden probar de verdad.
  const hoy = hoyISO();
  const estadoInicial = crearEstadoPaciente(hoy);
  const invInicial = INV_INICIAL;
  const precioInicial = PRECIO_INICIAL;

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
    // La migracion del cache legacy es una tarea OPCIONAL: sirve para no perder
    // datos de una version vieja de la app, pero si falla no puede impedir que
    // la app cargue. Antes su error se propagaba, abortaba obtenerSnapshotLocal
    // y dejaba la pantalla vacia, y ademas se reintentaba en bucle porque la
    // bandera de "ya migre" solo se escribia al final del exito.
    try {
      await importLegacyCache();
    } catch (error) {
      console.warn('[datos] no se pudo migrar el cache antiguo; se sigue con los datos locales:', error);
    }
    const snapshot = await obtenerSnapshotLocal();
    aplicarSnapshotLocal(snapshot);
    const remoteStats = (await localDb.meta.get('remoteStats'))?.value || null;
    if (remoteStats) setStatsRemotos(remoteStats);
if (sync) {
      void sincronizarAhora({ pull: true }).then(async () => {
        aplicarSnapshotLocal(await obtenerSnapshotLocal());
        const statsFrescos = (await localDb.meta.get('remoteStats'))?.value || null;
        if (statsFrescos) setStatsRemotos(statsFrescos);
      });
    }
    return snapshot;
  };
  useEffect(() => {
    iniciarMotorSync();
    return suscribirSync(setSyncEstado);
  }, []);
  // BUG REAL: las estadisticas se quedaban congeladas al hacer una venta.
  // El motor escribe 'remoteStats' en la base local en cada pull, pero ese valor
  // solo se copiaba a la pantalla al ENTRAR (obtenerDatos). El sincronizador, sin
  // embargo, corre solo cada 30 s: la venta se subia, el servidor recalculaba sus
  // totales, y el panel seguia enseñando los de antes. Por eso "cuando hay una
  // venta no cambia nada en Stats".
  //
  // Se relee cuando cambia lastSync, que es la marca de "el pull termino bien".
  // Sin esto habia que recargar la app a mano para ver un euro nuevo.
  const ultimaSync = syncEstado?.lastSync;
  useEffect(() => {
    if (!ultimaSync) return;
    let vigente = true;
    localDb.meta.get('remoteStats')
      .then(row => { if (vigente && row?.value) setStatsRemotos(row.value); })
      .catch(() => {});
    return () => { vigente = false; };
  }, [ultimaSync]);
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
        // Antes aqui se llamaba a resetLocalDatabase(), y el quinto PIN
        // equivocado destruia TODA la informacion pendiente de subir. Bloquear
        // el acceso ya frena la fuerza bruta; perder la semana de trabajo del
        // optometra no anadeia nada a la seguridad.
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
    else if (type === 'text' || tagName === 'TEXTAREA') value = limpiarHtml(value).toUpperCase();
    
    let nuevoPaciente = { ...paciente, [name]: value };

    // REGLA CLÍNICA: cualquier queratometría alta deja constancia en observaciones.
    const campoQueratometria = /^(k1_d|k2_d)_(od|oi)$/.exec(name);
    if (campoQueratometria) {
      nuevoPaciente = aplicarAvisoQueratometria(nuevoPaciente, campoQueratometria[2]);
    }
    if (name === 'cedula') {
      // La regla vive en fichaClinica.js porque es la que decide si se trae la
      // ficha de un paciente que ya existe: una cedula a medias NUNCA puede
      // borrar el formulario que el optometria lleva media hora llenando.
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
    if (type === 'text' || tagName === 'TEXTAREA') value = limpiarHtml(value).toUpperCase();
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
            // BUG: antes se guardaba getPublicUrl, pero el bucket es PRIVADO
            // (migraciones 006 y 008), asi que esa URL responde 400 y la foto salia
            // rota. En la base se guarda solo la RUTA del archivo; la URL firmada
            // se genera en el momento de mostrarla (ver imagenesInventario.js).
            urlImagen = nombreArchivo;
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

      // BUG: se enviaba el objeto completo con TODOS los campos y los vacios se
      // convertian en null. Como el formulario oculta campos segun la categoria,
      // al editar un armazon se mandaban vacios nombre_accesorio, caracteristica y
      // material_nota, y al editar un accesorio se mandaban vacios codigo, tipo,
      // material y medidas: el servidor los guardaba como NULL y se perdian.
      // Aqui se arma SOLO con los campos que apply de la categoria actual.
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
      // La foto solo se manda si hay una nueva: si no, se omite la clave para no
      // borrar la que ya tiene en el servidor.
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

  const guardarPacienteClinico = async () => {
    if (guardando) return;

    try {
      // Una sola validacion que reporta TODO lo que falta, no solo el primer
      // problema. Antes decia "FALTAN DATOS" sin decir que campo, y el nombre
      // no se validaba: se podia guardar una ficha sin nombre que despues
      // rompia la venta ("El nombre del paciente es obligatorio").
      const validacion = validarFichaClinica(paciente);
      if (!validacion.ok) {
        setIntentadoGuardar(true);
        return mostrarToast(validacion.mensaje, 'warning', 9000);
      }

      if (editandoId) {
        const original = (historial || []).find(h => String(h?.id) === String(editandoId));
        if (original && safeString(original.cedula).trim().toUpperCase() !== safeString(paciente.cedula).trim().toUpperCase()) {
          return mostrarToast('No se puede cambiar la cédula de una evaluación guardada. Si es otro paciente, registralo desde Historial.', 'warning');
        }
      }

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

      // El mensaje era "guardado en el dispositivo" y el usuario no sabia si
      // habia llegado a la nube. Ahora se intenta subir ANTES de avisar, y el
      // aviso dice con claridad que paso en cada caso.
      await terminarGuardado();
      const estadoSync = await sincronizarAhora({ pull: false });
      const subio = estadoSync?.phase === 'synced' || (estadoSync?.pending || 0) === 0;
      mostrarToast(
        subio
          ? 'Consulta guardada y sincronizada con la nube.'
          : 'Consulta guardada en este dispositivo. Se subirá a la nube en unos segundos.',
        subio ? 'success' : 'warning'
      );
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
    if (item.pedido_id && safeString(item.estado) !== 'Anulado') {
      return mostrarToast('Esta consulta tiene una venta ACTIVA. Anula la venta primero y luego podrás archivar la consulta.', 'warning');
    }
    try {
      const resultado = await archivarConsultaLocal(item.id);
      // Si ya estaba archivada se dice con claridad en vez de mostrar un error
      // rojo: para el usuario el resultado pedido (que desaparezca) ya ocurrio.
      if (resultado?.yaArchivada) {
        mostrarToast(resultado.motivo || 'La consulta ya estaba archivada.', 'warning');
        await obtenerDatos({ sync: false });
        return;
      }
      await obtenerDatos({ sync: false });
      void sincronizarAhora({ pull: false });
      mostrarToast('Consulta archivada.', 'success');
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
    if (esVentaNueva) {
      itemFormateado.pedido_id = generarId();
      // BUG REAL: al crear una venta NUEVA para un paciente que ya tenia otra,
      // se arrastraba el armazon, el tipo de lente y los tratamientos de la
      // VENTA ANTERIOR. El optometria abria el formulario de una segunda venta y
      // el armazon de la primera ya estaba puesto: si no lo cambiaba, se vendia
      // el armazon equivocado y el precio se calculaba sobre el, en silencio.
      //
      // Una venta nueva arranca en blanco. Lo que si se conserva son los DATOS
      // CLINICOS del paciente (esfera, cilindro...): son suyos, no de la venta.
      // Cada campo se limpia SOLO si viene de la venta anterior, nunca un dato
      // clinico que el optometria haya escrito.
      const CAMPOS_DE_LA_VENTA = [
        'codigo_armazon', 'tipo_armazon', 'param_horizontal', 'param_puente',
        'param_vertical', 'param_diagonal', 'tipo_lente', 'material_lente',
        'material_nota', 'accesorio_id', 'venta', 'abono', 'pago_nota',
        'estado', 'notas', 'comprobante_url', 'costo_armazon_int',
        'costo_lunas_int', 'costo_accesorio_int', 'costo_tratamientos_int',
        'costo_varios_int', 'codigo_armazon_confirmado'
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
    // Si no existe la fila, NO se inventa un precio en el cliente: se cobra 0 y se
    // avisa. Antes habia una tabla de respaldo fija en este archivo, que se
    // desincronizaba en silencio del tarifario real cada vez que alguien cambiaba
    // un precio, y nadie se enteraba hasta que la caja no cuadraba.
    const bases = (listaPrecios || []).filter(p => safeString(p.tipo_lente) === 'CALCULO' && safeString(p.rango_medida) === 'BASE');
    const precioDe = (material) => {
      const fila = bases.find(b => safeString(b.material).trim().toUpperCase() === String(material).trim().toUpperCase());
      if (fila) return safeNum(fila.precio_sugerido);
      console.warn(`[precio] "${material}" no tiene fila BASE en el tarifario; se cobrara $0. Agregala en la pantalla Tarifario.`);
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

  const forzarRecalculo = () => { 
    if (!pedidoSeleccionado) return; 
    setPedidoSeleccionado(prev => ({ ...prev, venta: autoCalcularPrecio(prev) || '' })); 
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

      // El nombre se valida ANTES que nada se escriba en la base. Antes se
      // comprobaba mas abajo y el error salia como excepcion interna.
      const cedulaPedido = safeString(pedidoSeleccionado.cedula).trim().toUpperCase();
      const nombrePedido = safeString(pedidoSeleccionado.nombre).trim() || (cedulaPedido === '9999999999' ? 'CONSUMIDOR FINAL' : '');
      if (!nombrePedido) {
        mostrarToast('Falta el nombre del paciente. Sin nombre no se puede emitir el recibo ni identificar la venta.', 'warning', 7000);
        return false;
      }

      const idPedido = pedidoSeleccionado.pedido_id || pedidoSeleccionado.id || generarId();
      const consultationId = pedidoSeleccionado.id || generarId();
      const cedulaPaciente = cedulaPedido;
      const nombrePaciente = nombrePedido;

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

      // El guardado local ya quedo persistido: navegamos y refrescamos en segundo
      // plano para que el boton no espere un snapshot completo de IndexedDB.
      setPedidoSeleccionado(null);
      setVistaActual('pedidos_lista');
      mostrarToast('Venta guardada en este dispositivo.', 'success');
      // Se espera a la sincronizacion para poder decir con certeza si la venta
      // llego a la nube. Antes solo decia "guardada en el dispositivo", que no
      // aclaraba nada y hacia dudar de si la venta estaba a salvo.
      void obtenerDatos({ sync: true });
      const estadoSync = await sincronizarAhora({ pull: false });
      const subio = (estadoSync?.pending || 0) === 0;
      mostrarToast(
        subio
          ? 'Venta guardada y sincronizada con la nube.'
          : 'Venta guardada en este dispositivo. Se subirá a la nube en unos segundos.',
        subio ? 'success' : 'warning'
      );
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
      // No es un aviso genérico: este registro viene del historial cacheado del
      // servidor y nunca tuvo una venta creada en ESTE dispositivo, así que no
      // hay nada que anular aquí. Se explica el porque para que el usuario sepa
      // que no es un fallo temporal.
      return mostrarToast(
        'Este registro no tiene venta local, solo la consulta clínica. No hay nada que anular aquí.',
        'warning'
      );
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
        // Sin esta llamada la anulacion se queda solo en este dispositivo: el
        // servidor nunca se entera y la venta sigue viva alli.
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

  // Los dos filtros siguientes recorren listas enteras en cada render del hook.
  // useGestor se vuelve a renderizar con cualquier pulsación de tecla de la
  // clínica, así que aquí se filtraba miles de filas para un resultado idéntico.
  const queryGlobal = safeString(busqueda).toLowerCase();
  const pedidosFiltrados = useMemo(() => (historial || []).filter(item => {
    if (!item) return false;
    const matchSearch = safeString(item.nombre).toLowerCase().includes(queryGlobal) || safeString(item.cedula).includes(queryGlobal);
    // Mismo criterio que PedidosLista: sin venta real (pedido_id) no hay pedido.
    // El historial del servidor marca 'En laboratorio' en consultas que nunca
    // tuvieron venta, y eso las hacia aparecer en Pedidos con monto $0.
    const tienePedido = Boolean(safeString(item.pedido_id).trim())
      || safeNum(item.venta) > 0
      || safeString(item.codigo_armazon).trim() !== ''
      || safeString(item.accesorio_id).trim() !== '';
    return queryGlobal ? matchSearch : tienePedido;
  }), [historial, queryGlobal]);

  const listaPreciosFiltrada = useMemo(() => {
    const q = safeString(busquedaPrecio).toLowerCase();
    return (listaPrecios || []).filter(item => {
      if (!item) return false;
      return safeString(item.tipo_lente).toLowerCase().includes(q)
        || safeString(item.material).toLowerCase().includes(q)
        || safeString(item.rango_medida).toLowerCase().includes(q);
    });
  }, [listaPrecios, busquedaPrecio]);

  // LOTE 6: stats con doble fuente — servidor (exacto sobre TODA la base) o local (plan B sin internet)
  // Envuelto en useMemo: antes era una IIFE que recorria el historial entero en
  // CADA render, con miles de filas y escribiendose cualquier tecla de la
  // clinica. Ahora solo recalcula si cambian los datos.
  // Los totales salen de calcularTotal(), NO de una resta con float: reglas.js
  // documenta que 250.50 @ 13% da 217.93 con float y 217.94 en PostgreSQL, y
  // ese centavo de diferencia hacia que el dashboard contradijera al recibo.
  const stats = useMemo(() => {
    if (statsRemotos && !modoSinConexion) {
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
        // Una venta anulada no cuenta en las estadisticas: el dinero se devolvio.
        if (safeString(p.estado) === 'Anulado') return;
        const vFinal = calcularTotal(p.venta, p.descuento);
        const fechaVentas = (safeNum(p.venta) > 0 && p.fecha_venta) ? p.fecha_venta : p.fecha;
        if (fechaVentas && fechaVentas >= inicioMes) {  
          ventasMes += vFinal;
          gastosMes += (safeNum(p.costo_lunas_int) + safeNum(p.costo_armazon_int) + 
                       safeNum(p.costo_accesorio_int) + safeNum(p.costo_tratamientos_int) + 
                       safeNum(p.costo_varios_int));
        }
        const abonoRedondeado = safeNum(p.abono);
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
  }, [historial, statsRemotos, modoSinConexion]);

  const edadActual = calcularEdad(paciente?.fecha_nacimiento);
  const claseInputRef = (campo, clasesExtra) => {
    const estaVacio = safeString(paciente[campo]).trim() === '';
    return (intentadoGuardar && estaVacio) ? `w-full p-2 text-center outline-none transition-all border-2 border-red-500 bg-red-100 ${clasesExtra}` : `w-full p-2 text-center outline-none ${clasesExtra}`;
  };

  return {
    guardando,
    obtenerDatos, solicitarConfirmacion, confirmar, cancelarConfirmacion, aceptarConfirmacion,
    estaAutenticado, cargandoAuth, cerrarSesion,
    modoSinConexion, entrarSinConexion, dispositivo, configurarAccesoSinConexion, desactivarAccesoSinConexion,
    toast, confirmDialog, setConfirmDialog, vistaActual, setVistaActual, syncEstado, sincronizarAhora,
    obtenerDetalleCola, reintentarOperacion, descartarOperacion, descartarTodoLoAtascado,
    historial, inventario, listaPrecios, paciente, setPaciente, estadoInicial, editandoId, setEditandoId, 
    guardarPacienteClinico, manejarCambio, borrarHistoriaClinica, cargarParaEditarClinico, edadActual, claseInputRef,
    busqueda, setBusqueda, pedidosFiltrados, stats, enviarWhatsApp,
    nuevoPrecio, setNuevoPrecio, precioInicial, editandoPrecioId, setEditandoPrecioId,
    manejarCambioPrecio, guardarPrecio, busquedaPrecio, setBusquedaPrecio, listaPreciosFiltrada, cargarParaEditarPrecio, eliminarPrecio,
    nuevoItemInv, editandoInvId, cargandoImagen, manejarCambioInv, setImagenSeleccionada, guardarItemInventario, cancelarEdicionInventario, cargarParaEditarInventario, eliminarItemInventario,
    pedidoSeleccionado, setPedidoSeleccionado, medidasPaciente, accesorioOriginalId, crearVentaDirecta, abrirPedido, cambiarMedicionPedido, forzarRecalculo, manejarCambioPedido, guardarPedido, cancelarPedido
  };
}

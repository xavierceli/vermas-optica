import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { safeString, safeNum, comprimirImagen, calcularEdad } from './utilidades'
import { leerBoveda, escribirBoveda, encolarOperacion, generarIdFantasma, eliminarTareaDeBandeja } from './motorOffline'

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
    setConfirmDialog({ visible: true, mensaje, onConfirm: onConfirmCallback });
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
  const [armazonOriginalCodigo, setArmazonOriginalCodigo] = useState('');
  const [accesorioOriginalId, setAccesorioOriginalId] = useState('');
  const [medidasPaciente, setMedidasPaciente] = useState([]);

  useEffect(() => {
    let montado = true;

    const timerSeguridad = setTimeout(() => {
      if (montado) setCargandoAuth(false);
    }, 1000);

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (montado) {
        clearTimeout(timerSeguridad);
        setEstaAutenticado(!!session);
        obtenerDatos();
        setCargandoAuth(false);
      }
    }).catch(() => {
      if (montado) {
        clearTimeout(timerSeguridad);
        obtenerDatos();
        setCargandoAuth(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (montado) {
        setEstaAutenticado(!!session);
        setCargandoAuth(false);
        if (session) obtenerDatos();
      }
    });

    return () => {
      montado = false;
      clearTimeout(timerSeguridad);
      subscription?.unsubscribe();
    };
  }, []);

  const cerrarSesion = () => {
    solicitarConfirmacion("¿Estás seguro de cerrar sesión? Tendrás que volver a ingresar con tus credenciales.", async () => {
      await supabase.auth.signOut();
    });
  };

  const obtenerDatos = async () => {
    // 1. CARGA INMEDIATA DESDE BÓVEDA LOCAL PARA NUNCA QUEDAR SIN INVENTARIO/PRECIOS
    try {
      const invLocal = await leerBoveda('backup_inventario') || [];
      const histLocal = await leerBoveda('backup_historial') || [];
      const precLocal = await leerBoveda('backup_precios') || [];

      if (invLocal.length > 0) setInventario(invLocal);
      if (histLocal.length > 0) setHistorial(histLocal);
      if (precLocal.length > 0) setListaPrecios(precLocal);
    } catch (e) {
      console.warn("Error leyendo bóveda local de inicio:", e);
    }

    // 2. SINCRONIZACIÓN CON SUPABASE SI HAY CONEXIÓN
    if (!navigator.onLine) return;

    try {
      const bandejaSalida = await leerBoveda('bandeja_salida') || [];
      
      if (bandejaSalida.length > 0) {
        let mapaIdsReales = {};
        const tareasOrdenadas = [...bandejaSalida].sort((a, b) => {
          if (a.tabla === 'pacientes_perfil' && b.tabla !== 'pacientes_perfil') return -1;
          if (a.tabla !== 'pacientes_perfil' && b.tabla === 'pacientes_perfil') return 1;
          return 0;
        });

        for (const tarea of tareasOrdenadas) {
          try {
            if (tarea.tabla === 'pacientes_perfil' && tarea.tipo === 'INSERT') {
              const idTemporal = tarea.datos.id_temporal;
              const datosAInsertar = { ...tarea.datos };
              delete datosAInsertar.id_temporal;
              
              const { data: perfilCreado, error: errInsert } = await supabase
                .from('pacientes_perfil')
                .insert([datosAInsertar])
                .select()
                .single();

              if (errInsert) throw errInsert;
              if (idTemporal && perfilCreado) mapaIdsReales[idTemporal] = perfilCreado.id;

            } else if (tarea.tabla === 'consultas_clinicas' && tarea.tipo === 'INSERT') {
              const datosClinica = { ...tarea.datos };
              if (datosClinica.paciente_id && String(datosClinica.paciente_id).startsWith('temp-')) {
                const idRealMapeado = mapaIdsReales[datosClinica.paciente_id];
                if (idRealMapeado) datosClinica.paciente_id = idRealMapeado;
              }
              delete datosClinica.cedula;
              delete datosClinica.nombre;
              await supabase.from('consultas_clinicas').insert([datosClinica]);

            } else if (tarea.tabla === 'pedidos_ventas' && tarea.tipo === 'INSERT') {
              const datosVenta = { ...tarea.datos };
              if (datosVenta.paciente_id && String(datosVenta.paciente_id).startsWith('temp-')) {
                const idReal = mapaIdsReales[datosVenta.paciente_id];
                if (idReal) datosVenta.paciente_id = idReal;
              }
              delete datosVenta.cedula;
              delete datosVenta.nombre;
              await supabase.from('pedidos_ventas').insert([datosVenta]);

            } else if (tarea.tipo === 'UPDATE') {
              const { id, ...datosActualizar } = tarea.datos;
              await supabase.from(tarea.tabla).update(datosActualizar).eq('id', id);
            } else if (tarea.tipo === 'DELETE') {
              await supabase.from(tarea.tabla).delete().eq('id', tarea.datos.id);
            }

            await eliminarTareaDeBandeja(tarea.id_tarea);
          } catch (errTarea) {
            console.error("Fallo tarea:", errTarea);
          }
        }
      }

      // Descargar datos actualizados de la nube
      const { data: hist } = await supabase.from('vista_pacientes').select('*').order('fecha', { ascending: false }).limit(50);
      const { data: inv } = await supabase.from('inventario').select('*').order('id', { ascending: false });
      const { data: prec } = await supabase.from('lista_precios').select('*').order('id', { ascending: false });

      if (hist) {
        setHistorial(hist);
        await escribirBoveda('backup_historial', hist);
      }
      if (inv) {
        setInventario(inv);
        await escribirBoveda('backup_inventario', inv);
      }
      if (prec) {
        setListaPrecios(prec);
        await escribirBoveda('backup_precios', prec);
      }
    } catch (e) {
      console.warn("Fallo sincronización online:", e);
    }
  };

  const manejarCambio = (e) => {
    let { name, value, type, tagName } = e.target;
    if (name === 'correo') value = safeString(value).toLowerCase();
    else if (type === 'text' || tagName === 'TEXTAREA') value = safeString(value).toUpperCase();
    
    let nuevoPaciente = { ...paciente, [name]: value };

    if (name === 'cedula') {
      const pacienteExistente = (historial || []).find(p => safeString(p?.cedula) === safeString(value) && safeString(p?.nombre) !== 'CONSUMIDOR FINAL');
      if (pacienteExistente) {
        nuevoPaciente = { ...pacienteExistente, fecha: hoy, cedula: value, id: '', pedido_id: '' };
        ['venta', 'abono', 'notas', 'notas_clinicas', 'codigo_armazon', 'tipo_armazon', 'param_horizontal', 'param_puente', 'param_vertical', 'param_diagonal', 'tipo_lente', 'material_lente', 'material_nota', 'tratam_tinturado_nota', 'tratam_foto_nota', 'tratam_trans_nota', 'pago_nota', 'accesorio_id', 'costo_armazon_int', 'costo_lunas_int', 'costo_accesorio_int', 'costo_tratamientos_int', 'costo_varios_int', 'comprobante_url'].forEach(k => nuevoPaciente[k] = '');
        ['tratam_ar', 'tratam_ar_azul', 'tratam_azul', 'tratam_tinturado', 'tratam_foto', 'tratam_trans', 'tratam_ninguno'].forEach(k => nuevoPaciente[k] = 'NO');
        nuevoPaciente.descuento = '0'; nuevoPaciente.forma_pago = 'Efectivo'; nuevoPaciente.estado = 'Ninguno';
      } else {
        nuevoPaciente = { ...estadoInicial, fecha: hoy, cedula: value };
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
      if (!nuevoPrecio.rango_medida) return mostrarToast("Ingresa el rango de medida.", "warning");
      let datosAGuardar = { ...nuevoPrecio, costo_laboratorio: Number(safeNum(nuevoPrecio.costo_laboratorio).toFixed(2)), precio_sugerido: Number(safeNum(nuevoPrecio.precio_sugerido).toFixed(2)) };
      
      if (editandoPrecioId) {
        await supabase.from('lista_precios').update(datosAGuardar).eq('id', editandoPrecioId);
        mostrarToast("Tarifa actualizada.", "success");
      } else {
        await supabase.from('lista_precios').insert([datosAGuardar]);
        mostrarToast("Tarifa registrada.", "success");
      }
      setNuevoPrecio(precioInicial); setEditandoPrecioId(null); await obtenerDatos();
    } catch(err) { mostrarToast("Error al guardar.", "error"); }
  };

  const cargarParaEditarPrecio = (item) => { setNuevoPrecio({ ...item }); setEditandoPrecioId(item.id); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const eliminarPrecio = (id) => {
    solicitarConfirmacion("¿Seguro que deseas eliminar?", async () => {
      await supabase.from('lista_precios').delete().eq('id', id);
      mostrarToast("Eliminado.", "success"); await obtenerDatos();
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
      let datosAGuardar = { ...nuevoItemInv, precio: Number(safeNum(nuevoItemInv.precio).toFixed(2)), costo_compra: Number(safeNum(nuevoItemInv.costo_compra).toFixed(2)), stock: Math.round(safeNum(nuevoItemInv.stock)) || 1 };
      Object.keys(datosAGuardar).forEach(key => { if (datosAGuardar[key] === '') datosAGuardar[key] = null; });

      if (editandoInvId) {
        await supabase.from('inventario').update(datosAGuardar).eq('id', editandoInvId);
        mostrarToast("Inventario actualizado.", "success");
      } else {
        delete datosAGuardar.id;
        await supabase.from('inventario').insert([datosAGuardar]);
        mostrarToast("Producto agregado.", "success");
      }
      setNuevoItemInv(invInicial); setEditandoInvId(null); await obtenerDatos();
    } catch(e) { 
      mostrarToast("Error: " + e.message, "error"); 
    } finally { setCargandoImagen(false); }
  };

  const cargarParaEditarInventario = (item) => {
    let itemFormateado = { ...item };
    Object.keys(itemFormateado).forEach(key => { if (itemFormateado[key] === null) itemFormateado[key] = ''; });
    setNuevoItemInv(itemFormateado); setEditandoInvId(item.id); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const cancelarEdicionInventario = () => { setNuevoItemInv(invInicial); setEditandoInvId(null); setImagenSeleccionada(null); };
  const eliminarItemInventario = (id) => {
    solicitarConfirmacion("¿Eliminar ítem?", async () => {
      await supabase.from('inventario').delete().eq('id', id);
      mostrarToast("Ítem eliminado.", "success"); await obtenerDatos();
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

      let modoOfflineForzado = !navigator.onLine;

      if (!modoOfflineForzado) {
        try {
          const guardarConTimeout = async () => {
            let pac_id = paciente.paciente_id;
            if (pac_id) {
              await supabase.from('pacientes_perfil').update(perfilData).eq('id', pac_id);
            } else {
              const { data: existe } = await supabase.from('pacientes_perfil').select('id').eq('cedula', paciente.cedula).maybeSingle();
              if (existe) { 
                pac_id = existe.id; 
                await supabase.from('pacientes_perfil').update(perfilData).eq('id', pac_id); 
              } else { 
                const { data: nuevo, error: errNuevo } = await supabase.from('pacientes_perfil').insert([perfilData]).select().single(); 
                if (errNuevo) throw errNuevo;
                pac_id = nuevo.id; 
              }
            }

            clinicaData.paciente_id = pac_id;
            if (editandoId) {
              await supabase.from('consultas_clinicas').update(clinicaData).eq('id', editandoId);
            } else {
              await supabase.from('consultas_clinicas').insert([clinicaData]);
            }
          };

          await Promise.race([
            guardarConTimeout(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
          ]);

          mostrarToast("Consulta guardada en la nube.", "success");
          await terminarGuardado();
          return;
        } catch {
          modoOfflineForzado = true;
        }
      }

      if (modoOfflineForzado) {
        const id_paciente_fantasma = paciente.paciente_id || generarIdFantasma();
        const id_consulta_fantasma = editandoId || generarIdFantasma();
        clinicaData.paciente_id = id_paciente_fantasma;
        
        if (!paciente.paciente_id) {
          await encolarOperacion('pacientes_perfil', 'INSERT', { ...perfilData, id_temporal: id_paciente_fantasma });
        } else {
          await encolarOperacion('pacientes_perfil', 'UPDATE', { id: paciente.paciente_id, ...perfilData });
        }

        if (editandoId) {
          await encolarOperacion('consultas_clinicas', 'UPDATE', { id: editandoId, ...clinicaData, cedula: perfilData.cedula });
        } else {
          await encolarOperacion('consultas_clinicas', 'INSERT', { ...clinicaData, cedula: perfilData.cedula });
        }

        const registroLocalVisible = {
          id: id_consulta_fantasma,
          paciente_id: id_paciente_fantasma,
          fecha: clinicaData.fecha || hoy,
          cedula: perfilData.cedula,
          nombre: perfilData.nombre,
          alias: perfilData.alias || '',
          telefono: perfilData.telefono || '',
          correo: perfilData.correo || '',
          notas_clinicas: clinicaData.notas_clinicas || '',
          ...clinicaData,
          estado: 'Ninguno'
        };

        setHistorial(prev => [registroLocalVisible, ...prev.filter(p => p.cedula !== registroLocalVisible.cedula)]);
        const actualHist = await leerBoveda('backup_historial') || [];
        await escribirBoveda('backup_historial', [registroLocalVisible, ...actualHist]);

        mostrarToast("Guardado localmente. ¡Ya visible en tu historial!", "warning");
        setPaciente(estadoInicial);
        setEditandoId(null);
        setIntentadoGuardar(false);
        setVistaActual('historial');
      }
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
    await obtenerDatos();
  };

const borrarHistoriaClinica = (item) => {
    // Guarda de seguridad: no borrar consultas que tienen una venta asociada
    if (item.pedido_id) {
      return mostrarToast("Esta consulta tiene una VENTA asociada. Cancélala primero en la sección Pedidos y luego podrás borrar la consulta.", "warning");
    }
    solicitarConfirmacion("Vas a eliminar este registro permanentemente. ¿Continuar?", async () => {
      setHistorial(prev => prev.filter(h => h.id !== item.id));
      try {
        const histLocal = await leerBoveda('backup_historial') || [];
        await escribirBoveda('backup_historial', histLocal.filter(h => h.id !== item.id));
      } catch (e) { console.warn(e); }

      try {
        if (navigator.onLine) {
          const { error } = await supabase.from('consultas_clinicas').delete().eq('id', item.id);
          if (error) throw new Error(error.message);
        } else {
          await encolarOperacion('consultas_clinicas', 'DELETE', { id: item.id });
        }
        mostrarToast("Eliminado con éxito.", "success");
      } catch (err) {
        mostrarToast("Error al eliminar: " + err.message, "error");
        await obtenerDatos(); // Recarga por si el borrado optimista fue incorrecto
      }
    });
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
    const visitas = (historial || []).filter(h => safeString(h?.cedula) === safeString(item.cedula) && safeString(h?.nombre) !== 'CONSUMIDOR FINAL');
    setMedidasPaciente(visitas); setPedidoSeleccionado(itemFormateado); setArmazonOriginalCodigo(itemFormateado.codigo_armazon || ''); setAccesorioOriginalId(itemFormateado.accesorio_id || ''); setVistaActual('pedidos_form');
  };

  const crearVentaDirecta = () => {
    const ventaNueva = { ...estadoInicial, nombre: 'CONSUMIDOR FINAL', cedula: '9999999999', estado: 'Entregado' };
    setMedidasPaciente([]); setPedidoSeleccionado(ventaNueva); setArmazonOriginalCodigo(''); setAccesorioOriginalId(''); setVistaActual('pedidos_form');
  };

  const cambiarMedicionPedido = (e) => {
    const idVisit = e.target.value; const visit = (historial || []).find(h => String(h?.id) === String(idVisit));
    if (visit) setPedidoSeleccionado(prev => ({ ...prev, esfera_od: visit.esfera_od, cilindro_od: visit.cilindro_od, eje_od: visit.eje_od, adicion_od: visit.adicion_od, dnp_od: visit.dnp_od, altura_od: visit.altura_od, esfera_oi: visit.esfera_oi, cilindro_oi: visit.cilindro_oi, eje_oi: visit.eje_oi, adicion_oi: visit.adicion_oi, dnp_oi: visit.dnp_oi, altura_oi: visit.altura_oi }));
  };

  const autoCalcularPrecio = (pedidoActual) => {
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

    const pMat = { 'Plástico': 20, 'Policarbonato': 30, 'Reducido': 50, 'Hiperreducido': 70, 'Otros': 0 };
    if (pedidoActual.material_lente && pMat[pedidoActual.material_lente]) total += pMat[pedidoActual.material_lente];

    const pTrat = { tratam_ar: 20, tratam_ar_azul: 20, tratam_azul: 35, tratam_tinturado: 20, tratam_foto: 55, tratam_trans: 100 };
    ['tratam_ar', 'tratam_ar_azul', 'tratam_azul', 'tratam_tinturado', 'tratam_foto', 'tratam_trans'].forEach(k => { 
      if (pedidoActual[k] === 'SI') total += pTrat[k]; 
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
      const camposQueAfectanPrecio = ['codigo_armazon', 'material_lente', 'tratam_ar', 'tratam_ar_azul', 'tratam_azul', 'tratam_tinturado', 'tratam_foto', 'tratam_trans', 'tratam_ninguno'];

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

  // 🛡️ GUARDAR PEDIDO TOTALMENTE COMPATIBLE CON MODO OFFLINE
  const guardarPedido = async () => {
    try {
      let pac_id = pedidoSeleccionado.paciente_id || generarIdFantasma();
      let cons_id = pedidoSeleccionado.id || generarIdFantasma();
      let pedido_id_final = pedidoSeleccionado.pedido_id || generarIdFantasma();

      const camposPedido = ['fecha', 'venta', 'abono', 'descuento', 'forma_pago', 'estado', 'notas', 'codigo_armazon', 'tipo_lente', 'material_lente', 'comprobante_url'];
      let datosVenta = { paciente_id: pac_id, consulta_id: cons_id };
      camposPedido.forEach(k => datosVenta[k] = pedidoSeleccionado[k] === '' ? null : pedidoSeleccionado[k]);

      if (navigator.onLine) {
        try {
          if (!pedidoSeleccionado.paciente_id) {
            const { data: existe } = await supabase.from('pacientes_perfil').select('id').eq('cedula', pedidoSeleccionado.cedula).maybeSingle();
            if (existe) pac_id = existe.id;
            else {
              const { data: n } = await supabase.from('pacientes_perfil').insert([{ cedula: pedidoSeleccionado.cedula, nombre: pedidoSeleccionado.nombre }]).select().single();
              pac_id = n.id;
            }
          }
          if (!pedidoSeleccionado.id) {
            const { data: c } = await supabase.from('consultas_clinicas').insert([{ paciente_id: pac_id, fecha: pedidoSeleccionado.fecha || hoy }]).select('id').single();
            cons_id = c.id;
          }

          datosVenta.paciente_id = pac_id;
          datosVenta.consulta_id = cons_id;

          if (pedidoSeleccionado.pedido_id && !String(pedidoSeleccionado.pedido_id).startsWith('temp-')) {
            await supabase.from('pedidos_ventas').update(datosVenta).eq('id', pedidoSeleccionado.pedido_id);
          } else {
            await supabase.from('pedidos_ventas').insert([datosVenta]);
          }
          mostrarToast("Orden guardada en la nube.", "success");
        } catch (e) {
          console.warn("Fallo guardado online de pedido, rescatando offline...", e);
          await encolarOperacion('pedidos_ventas', 'INSERT', { ...datosVenta, cedula: pedidoSeleccionado.cedula, nombre: pedidoSeleccionado.nombre });
          mostrarToast("Guardado localmente (Offline).", "warning");
        }
      } else {
        await encolarOperacion('pedidos_ventas', 'INSERT', { ...datosVenta, cedula: pedidoSeleccionado.cedula, nombre: pedidoSeleccionado.nombre });
        mostrarToast("Guardado localmente (Offline).", "warning");
      }

      // Actualizar registro en historial visible
      const itemHistorialActualizado = {
        ...pedidoSeleccionado,
        id: cons_id,
        paciente_id: pac_id,
        pedido_id: pedido_id_final,
        ...datosVenta
      };

      setHistorial(prev => [itemHistorialActualizado, ...prev.filter(p => p.id !== cons_id)]);
      const backupActual = await leerBoveda('backup_historial') || [];
      await escribirBoveda('backup_historial', [itemHistorialActualizado, ...backupActual.filter(p => p.id !== cons_id)]);

      setPedidoSeleccionado(null);
      setVistaActual('pedidos_lista');
      if (navigator.onLine) await obtenerDatos();
    } catch(e) { 
      mostrarToast("Error al guardar pedido: " + e.message, "error"); 
    }
  };

  const cancelarPedido = (item) => {
    solicitarConfirmacion("¿Cancelar venta?", async () => {
      if (item.pedido_id) {
        if (navigator.onLine) await supabase.from('pedidos_ventas').delete().eq('id', item.pedido_id);
        else await encolarOperacion('pedidos_ventas', 'DELETE', { id: item.pedido_id });
      }
      setHistorial(prev => prev.map(p => p.id === item.id ? { ...p, pedido_id: null, venta: '', abono: '', estado: 'Ninguno' } : p));
      mostrarToast("Pedido cancelado.", "success"); 
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

  const stats = (() => {
    try {
      const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
      let ventasMes = 0; let abonosPendientes = 0;
      (historial || []).forEach(p => {
        if (!p) return;
        const vFinal = Number((safeNum(p.venta) - (safeNum(p.venta) * safeNum(p.descuento) / 100)).toFixed(2));
        if (p.fecha && p.fecha >= inicioMes) { ventasMes += vFinal; }
        const abonoRedondeado = Number(safeNum(p.abono).toFixed(2));
        if (vFinal - abonoRedondeado > 0) abonosPendientes += (vFinal - abonoRedondeado);
      });
      return { ventasMes: Number(ventasMes.toFixed(2)), abonosPendientes: Number(abonosPendientes.toFixed(2)), total: (historial || []).length };
    } catch(e) { return { ventasMes: 0, abonosPendientes: 0, total: 0 }; }
  })();

  const edadActual = calcularEdad(paciente?.fecha_nacimiento);
  const claseInputRef = (campo, clasesExtra) => {
    const estaVacio = safeString(paciente[campo]).trim() === '';
    return (intentadoGuardar && estaVacio) ? `w-full p-2 text-center outline-none transition-all border-2 border-red-500 bg-red-100 ${clasesExtra}` : `w-full p-2 text-center outline-none ${clasesExtra}`;
  };

  return {
    guardando,
    estaAutenticado, cargandoAuth, cerrarSesion,
    toast, confirmDialog, setConfirmDialog, vistaActual, setVistaActual,
    historial, inventario, listaPrecios, paciente, setPaciente, estadoInicial, editandoId, setEditandoId, 
    guardarPacienteClinico, manejarCambio, borrarHistoriaClinica, cargarParaEditarClinico, edadActual, claseInputRef,
    busqueda, setBusqueda, pedidosFiltrados, stats, enviarWhatsApp,
    nuevoPrecio, setNuevoPrecio, precioInicial, editandoPrecioId, setEditandoPrecioId,
    manejarCambioPrecio, guardarPrecio, busquedaPrecio, setBusquedaPrecio, listaPreciosFiltrada, cargarParaEditarPrecio, eliminarPrecio,
    nuevoItemInv, editandoInvId, cargandoImagen, manejarCambioInv, setImagenSeleccionada, guardarItemInventario, cancelarEdicionInventario, cargarParaEditarInventario, eliminarItemInventario,
    pedidoSeleccionado, setPedidoSeleccionado, medidasPaciente, accesorioOriginalId, crearVentaDirecta, abrirPedido, cambiarMedicionPedido, forzarRecalculo, manejarCambioPedido, guardarPedido, cancelarPedido
  };
}
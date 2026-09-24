import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { safeString, safeNum, comprimirImagen, calcularEdad } from './utilidades'
import { leerBoveda, escribirBoveda, encolarOperacion, generarId, purgarTareasDeRegistro, eliminarTareaDeBandeja, marcarIntentoFallido, moverABandejaMuerta } from './motorOffline'

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
    // 1. CARGA INMEDIATA DESDE BÓVEDA LOCAL (nunca quedarse sin datos)
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

    // 2. SINCRONIZACIÓN CON LA NUBE
    if (!navigator.onLine) return;

    try {
      const bandejaSalida = await leerBoveda('bandeja_salida') || [];
      const remapeoIds = {}; // si un perfil ya existía con otro id, aquí queda la traducción

      if (bandejaSalida.length > 0) {
        // Los perfiles van primero (las consultas y ventas dependen de ellos)
        const tareasOrdenadas = [...bandejaSalida].sort((a, b) => {
          if (a.tabla === 'pacientes_perfil' && b.tabla !== 'pacientes_perfil') return -1;
          if (a.tabla !== 'pacientes_perfil' && b.tabla === 'pacientes_perfil') return 1;
          return 0;
        });

        for (const tarea of tareasOrdenadas) {
          try {
            let datos = { ...tarea.datos };

            if (tarea.tabla === 'pacientes_perfil') {
              delete datos.id_temporal; // limpiar tareas muy viejas
              if (tarea.tipo === 'INSERT') {
                // upsert por cédula: crea si no existe, actualiza si ya está. Imposible duplicar.
                const { data: perfilSubido, error } = await supabase.from('pacientes_perfil')
                  .upsert([datos], { onConflict: 'cedula' })
                  .select('id')
                  .single();
                if (error) throw new Error(error.message);
                // Si la nube conservó otro id (perfil ya existía), guardar la traducción
                if (perfilSubido && datos.id && perfilSubido.id !== datos.id) {
                  remapeoIds[datos.id] = perfilSubido.id;
                }
              } else if (tarea.tipo === 'UPDATE') {
                const { id, ...resto } = datos;
                const { error } = await supabase.from('pacientes_perfil').update(resto).eq('id', id);
                if (error) throw new Error(error.message);
              }

            } else if (tarea.tabla === 'consultas_clinicas' || tarea.tabla === 'pedidos_ventas') {
              // Resolver el paciente real: por remapeo, o buscando por cédula (tareas viejas con temp-)
              if (datos.paciente_id && remapeoIds[datos.paciente_id]) {
                datos.paciente_id = remapeoIds[datos.paciente_id];
              } else if (datos.paciente_id && String(datos.paciente_id).startsWith('temp-') && datos.cedula) {
                const { data: perfilReal, error: errBusca } = await supabase.from('pacientes_perfil').select('id').eq('cedula', datos.cedula).maybeSingle();
                if (errBusca) throw new Error(errBusca.message);
                if (perfilReal) datos.paciente_id = perfilReal.id;
              }
              delete datos.cedula;
              delete datos.nombre;

              if (tarea.tipo === 'INSERT') {
                const { error } = await supabase.from(tarea.tabla).upsert([datos]);
                if (error) throw new Error(error.message);
              } else if (tarea.tipo === 'UPDATE') {
                const { id, ...resto } = datos;
                const { error } = await supabase.from(tarea.tabla).update(resto).eq('id', id);
                if (error) throw new Error(error.message);
              } else if (tarea.tipo === 'DELETE') {
                const { error } = await supabase.from(tarea.tabla).delete().eq('id', datos.id);
                if (error) throw new Error(error.message);
              }

            } else {
              if (tarea.tipo === 'UPDATE') {
                const { id, ...resto } = datos;
                const { error } = await supabase.from(tarea.tabla).update(resto).eq('id', id);
                if (error) throw new Error(error.message);
              } else if (tarea.tipo === 'DELETE') {
                const { error } = await supabase.from(tarea.tabla).delete().eq('id', datos.id);
                if (error) throw new Error(error.message);
              }
            }

            await eliminarTareaDeBandeja(tarea.id_tarea);

          } catch (errTarea) {
            console.error("Fallo tarea:", errTarea);
            const intentos = await marcarIntentoFallido(tarea);
            if (intentos >= 5) {
              await moverABandejaMuerta(tarea, String(errTarea?.message || errTarea));
              mostrarToast("Una operación no pudo sincronizarse tras varios intentos y quedó archivada para revisión.", "error");
            }
          }
        }
      }

      // 3. DESCARGA DE LA NUBE + MERGE (los pendientes no se borran de la vista)
      const { data: hist } = await supabase.from('vista_pacientes').select('*').order('fecha', { ascending: false }).limit(50);
      const { data: inv } = await supabase.from('inventario').select('*').order('id', { ascending: false });
      const { data: prec } = await supabase.from('lista_precios').select('*').order('id', { ascending: false });

      if (hist) {
        const tareasRestantes = await leerBoveda('bandeja_salida') || [];
        const idsPendientes = new Set(
          tareasRestantes.filter(t => t.tabla === 'consultas_clinicas' && t.tipo !== 'DELETE')
            .map(t => t.datos && t.datos.id).filter(Boolean)
        );
        const locales = await leerBoveda('backup_historial') || [];
        const fantasmas = locales.filter(p => idsPendientes.has(p.id));

        const vistos = new Set();
        const combinado = [...hist, ...fantasmas].filter(p => {
          if (vistos.has(p.id)) return false;
          vistos.add(p.id);
          return true;
        });

        setHistorial(combinado);
        await escribirBoveda('backup_historial', combinado);
      }
      if (inv) {
        setInventario(inv);
        await escribirBoveda('backup_inventario', inv);
      }
      if (prec) {
        setListaPrecios(prec);
        await escribirBoveda('backup_precios', prec);
      }

      // 4. AVISO: cuánto queda pendiente
      const restantes = (await leerBoveda('bandeja_salida') || []).length;
      if (restantes > 0) {
        mostrarToast(`⏳ ${restantes} operación(es) esperando sincronizar. Se reintentarán.`, "warning");
      }
    } catch (e) {
      console.warn("Fallo sincronización online:", e);
    }
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
        const { error } = await supabase.from('inventario').update(datosAGuardar).eq('id', editandoInvId);
        if (error) throw new Error(error.message);
        mostrarToast("Inventario actualizado.", "success");
      } else {
        delete datosAGuardar.id;
        const { error } = await supabase.from('inventario').insert([datosAGuardar]);
        if (error) throw new Error(error.message);
        mostrarToast("Producto agregado.", "success");
      }
      setNuevoItemInv(invInicial); setEditandoInvId(null);
      setImagenSeleccionada(null);
      await obtenerDatos();
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
      try {
        const { error } = await supabase.from('inventario').delete().eq('id', id);
        if (error) throw new Error(error.message);
        mostrarToast("Ítem eliminado.", "success"); await obtenerDatos();
      } catch (err) {
        mostrarToast("Error al eliminar: " + err.message, "error");
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

  const guardarPacienteClinico = async () => {  const guardarPacienteClinico = async () => {
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

      // IDENTIDAD DEFINITIVA: los mismos ids sirven al flujo online y al offline
      const idPaciente = paciente.paciente_id || generarId();
      const idConsulta = editandoId || generarId();

      let modoOfflineForzado = !navigator.onLine;

      if (!modoOfflineForzado) {
        try {
          const guardarEnLaNube = async () => {
            let pac_id = paciente.paciente_id;
            if (pac_id) {
              const { error: errUpd } = await supabase.from('pacientes_perfil').update(perfilData).eq('id', pac_id);
              if (errUpd) throw new Error(errUpd.message);
            } else {
              const { data: existe, error: errSel } = await supabase.from('pacientes_perfil').select('id').eq('cedula', paciente.cedula).maybeSingle();
              if (errSel) throw new Error(errSel.message);
              if (existe) {
                pac_id = existe.id;
                const { error: errUpd } = await supabase.from('pacientes_perfil').update(perfilData).eq('id', pac_id);
                if (errUpd) throw new Error(errUpd.message);
              } else {
                const { error: errNuevo } = await supabase.from('pacientes_perfil').insert([{ ...perfilData, id: idPaciente }]);
                if (errNuevo) throw new Error(errNuevo.message);
                pac_id = idPaciente;
              }
            }

            clinicaData.paciente_id = pac_id;
            clinicaData.id = idConsulta;
            const { error: errCon } = await supabase.from('consultas_clinicas').upsert([clinicaData]);
            if (errCon) throw new Error(errCon.message);
          };

          await Promise.race([
            guardarEnLaNube(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000))
          ]);

          mostrarToast("Consulta guardada en la nube.", "success");
          await terminarGuardado();
          return;
        } catch (err) {
          console.warn("Guardado online falló, usando modo offline:", err?.message || err);
          modoOfflineForzado = true;
        }
      }

      if (modoOfflineForzado) {
        clinicaData.paciente_id = idPaciente;
        clinicaData.id = idConsulta;

        if (!paciente.paciente_id) {
          await encolarOperacion('pacientes_perfil', 'INSERT', { ...perfilData, id: idPaciente });
        } else {
          await encolarOperacion('pacientes_perfil', 'UPDATE', { id: paciente.paciente_id, ...perfilData });
        }

        if (editandoId) {
          await encolarOperacion('consultas_clinicas', 'UPDATE', { id: editandoId, ...clinicaData, cedula: perfilData.cedula });
        } else {
          await encolarOperacion('consultas_clinicas', 'INSERT', { ...clinicaData, cedula: perfilData.cedula });
        }

        const registroLocalVisible = {
          id: idConsulta,
          paciente_id: idPaciente,
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

  const borrarHistoriaClinica = (item, alEliminarLocal) => {
    // Guarda de seguridad: no permitir borrar consultas que tienen una venta asociada
    if (item.pedido_id) {
      return mostrarToast("Esta consulta tiene una VENTA asociada. Cancélala primero en la sección Pedidos y luego podrás borrar la consulta.", "warning");
    }
    solicitarConfirmacion("Vas a eliminar este registro permanentemente. ¿Continuar?", async () => {
      setHistorial(prev => prev.filter(h => h.id !== item.id));
      try {
        const histLocal = await leerBoveda('backup_historial') || [];
        await escribirBoveda('backup_historial', histLocal.filter(h => h.id !== item.id));
      } catch (e) {
        console.warn(e);
      }

      // Purga: si había tareas pendientes de esta consulta, mueren también
      await purgarTareasDeRegistro('consultas_clinicas', item.id);

      try {
        if (navigator.onLine) {
          const { error } = await supabase.from('consultas_clinicas').delete().eq('id', item.id);
          if (error) throw new Error(error.message);
        } else {
          await encolarOperacion('consultas_clinicas', 'DELETE', { id: item.id });
        }
        mostrarToast("Eliminado con éxito.", "success");
        if (alEliminarLocal) alEliminarLocal();
      } catch (err) {
        mostrarToast("Error al eliminar: " + err.message, "error");
        await obtenerDatos();
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

    // MATERIAL DE LUNAS (precio base fijo)
    const pMat = { 'Plástico': 20, 'Policarbonato': 30, 'Reducido': 50, 'Hiperreducido': 70, 'Otros': 0 };
    if (pedidoActual.material_lente && pMat[pedidoActual.material_lente]) total += pMat[pedidoActual.material_lente];

    // TRATAMIENTOS (precio fijo cada uno)
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

  // 🛡️ GUARDAR PEDIDO CON IDENTIDAD PROPIA (compatible con modo offline)
  const guardarPedido = async () => {
    try {
      // IDENTIDAD: la venta nace con su id definitivo (mismo online y offline)
      const idPedido = (pedidoSeleccionado.pedido_id && !String(pedidoSeleccionado.pedido_id).startsWith('temp-'))
        ? pedidoSeleccionado.pedido_id
        : generarId();
      const idPacientePedido = pedidoSeleccionado.paciente_id || generarId();
      const idConsultaPedido = pedidoSeleccionado.id || generarId();

      const camposPedido = ['fecha', 'venta', 'abono', 'descuento', 'forma_pago', 'pago_nota', 'estado', 'notas', 'comprobante_url', 'codigo_armazon', 'tipo_armazon', 'param_horizontal', 'param_puente', 'param_vertical', 'param_diagonal', 'tipo_lente', 'material_lente', 'material_nota', 'accesorio_id', 'tratam_ninguno', 'tratam_ar', 'tratam_ar_azul', 'tratam_azul', 'tratam_tinturado', 'tratam_tinturado_nota', 'tratam_foto', 'tratam_foto_nota', 'tratam_trans', 'tratam_trans_nota', 'costo_armazon_int', 'costo_lunas_int', 'costo_accesorio_int', 'costo_tratamientos_int', 'costo_varios_int'];
      let datosVenta = { id: idPedido, paciente_id: idPacientePedido, consulta_id: idConsultaPedido };
      camposPedido.forEach(k => datosVenta[k] = pedidoSeleccionado[k] === '' ? null : pedidoSeleccionado[k]);

      // Una venta NUEVA nace HOY (no hereda la fecha de una consulta antigua)
      const esPedidoNuevo = !pedidoSeleccionado.pedido_id || String(pedidoSeleccionado.pedido_id).startsWith('temp-');
      if (esPedidoNuevo) {
        datosVenta.fecha = hoy;
      }

      let pac_id = null;
      let cons_id = null;
      let guardadoOnline = false;

      if (navigator.onLine) {
        try {
          // 1. Asegurar el perfil del paciente
          if (pedidoSeleccionado.paciente_id) {
            pac_id = pedidoSeleccionado.paciente_id;
          } else {
            const { data: existe, error: errSel } = await supabase.from('pacientes_perfil').select('id').eq('cedula', pedidoSeleccionado.cedula).maybeSingle();
            if (errSel) throw new Error(errSel.message);
            if (existe) {
              pac_id = existe.id;
            } else {
              const { error: errPerfil } = await supabase.from('pacientes_perfil').insert([{ id: idPacientePedido, cedula: pedidoSeleccionado.cedula, nombre: pedidoSeleccionado.nombre }]);
              if (errPerfil) throw new Error(errPerfil.message);
              pac_id = idPacientePedido;
            }
          }

          // 2. Asegurar la consulta (las ventas cuelgan de una)
          if (pedidoSeleccionado.id) {
            cons_id = pedidoSeleccionado.id;
          } else {
            const { error: errCons } = await supabase.from('consultas_clinicas').insert([{ id: idConsultaPedido, paciente_id: pac_id, fecha: hoy }]);
            if (errCons) throw new Error(errCons.message);
            cons_id = idConsultaPedido;
          }

          // 3. Guardar la venta con upsert (imposible duplicar)
          datosVenta.paciente_id = pac_id;
          datosVenta.consulta_id = cons_id;
          const { error: errVenta } = await supabase.from('pedidos_ventas').upsert([datosVenta]);
          if (errVenta) throw new Error(errVenta.message);

          guardadoOnline = true;
          mostrarToast("Orden guardada en la nube.", "success");
        } catch (e) {
          console.warn("Fallo guardado online de pedido, rescatando offline...", e);
        }
      }

      if (!guardadoOnline) {
        // MODO OFFLINE: encolar lo que falte + la venta con su id definitivo
        datosVenta.paciente_id = pac_id || pedidoSeleccionado.paciente_id || idPacientePedido;
        datosVenta.consulta_id = cons_id || pedidoSeleccionado.id || idConsultaPedido;

        if (!pac_id && !pedidoSeleccionado.paciente_id) {
          await encolarOperacion('pacientes_perfil', 'INSERT', { id: idPacientePedido, cedula: pedidoSeleccionado.cedula, nombre: pedidoSeleccionado.nombre });
        }
        if (!cons_id && !pedidoSeleccionado.id) {
          await encolarOperacion('consultas_clinicas', 'INSERT', { id: idConsultaPedido, paciente_id: datosVenta.paciente_id, fecha: hoy, cedula: pedidoSeleccionado.cedula });
        }
        await encolarOperacion('pedidos_ventas', 'INSERT', { ...datosVenta, cedula: pedidoSeleccionado.cedula, nombre: pedidoSeleccionado.nombre });
        mostrarToast("Guardado localmente (Offline).", "warning");
      }

      // Actualizar el registro visible en el historial
      const { id: _idVenta, ...datosParaHistorial } = datosVenta;
      const itemHistorialActualizado = {
        ...pedidoSeleccionado,
        id: datosVenta.consulta_id,
        paciente_id: datosVenta.paciente_id,
        pedido_id: idPedido,
        ...datosParaHistorial
      };

      setHistorial(prev => [itemHistorialActualizado, ...prev.filter(p => p.id !== itemHistorialActualizado.id)]);
      const backupActual = await leerBoveda('backup_historial') || [];
      await escribirBoveda('backup_historial', [itemHistorialActualizado, ...backupActual.filter(p => p.id !== itemHistorialActualizado.id)]);

      setPedidoSeleccionado(null);
      setVistaActual('pedidos_lista');
      if (guardadoOnline) await obtenerDatos();
    } catch(e) { 
      mostrarToast("Error al guardar pedido: " + e.message, "error"); 
    }
  };

  const cancelarPedido = (item) => {
    solicitarConfirmacion("¿Cancelar venta?", async () => {
      try {
        if (item.pedido_id) {
          if (navigator.onLine) {
            const { error } = await supabase.from('pedidos_ventas').delete().eq('id', item.pedido_id);
            if (error) throw new Error(error.message);
          } else {
            await encolarOperacion('pedidos_ventas', 'DELETE', { id: item.pedido_id });
          }
          // Purga: si la venta tenía tareas pendientes, mueren también (no resucita)
          await purgarTareasDeRegistro('pedidos_ventas', item.pedido_id);
        }
        setHistorial(prev => prev.map(p => p.id === item.id ? { ...p, pedido_id: null, venta: '', abono: '', estado: 'Ninguno' } : p));
        mostrarToast("Pedido cancelado.", "success");
      } catch (err) {
        mostrarToast("Error al cancelar: " + err.message, "error");
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

  const stats = (() => {
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
    } catch(e) { 
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
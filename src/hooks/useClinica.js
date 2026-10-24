import { useState, useCallback } from 'react';
import { safeString, calcularEdad } from '../utilidades';
import { createUuid as generarId } from '../localDb';
import { guardarConsultaLocal, archivarConsultaIndividualLocal } from '../localRepository';
import { sincronizarAhora, sinSesionActiva } from '../syncEngine';
import { textoConsultaPendiente } from '../avisosSync';
import { eliminarPacienteDefinitivo } from '../eliminacionPaciente';
import { limpiarHtml } from '../escape';
import { validarFichaClinica } from '../validacion';
import { aplicarAvisoQueratometria } from '../reglas';
import { aplicarCedula, crearEstadoPaciente, hoyISO, CAMPOS_DE_VENTA, TRATAMIENTOS } from '../fichaClinica';

// ---------------------------------------------------------------------------
// FICHA CLINICA
// ---------------------------------------------------------------------------
// Estado del formulario del paciente y todo lo que se puede hacer con una
// consulta: guardarla, archivarla puntualmente, borrar al paciente entero y
// precargar/limpiar el formulario. Recibe el historial ya cargado (no lo posee)
// y la navegacion, que es estado de la interfaz.
// ---------------------------------------------------------------------------
export function useClinica({
  hoy, estadoInicial, historial, setHistorial, setVentasLocales, setVentasArchivadas,
  mostrarToast, obtenerDatos, setVistaActual
}) {
  const [paciente, setPaciente] = useState(estadoInicial);
  const [editandoId, setEditandoId] = useState(null);
  const [intentadoGuardar, setIntentadoGuardar] = useState(false);
  // Cuenta los intentos fallidos de guardar. La pantalla lo usa para llevar al
  // primer dato vacio: si solo fuera un booleano, el segundo intento no haria
  // nada (el valor ya estaba en true) y el usuario seguiria sin saber donde ir.
  const [intentosGuardado, setIntentosGuardado] = useState(0);
  const [guardando, setGuardando] = useState(false);

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
        setIntentosGuardado(n => n + 1);
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
          : textoConsultaPendiente(sinSesionActiva()),
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

  // borrarHistoriaClinica viaja hasta las tarjetas memoizadas del Historial:
  // sin useCallback su referencia cambiaria en cada render y el memo no serviria.
  const borrarHistoriaClinica = useCallback(async (item, { descargarCopia = false } = {}) => {
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
  }, [obtenerDatos, mostrarToast, setHistorial, setVentasLocales, setVentasArchivadas]);

  // Estos tres handlers llegan a las tarjetas memoizadas del Historial: se
  // estabilizan con deps vacias leyendo la fecha en el momento de la llamada
  // (hoyISO()) en vez de cerrar sobre el `hoy` del render, que cambia siempre.
  const cargarParaEditarClinico = useCallback((item) => {
    let itemFormateado = { ...item };
    Object.keys(itemFormateado).forEach(key => { if (itemFormateado[key] === null) itemFormateado[key] = ''; });
    setPaciente({ ...crearEstadoPaciente(hoyISO()), ...itemFormateado });
    setEditandoId(item.id);
    setVistaActual('nueva_medicion');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setVistaActual]);

  const iniciarNuevaConsulta = useCallback((item) => {
    const estadoLimpio = crearEstadoPaciente(hoyISO());
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
  }, [setVistaActual]);

  const crearNuevoPaciente = useCallback((sugerenciaTexto = '') => {
    const limpio = safeString(sugerenciaTexto).trim();
    const esNumero = /^\d+$/.test(limpio);
    const nuevaFicha = {
      ...crearEstadoPaciente(hoyISO()),
      cedula: esNumero ? limpio : '',
      nombre: !esNumero ? limpio.toUpperCase() : ''
    };
    setPaciente(nuevaFicha);
    setEditandoId(null);
    setVistaActual('nueva_medicion');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setVistaActual]);

  const edadActual = calcularEdad(paciente?.fecha_nacimiento);
  const claseInputRef = (campo, clasesExtra) => {
    const estaVacio = safeString(paciente[campo]).trim() === '';
    return (intentadoGuardar && estaVacio) 
      ? `w-full p-2 text-center outline-none transition-all border-2 border-red-500 bg-red-100 ${clasesExtra}` 
      : `w-full p-2 text-center outline-none ${clasesExtra}`;
  };

  return {
    paciente, setPaciente, editandoId, setEditandoId, guardando,
    manejarCambio, guardarPacienteClinico, borrarHistoriaClinica,
    archivarConsultaPuntual, cargarParaEditarClinico, iniciarNuevaConsulta,
    crearNuevoPaciente, edadActual, claseInputRef, intentosGuardado
  };
}

import { useState } from 'react';
import { 
  sincronizarAhora, obtenerDetalleCola, 
  reintentarOperacion, descartarOperacion, descartarTodoLoAtascado 
} from './syncEngine';
import { crearEstadoPaciente, hoyISO, INV_INICIAL, PRECIO_INICIAL } from './fichaClinica';
import { useAvisos } from './hooks/useAvisos';
import { useConfirmacion } from './hooks/useConfirmacion';
import { useSincronizacion } from './hooks/useSincronizacion';
import { useDatosLocales } from './hooks/useDatosLocales';
import { useTarifario } from './hooks/useTarifario';
import { useInventario } from './hooks/useInventario';
import { useClinica } from './hooks/useClinica';
import { usePedidos } from './hooks/usePedidos';
import { useAutenticacion } from './hooks/useAutenticacion';

export function useGestor() {
  const { toast, mostrarToast } = useAvisos();

  const {
    confirmDialog, setConfirmDialog, cancelarConfirmacion,
    aceptarConfirmacion, solicitarConfirmacion, confirmar
  } = useConfirmacion();

  const hoy = hoyISO();
  const estadoInicial = crearEstadoPaciente(hoy);
  const invInicial = INV_INICIAL;
  const precioInicial = PRECIO_INICIAL;

  const {
    historial, setHistorial, cedulasArchivadas,
    ventasArchivadas, setVentasArchivadas,
    ventasLocales, setVentasLocales,
    inventario, listaPrecios, obtenerDatos, limpiarDatos
  } = useDatosLocales();
  
  const {
    nuevoPrecio, setNuevoPrecio, editandoPrecioId, setEditandoPrecioId,
    busquedaPrecio, setBusquedaPrecio, manejarCambioPrecio, guardarPrecio,
    cargarParaEditarPrecio, eliminarPrecio, listaPreciosFiltrada
  } = useTarifario({ precioInicial, listaPrecios, mostrarToast, obtenerDatos, solicitarConfirmacion });

  const {
    nuevoItemInv, editandoInvId, cargandoImagen, setImagenSeleccionada,
    manejarCambioInv, guardarItemInventario, cargarParaEditarInventario,
    cancelarEdicionInventario, eliminarItemInventario
  } = useInventario({ invInicial, mostrarToast, obtenerDatos, solicitarConfirmacion });

  const [vistaActual, setVistaActual] = useState('historial'); 

  const {
    paciente, setPaciente, editandoId, setEditandoId, guardando,
    manejarCambio, guardarPacienteClinico, borrarHistoriaClinica,
    archivarConsultaPuntual, cargarParaEditarClinico, iniciarNuevaConsulta,
    crearNuevoPaciente, edadActual, claseInputRef, intentosGuardado
  } = useClinica({
    hoy, estadoInicial, historial, setHistorial, setVentasLocales, setVentasArchivadas,
    mostrarToast, obtenerDatos, setVistaActual
  });

  const {
    busqueda, setBusqueda, pedidoSeleccionado, setPedidoSeleccionado,
    medidasPaciente, accesorioOriginalId, crearVentaDirecta, abrirPedido,
    cambiarMedicionPedido, forzarRecalculo, manejarCambioPedido, guardarPedido,
    cancelarPedido, enviarWhatsApp, pedidosFiltrados, stats
  } = usePedidos({
    historial, ventasArchivadas, ventasLocales, setHistorial, setVentasLocales,
    inventario, listaPrecios, estadoInicial, hoy,
    mostrarToast, obtenerDatos, solicitarConfirmacion, setVistaActual
  });

  const {
    estaAutenticado, cargandoAuth, modoSinConexion, dispositivo,
    configurarAccesoSinConexion, desactivarAccesoSinConexion, cerrarSesion, entrarSinConexion,
    rol, esAdmin
  } = useAutenticacion({ mostrarToast, solicitarConfirmacion, obtenerDatos, limpiarDatos });

  const { syncEstado } = useSincronizacion(estaAutenticado);

  return {
    guardando,
    obtenerDatos, solicitarConfirmacion, confirmar, cancelarConfirmacion, aceptarConfirmacion,
    estaAutenticado, cargandoAuth, cerrarSesion, rol, esAdmin,
    modoSinConexion, entrarSinConexion, dispositivo, configurarAccesoSinConexion, desactivarAccesoSinConexion,
    toast, confirmDialog, setConfirmDialog, vistaActual, setVistaActual, syncEstado, sincronizarAhora,
    obtenerDetalleCola, reintentarOperacion, descartarOperacion, descartarTodoLoAtascado,
    historial, ventasArchivadas, ventasLocales, inventario, listaPrecios, paciente, setPaciente, estadoInicial, editandoId, setEditandoId,
    cedulasArchivadas, 
    guardarPacienteClinico, manejarCambio, borrarHistoriaClinica, archivarConsultaPuntual, cargarParaEditarClinico, iniciarNuevaConsulta, crearNuevoPaciente, edadActual, claseInputRef, intentosGuardado,
    busqueda, setBusqueda, pedidosFiltrados, stats, enviarWhatsApp,
    nuevoPrecio, setNuevoPrecio, precioInicial, editandoPrecioId, setEditandoPrecioId,
    manejarCambioPrecio, guardarPrecio, busquedaPrecio, setBusquedaPrecio, listaPreciosFiltrada, cargarParaEditarPrecio, eliminarPrecio,
    nuevoItemInv, editandoInvId, cargandoImagen, manejarCambioInv, setImagenSeleccionada, guardarItemInventario, cancelarEdicionInventario, cargarParaEditarInventario, eliminarItemInventario,
    pedidoSeleccionado, setPedidoSeleccionado, medidasPaciente, accesorioOriginalId, crearVentaDirecta, abrirPedido, cambiarMedicionPedido, forzarRecalculo, manejarCambioPedido, guardarPedido, cancelarPedido
  };
}
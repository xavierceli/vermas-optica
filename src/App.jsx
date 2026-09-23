import { useState, useEffect } from 'react'
import Login from './Login'
import Inventario from './Inventario'
import Historial from './Historial'
import Clinica from './Clinica'
import Tarifario from './Tarifario'
import PedidosLista from './PedidosLista'
import PedidosForm from './PedidosForm'
import Dashboard from './Dashboard'
import { imprimirOrdenTrabajo, imprimirRecibo } from './impresiones'
import { useGestor } from './useGestor'

function App() {
  const g = useGestor(); 
  
  const [esOffline, setEsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const verificarInternetReal = async () => {
      if (!navigator.onLine) {
        setEsOffline(true);
        return;
      }
      
      try {
        await fetch('https://www.google.com/favicon.ico?ping=' + Date.now(), { 
          mode: 'no-cors' 
        });
        setEsOffline(false);
      } catch (error) {
        setEsOffline(true);
      }
    };

    const radar = setInterval(verificarInternetReal, 3000);
    window.addEventListener('offline', () => setEsOffline(true));
    window.addEventListener('online', verificarInternetReal);
    verificarInternetReal();

    return () => {
      clearInterval(radar);
      window.removeEventListener('offline', () => setEsOffline(true));
      window.removeEventListener('online', verificarInternetReal);
    };
  }, []);

  // Si no está autenticado, mostramos el login de inmediato (evita quedarse congelado cargando)
  if (!g.estaAutenticado) return <Login />;

  return (
    <div className={`min-h-screen bg-gray-50 p-6 relative ${esOffline ? 'pt-14' : ''}`} translate="no">

      {/* --- HUD DE ALERTA ROJA PERMANENTE --- */}
      {esOffline && (
        <div className="fixed top-0 left-0 w-full bg-red-600 text-white text-center py-2 font-black text-xs md:text-sm z-[200] shadow-md flex items-center justify-center gap-2">
          <span className="animate-pulse text-lg">🔴</span> 
          MODO OFFLINE ACTIVO: Sin conexión a internet. El sistema sigue funcionando con la bóveda local.
        </div>
      )}

      {g.toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center gap-3 px-6 py-4 rounded-xl shadow-2xl transition-all ${
          g.toast.tipo === 'success' ? 'bg-teal-600 text-white' : g.toast.tipo === 'error' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
        }`}>
          <span className="text-2xl">{g.toast.tipo === 'success' ? '✅' : g.toast.tipo === 'error' ? '❌' : '⚠️'}</span>
          <p className="font-bold text-sm">{g.toast.mensaje}</p>
        </div>
      )}

      {g.confirmDialog.visible && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] px-4">
          <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full text-center">
            <div className="text-5xl mb-4">⚠️</div>
            <h3 className="text-xl font-black text-gray-800 mb-6">{g.confirmDialog.mensaje}</h3>
            <div className="flex gap-4 justify-center">
              <button onClick={() => g.setConfirmDialog({visible: false})} className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-xl font-bold transition-colors">Cancelar</button>
              <button onClick={() => { g.confirmDialog.onConfirm(); g.setConfirmDialog({visible: false}); }} className="flex-1 px-4 py-3 bg-red-600 text-white hover:bg-red-700 rounded-xl font-bold shadow-lg shadow-red-200 transition-colors">Sí, Continuar</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[1400px] mx-auto space-y-6">
        <div className="bg-white p-4 rounded-xl shadow-sm flex flex-col md:flex-row justify-between items-center border gap-4">
          <h1 className="font-extrabold text-teal-800 text-2xl tracking-wider">VER+ ÓPTICA</h1>
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={() => g.setVistaActual('historial')} className={`px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all ${g.vistaActual === 'historial' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>📋 Historial</button>
            <button onClick={() => {g.setVistaActual('nueva_medicion'); g.setEditandoId(null); g.setPaciente(g.estadoInicial)}} className={`px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all ${g.vistaActual === 'nueva_medicion' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>🩺 Clínica</button>
            <button onClick={() => {g.setVistaActual('pedidos_lista'); g.setPedidoSeleccionado(null)}} className={`px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all ${g.vistaActual.includes('pedido') ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>🛍️ Pedidos</button>
            <button onClick={() => {g.setVistaActual('inventario'); g.cancelarEdicionInventario();}} className={`px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all ${g.vistaActual === 'inventario' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>👓 Inventario</button>
            <button onClick={() => g.setVistaActual('precios')} className={`px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all ${g.vistaActual === 'precios' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>🏷️ Tarifario</button>
            <button onClick={() => g.setVistaActual('dashboard')} className={`px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all ${g.vistaActual === 'dashboard' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>📊 Stats</button>
            
            <div className="border-l-2 border-gray-200 h-8 mx-2 hidden md:block"></div>
            <button onClick={g.cerrarSesion} className="px-4 py-2 rounded-lg text-sm font-bold shadow-sm bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-all ml-auto">🚪 Salir</button>
          </div>
        </div>

        {g.vistaActual === 'dashboard' && <Dashboard stats={g.stats} historial={g.historial} inventario={g.inventario} />}
        {g.vistaActual === 'precios' && <Tarifario nuevoPrecio={g.nuevoPrecio} setNuevoPrecio={g.setNuevoPrecio} precioInicial={g.precioInicial} editandoPrecioId={g.editandoPrecioId} setEditandoPrecioId={g.setEditandoPrecioId} manejarCambioPrecio={g.manejarCambioPrecio} guardarPrecio={g.guardarPrecio} busquedaPrecio={g.busquedaPrecio} setBusquedaPrecio={g.setBusquedaPrecio} listaPreciosFiltrada={g.listaPreciosFiltrada} cargarParaEditarPrecio={g.cargarParaEditarPrecio} eliminarPrecio={g.eliminarPrecio} />}
        {g.vistaActual === 'inventario' && <Inventario inventario={g.inventario} nuevoItemInv={g.nuevoItemInv} editandoInvId={g.editandoInvId} cargandoImagen={g.cargandoImagen} manejarCambioInv={g.manejarCambioInv} setImagenSeleccionada={g.setImagenSeleccionada} guardarItemInventario={g.guardarItemInventario} cancelarEdicionInventario={g.cancelarEdicionInventario} cargarParaEditarInventario={g.cargarParaEditarInventario} eliminarItemInventario={g.eliminarItemInventario} />}
        {g.vistaActual === 'historial' && <Historial historialReciente={g.historial} enviarWhatsApp={g.enviarWhatsApp} cargarParaEditarClinico={g.cargarParaEditarClinico} borrarHistoriaClinica={g.borrarHistoriaClinica} abrirPedido={g.abrirPedido} crearNuevoPaciente={() => {g.setVistaActual('nueva_medicion'); g.setEditandoId(null); g.setPaciente(g.estadoInicial)}} />}
        {g.vistaActual === 'nueva_medicion' && <Clinica paciente={g.paciente} setPaciente={g.setPaciente} estadoInicial={g.estadoInicial} editandoId={g.editandoId} setEditandoId={g.setEditandoId} guardarPacienteClinico={g.guardarPacienteClinico} manejarCambio={g.manejarCambio} edadActual={g.edadActual} claseInputRef={g.claseInputRef} historial={g.historial} guardando={g.guardando} />}
        {g.vistaActual === 'pedidos_lista' && <PedidosLista crearVentaDirecta={g.crearVentaDirecta} busqueda={g.busqueda} setBusqueda={g.setBusqueda} pedidosFiltrados={g.pedidosFiltrados} imprimirRecibo={imprimirRecibo} imprimirOrdenTrabajo={imprimirOrdenTrabajo} cancelarPedido={g.cancelarPedido} abrirPedido={g.abrirPedido} registrarAbonoRapido={g.registrarAbonoRapido} />}
        {g.vistaActual === 'pedidos_form' && g.pedidoSeleccionado && <PedidosForm pedidoSeleccionado={g.pedidoSeleccionado} setPedidoSeleccionado={g.setPedidoSeleccionado} setVistaActual={g.setVistaActual} guardarPedido={g.guardarPedido} manejarCambioPedido={g.manejarCambioPedido} cambiarMedicionPedido={g.cambiarMedicionPedido} medidasPaciente={g.medidasPaciente} inventario={g.inventario} accesorioOriginalId={g.accesorioOriginalId} forzarRecalculo={g.forzarRecalculo} />}
      </div>
    </div>
  )
}

export default App
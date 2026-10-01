import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { useGestor } from './useGestor';
import { imprimirOrdenTrabajo, imprimirRecibo } from './impresiones';
import AvisoActualizacion from './AvisoActualizacion';
import PanelSincronizacion from './PanelSincronizacion';
import ErrorBoundary from './ErrorBoundary.jsx';

const Login = lazy(() => import('./Login'));
const Historial = lazy(() => import('./Historial'));
const Clinica = lazy(() => import('./Clinica'));
const Inventario = lazy(() => import('./Inventario'));
const Tarifario = lazy(() => import('./Tarifario'));
const Dashboard = lazy(() => import('./Dashboard'));
const PedidosLista = lazy(() => import('./PedidosLista'));
const PedidosForm = lazy(() => import('./PedidosForm'));

const ETIQUETAS = {
  dashboard: 'Estadísticas',
  precios: 'Tarifario',
  inventario: 'Inventario',
  historial: 'Historial',
  nueva_medicion: 'Clínica',
  pedidos_lista: 'Pedidos',
  pedidos_form: 'Datos del pedido'
};

const Cargando = () => (
  <div className="flex items-center justify-center gap-3 py-20 text-gray-500">
    <span className="w-6 h-6 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
    <span className="font-bold text-sm">Cargando…</span>
  </div>
);

function App() {
  const g = useGestor(); 
  
  const esOffline = g.syncEstado?.online === false;
  const pendientes = g.syncEstado?.pending || 0;
  const conflictos = g.syncEstado?.conflicts || 0;
  const descartadas = g.syncEstado?.descartadas || 0;
  const fallos = g.syncEstado?.fallos || [];
  const faseSync = g.syncEstado?.phase || 'idle';
  const sincronizando = faseSync === 'syncing';
  const hayErrorSync = faseSync === 'error' && !!g.syncEstado?.lastError;
  const sesionInvalida = !!g.syncEstado?.sesionInvalida;

  const detalleCola = descartadas > 0
    ? `${descartadas} se descartaron; revisa el panel de sincronización`
    : esOffline
    ? (pendientes > 0 ? 'Se subirán al recuperar conexión' : 'Todo guardado aquí')
    : fallos.length > 0
    ? String(fallos[0].motivo || '').slice(0, 100)
    : 'En cola de salida';

  const historialParcial = !!g.syncEstado?.historialParcial;
  const descargas = g.syncEstado?.historialDescargadas || 0;
  const tope = g.syncEstado?.historialTope || 0;

  const estadoOutbox = sesionInvalida
    ? { texto: 'Sesión expirada', detalle: 'Vuelve a iniciar sesión', clases: 'bg-red-100 text-red-800 border-red-300', icono: '🔑' }
    : fallos.length > 0
    ? { texto: `Rechazadas (${fallos.length})`, detalle: detalleCola, clases: 'bg-red-100 text-red-800 border-red-300', icono: '⛔' }
    : descartadas > 0
    ? { texto: `Descartadas (${descartadas})`, detalle: detalleCola, clases: 'bg-red-100 text-red-800 border-red-300', icono: '🗑️' }
    : hayErrorSync
    ? { texto: 'Error al sincronizar', detalle: String(g.syncEstado.lastError).slice(0, 90), clases: 'bg-red-100 text-red-800 border-red-300', icono: '⛔' }
    : conflictos > 0
      ? { texto: 'Conflictos', detalle: `${conflictos} por revisar`, clases: 'bg-amber-100 text-amber-800 border-amber-300', icono: '⚠️' }
      : esOffline
        ? { texto: 'Sin conexión', detalle: detalleCola, clases: 'bg-slate-800 text-slate-100 border-slate-600', icono: '📴' }
        : sincronizando
          ? { texto: 'Sincronizando...', detalle: pendientes > 0 ? `Pendientes: ${pendientes}` : 'Enviando a la nube', clases: 'bg-blue-100 text-blue-800 border-blue-300', icono: '🔄' }
          : pendientes > 0
            ? { texto: `Pendientes: ${pendientes}`, detalle: detalleCola, clases: 'bg-blue-100 text-blue-800 border-blue-300', icono: '⏳' }
            : historialParcial
              ? { texto: 'Historial parcial', detalle: `Solo ${descargas} de ${tope} consultas`, clases: 'bg-amber-100 text-amber-800 border-amber-300', icono: '⚠️' }
              : { texto: 'Sincronizado', detalle: 'Nube al día', clases: 'bg-emerald-100 text-emerald-800 border-emerald-300', icono: '✅' };

  const [panelSync, setPanelSync] = useState(false);
  const dialogoVisible = g.confirmDialog.visible;
  const refDialogo = useRef(null);

  useEffect(() => {
    const cerrarConEscape = (e) => {
      if (e.key === 'Escape') g.cancelarConfirmacion();
    };
    if (dialogoVisible) {
      window.addEventListener('keydown', cerrarConEscape);
      return () => window.removeEventListener('keydown', cerrarConEscape);
    }
  }, [dialogoVisible, g.cancelarConfirmacion]);

  useEffect(() => {
    if (dialogoVisible) refDialogo.current?.focus();
  }, [dialogoVisible]);

  if (!g.estaAutenticado) {
    return (
      <Suspense fallback={<Cargando />}>
        <Login
          dispositivo={g.dispositivo}
          entrarSinConexion={g.entrarSinConexion}
          modoSinConexion={g.modoSinConexion}
        />
      </Suspense>
    );
  }

  const tieneAvisoSuperior = esOffline || pendientes > 0 || conflictos > 0 || fallos.length > 0 || g.modoSinConexion;

  const textoFechaCompilacion = (() => {
    if (typeof __BUILD_ID__ === 'undefined') return 'Copia antigua. Recarga con Ctrl+Shift+R.';
    try {
      const timestamp = Number.parseInt(__BUILD_ID__, 36);
      if (Number.isFinite(timestamp)) {
        return `Compilada el ${new Date(timestamp).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' })}`;
      }
    } catch {
      /* Silencioso */
    }
    return `Versión compilada (${__BUILD_ID__})`;
  })();

  return (
    <div className={`min-h-screen bg-gray-50 p-3 sm:p-6 relative touch-manipulation ${tieneAvisoSuperior ? 'pt-12 sm:pt-14' : ''}`}>

      <AvisoActualizacion hayTrabajoSinGuardar={pendientes > 0 || g.guardando} confirmar={g.confirmar} />

      {tieneAvisoSuperior && (() => {
        const colorBarra = g.modoSinConexion ? 'bg-purple-800'
          : esOffline ? 'bg-slate-800'
          : fallos.length > 0 ? 'bg-red-700'
          : conflictos > 0 ? 'bg-amber-600'
          : 'bg-blue-700';
        const iconoBarra = g.modoSinConexion ? '🔓' : esOffline ? '📴' : fallos.length > 0 ? '⛔' : conflictos > 0 ? '⚠️' : '🔄';
        const textoBarra = g.modoSinConexion
          ? 'Modo sin conexión: PIN local activo. Los cambios se sincronizarán al iniciar sesión.'
          : esOffline
          ? 'Sin conexión a internet. Los datos se guardan localmente y se subirán al reconectar.'
          : fallos.length > 0
          ? `El servidor rechazó ${fallos.length} operación(es): ${String(fallos[0].motivo || '').slice(0, 140)}`
          : conflictos > 0
          ? `${conflictos} conflictos requieren revisión.`
          : sincronizando
          ? `Sincronizando ${pendientes} operación(es)…`
          : `${pendientes} operaciones en cola, esperando envío.`;

        return (
          <aside aria-label="Estado de conexión y sincronización" className={`fixed top-0 left-0 w-full text-white text-center py-2 font-black text-xs md:text-sm z-40 shadow-md flex items-center justify-center gap-2 sm:gap-3 px-3 sm:px-4 ${colorBarra}`}>
            <span>{iconoBarra}</span>
            <span className="truncate max-w-[85vw]">{textoBarra}</span>
            {pendientes > 0 && !esOffline && !g.modoSinConexion && (
              <button onClick={() => g.sincronizarAhora()} className="rounded bg-white/20 hover:bg-white/30 px-2 py-0.5 text-xs font-bold shrink-0 transition-colors">
                Sincronizar
              </button>
            )}
          </aside>
        );
      })()}

      {g.toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-16 sm:top-20 right-3 sm:right-6 z-50 flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 rounded-xl shadow-2xl transition-all max-w-sm sm:max-w-md ${
            g.toast.tipo === 'success' ? 'bg-teal-600 text-white' : g.toast.tipo === 'error' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
          }`}
        >
          <span className="text-xl sm:text-2xl" aria-hidden="true">{g.toast.tipo === 'success' ? '✅' : g.toast.tipo === 'error' ? '❌' : '⚠️'}</span>
          <p className="font-bold text-xs sm:text-sm whitespace-pre-line leading-snug">{g.toast.mensaje}</p>
        </div>
      )}

      <PanelSincronizacion abierta={panelSync} cerrar={() => setPanelSync(false)} gestor={g} />

      {g.confirmDialog.visible && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4 isolate"
          onClick={e => e.target === e.currentTarget && g.cancelarConfirmacion()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-confirmacion"
            ref={refDialogo}
            tabIndex={-1}
            className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl max-w-md w-full text-center"
          >
            <div className="text-4xl sm:text-5xl mb-4" aria-hidden="true">⚠️</div>
            <h3 id="titulo-confirmacion" className="text-lg sm:text-xl font-black text-gray-800 mb-6">{g.confirmDialog.mensaje}</h3>
            <div className="flex gap-3 sm:gap-4 justify-center">
              <button type="button" onClick={() => g.cancelarConfirmacion()} className="flex-1 px-4 py-2.5 sm:py-3 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-xl font-bold transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={() => g.aceptarConfirmacion()} className="flex-1 px-4 py-2.5 sm:py-3 bg-red-600 text-white hover:bg-red-700 rounded-xl font-bold shadow-lg shadow-red-200 transition-colors">
                {g.confirmDialog.textoSi || 'Sí, Continuar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <main id="contenido" className="max-w-[1400px] mx-auto space-y-4 sm:space-y-6">
        
        <div className="flex items-center justify-between gap-2 sm:gap-3 bg-gray-900 text-white rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 shadow-lg">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-gray-400 shrink-0">
              Versión
            </span>
            <code
              className={`text-xs sm:text-sm font-mono font-black px-2 sm:px-2.5 py-0.5 sm:py-1 rounded ${
                typeof __BUILD_ID__ === 'undefined' ? 'bg-red-600 text-white' : 'bg-teal-500 text-white'
              }`}
            >
              {typeof __BUILD_ID__ === 'undefined' ? 'SIN IDENTIFICAR' : __BUILD_ID__}
            </code>
            <span className="text-[11px] sm:text-xs text-gray-400 truncate">
              {textoFechaCompilacion}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (typeof __BUILD_ID__ !== 'undefined') {
                navigator.clipboard?.writeText(String(__BUILD_ID__));
              }
            }}
            title="Copiar el código de versión"
            className="text-xs font-bold text-gray-300 hover:text-white hover:bg-white/10 px-2 py-1 rounded transition-colors shrink-0"
          >
            Copiar
          </button>
        </div>

        <header className="bg-white p-3 sm:p-4 rounded-xl shadow-sm flex flex-col md:flex-row justify-between items-center border border-gray-100 gap-3 sm:gap-4">
          <div className="flex items-center justify-between w-full md:w-auto gap-3">
            <h1 className="font-extrabold text-teal-800 text-xl sm:text-2xl tracking-wider">VER+ ÓPTICA</h1>
            <button
              type="button"
              onClick={() => {
                if (fallos.length > 0 || descartadas > 0 || conflictos > 0) setPanelSync(true);
                else g.sincronizarAhora();
              }}
              title={
                historialParcial
                  ? `Este equipo tiene ${descargas} de ${tope} consultas descargadas.`
                  : fallos.length > 0 || descartadas > 0 || conflictos > 0
                  ? 'Hay operaciones con problemas. Clic para resolverlas.'
                  : `Cola Outbox: ${pendientes} pendiente(s). Clic para sincronizar.`
              }
              className={`flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-full border text-xs font-black shadow-sm transition-colors ${estadoOutbox.clases} ${sincronizando ? 'animate-pulse' : ''}`}
            >
              <span>{estadoOutbox.icono}</span>
              <span className="leading-tight text-left">
                <span className="block">{estadoOutbox.texto}</span>
                <span className="block text-[10px] font-bold opacity-75">{estadoOutbox.detalle}</span>
              </span>
            </button>
          </div>

          {(fallos.length > 0 || descartadas > 0 || conflictos > 0) && (
            <button
              type="button"
              onClick={() => setPanelSync(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-red-300 bg-red-100 text-red-800 text-xs font-black shadow-sm hover:bg-red-200 transition-colors w-full sm:w-auto justify-center"
            >
              <span aria-hidden="true">⚠️</span>
              <span>Resolver problemas ({fallos.length + descartadas + conflictos})</span>
            </button>
          )}

          <nav aria-label="Secciones principales" className="flex flex-wrap sm:flex-nowrap gap-1.5 sm:gap-2 items-center w-full md:w-auto overflow-x-auto pb-1 sm:pb-0">
            <button type="button" onClick={() => g.setVistaActual('historial')} className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all shrink-0 ${g.vistaActual === 'historial' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>📋 Historial</button>
            <button type="button" onClick={() => {g.setVistaActual('nueva_medicion'); g.setEditandoId(null); g.setPaciente(g.estadoInicial);}} className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all shrink-0 ${g.vistaActual === 'nueva_medicion' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>🩺 Clínica</button>
            <button type="button" onClick={() => {g.setVistaActual('pedidos_lista'); g.setPedidoSeleccionado(null);}} className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all shrink-0 ${g.vistaActual.includes('pedido') ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>🛍️ Pedidos</button>
            <button type="button" onClick={() => {g.setVistaActual('inventario'); g.cancelarEdicionInventario();}} className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all shrink-0 ${g.vistaActual === 'inventario' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>👓 Inventario</button>
            <button type="button" onClick={() => g.setVistaActual('precios')} className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all shrink-0 ${g.vistaActual === 'precios' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>🏷️ Tarifario</button>
            <button type="button" onClick={() => g.setVistaActual('dashboard')} className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all shrink-0 ${g.vistaActual === 'dashboard' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>📊 Stats</button>
            
            <div className="border-l-2 border-gray-200 h-6 mx-1 hidden md:block"></div>
            <button type="button" onClick={g.cerrarSesion} className="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-all shrink-0 ml-auto">🚪 Salir</button>
          </nav>
        </header>

        <ErrorBoundary etiqueta={ETIQUETAS[g.vistaActual] || g.vistaActual} clave={g.vistaActual}>
          <Suspense fallback={<Cargando />}>
            {g.vistaActual === 'dashboard' && <Dashboard stats={g.stats} historial={g.historial} inventario={g.inventario} />}
            {g.vistaActual === 'precios' && <Tarifario nuevoPrecio={g.nuevoPrecio} setNuevoPrecio={g.setNuevoPrecio} precioInicial={g.precioInicial} editandoPrecioId={g.editandoPrecioId} setEditandoPrecioId={g.setEditandoPrecioId} manejarCambioPrecio={g.manejarCambioPrecio} guardarPrecio={g.guardarPrecio} busquedaPrecio={g.busquedaPrecio} setBusquedaPrecio={g.setBusquedaPrecio} listaPreciosFiltrada={g.listaPreciosFiltrada} cargarParaEditarPrecio={g.cargarParaEditarPrecio} eliminarPrecio={g.eliminarPrecio} />}
            {g.vistaActual === 'inventario' && <Inventario inventario={g.inventario} nuevoItemInv={g.nuevoItemInv} editandoInvId={g.editandoInvId} cargandoImagen={g.cargandoImagen} manejarCambioInv={g.manejarCambioInv} setImagenSeleccionada={g.setImagenSeleccionada} guardarItemInventario={g.guardarItemInventario} cancelarEdicionInventario={g.cancelarEdicionInventario} cargarParaEditarInventario={g.cargarParaEditarInventario} eliminarItemInventario={g.eliminarItemInventario} />}
            {g.vistaActual === 'historial' && <Historial historialReciente={g.historial} enviarWhatsApp={g.enviarWhatsApp} cargarParaEditarClinico={g.cargarParaEditarClinico} borrarHistoriaClinica={g.borrarHistoriaClinica} abrirPedido={g.abrirPedido} confirmarAccion={g.solicitarConfirmacion} crearNuevoPaciente={() => {g.setVistaActual('nueva_medicion'); g.setEditandoId(null); g.setPaciente(g.estadoInicial);}} />}
            {g.vistaActual === 'nueva_medicion' && <Clinica paciente={g.paciente} setPaciente={g.setPaciente} estadoInicial={g.estadoInicial} editandoId={g.editandoId} setEditandoId={g.setEditandoId} guardarPacienteClinico={g.guardarPacienteClinico} manejarCambio={g.manejarCambio} edadActual={g.edadActual} claseInputRef={g.claseInputRef} historial={g.historial} cedulasArchivadas={g.cedulasArchivadas} guardando={g.guardando} />}
            {g.vistaActual === 'pedidos_lista' && <PedidosLista crearVentaDirecta={g.crearVentaDirecta} busqueda={g.busqueda} setBusqueda={g.setBusqueda} pedidosFiltrados={g.pedidosFiltrados} imprimirRecibo={imprimirRecibo} imprimirOrdenTrabajo={imprimirOrdenTrabajo} cancelarPedido={g.cancelarPedido} abrirPedido={g.abrirPedido} refrescarDatos={g.obtenerDatos} />}
            {g.vistaActual === 'pedidos_form' && g.pedidoSeleccionado && <PedidosForm pedidoSeleccionado={g.pedidoSeleccionado} setPedidoSeleccionado={g.setPedidoSeleccionado} setVistaActual={g.setVistaActual} guardarPedido={g.guardarPedido} manejarCambioPedido={g.manejarCambioPedido} cambiarMedicionPedido={g.cambiarMedicionPedido} medidasPaciente={g.medidasPaciente} inventario={g.inventario} accesorioOriginalId={g.accesorioOriginalId} forzarRecalculo={g.forzarRecalculo} confirmarAccion={g.solicitarConfirmacion} />}
          </Suspense>
        </ErrorBoundary>

      </main>
    </div>
  );
}

export default App;
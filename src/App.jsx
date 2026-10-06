import { useEffect, useState, useRef } from 'react';
import { useGestor } from './useGestor';
import { imprimirOrdenTrabajo, imprimirRecibo } from './impresiones';
import AvisoActualizacion from './AvisoActualizacion';
import PanelSincronizacion from './PanelSincronizacion';
import ErrorBoundary from './ErrorBoundary.jsx';
import { safeString } from './utilidades.js';

// Importaciones estáticas directas para garantizar funcionamiento offline total
import Login from './Login.jsx';
import Historial from './Historial.jsx';
import Clinica from './Clinica.jsx';
import Inventario from './Inventario.jsx';
import Tarifario from './Tarifario.jsx';
import Dashboard from './Dashboard.jsx';
import PedidosLista from './PedidosLista.jsx';
import PedidosForm from './PedidosForm.jsx';

const ETIQUETAS = {
  dashboard: 'Estadísticas',
  precios: 'Tarifario',
  inventario: 'Inventario',
  historial: 'Historial',
  nueva_medicion: 'Clínica',
  pedidos_lista: 'Pedidos',
  pedidos_form: 'Datos del pedido'
};

function App() {
  const g = useGestor(); 

  const [redNavegadorOnline, setRedNavegadorOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setRedNavegadorOnline(true);
    const handleOffline = () => setRedNavegadorOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  const esOffline = !redNavegadorOnline || g.syncEstado?.online === false;
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
    ? { texto: `Descartadas (${descartadas})`, detalle: detalleCola, clases: 'bg-red-100 text-red-800 border-red-300', icono: '🗑' }
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

  // Control del modal de sincronización
  const [panelSync, setPanelSync] = useState(false);
  const [soloProblemasSync, setSoloProblemasSync] = useState(false);

  const dialogoVisible = g.confirmDialog.visible;
  const cancelarConfirmacion = g.cancelarConfirmacion;
  const refDialogo = useRef(null);

  // DETECCIÓN GLOBAL DE BORRADORES MINIMIZADOS:
  const tieneVentaBorrador = Boolean(g.pedidoSeleccionado && g.vistaActual !== 'pedidos_form');
  
  const tieneClinicaBorrador = Boolean(
    g.vistaActual !== 'nueva_medicion' && 
    (safeString(g.paciente?.nombre).trim() !== '' || 
     safeString(g.paciente?.cedula).trim() !== '' || 
     safeString(g.paciente?.esfera_od).trim() !== '')
  );

  const tieneInventarioBorrador = Boolean(
    g.vistaActual !== 'inventario' && 
    (g.editandoInvId !== null || 
     safeString(g.nuevoItemInv?.codigo).trim() !== '' || 
     safeString(g.nuevoItemInv?.nombre_accesorio).trim() !== '')
  );

  const tieneTarifarioBorrador = Boolean(
    g.vistaActual !== 'precios' && 
    (g.editandoPrecioId !== null || safeString(g.nuevoPrecio?.rango_medida).trim() !== '')
  );

  let borradorActivo = null;
  if (tieneVentaBorrador) {
    borradorActivo = {
      tipo: 'Venta / Pedido',
      icono: '🛍️',
      color: 'border-indigo-500',
      badge: 'bg-indigo-100 text-indigo-800',
      descripcion: `Venta de ${safeString(g.pedidoSeleccionado?.nombre || 'Paciente')}`,
      recuperar: () => g.setVistaActual('pedidos_form'),
      descartar: () => g.setPedidoSeleccionado(null)
    };
  } else if (tieneClinicaBorrador) {
    borradorActivo = {
      tipo: 'Consulta Clínica',
      icono: '🩺',
      color: 'border-teal-500',
      badge: 'bg-teal-100 text-teal-800',
      descripcion: `Evaluación de ${safeString(g.paciente?.nombre || g.paciente?.cedula || 'Paciente')}`,
      recuperar: () => g.setVistaActual('nueva_medicion'),
      descartar: () => { g.setPaciente(g.estadoInicial); g.setEditandoId(null); }
    };
  } else if (tieneInventarioBorrador) {
    borradorActivo = {
      tipo: 'Inventario',
      icono: '👓',
      color: 'border-purple-500',
      badge: 'bg-purple-100 text-purple-800',
      descripcion: `Producto ${safeString(g.nuevoItemInv?.codigo || g.nuevoItemInv?.nombre_accesorio || 'en edición')}`,
      recuperar: () => g.setVistaActual('inventario'),
      descartar: () => g.cancelarEdicionInventario()
    };
  } else if (tieneTarifarioBorrador) {
    borradorActivo = {
      tipo: 'Tarifario',
      icono: '🏷️',
      color: 'border-emerald-500',
      badge: 'bg-emerald-100 text-emerald-800',
      descripcion: `Tarifa ${safeString(g.nuevoPrecio?.rango_medida || 'en edición')}`,
      recuperar: () => g.setVistaActual('precios'),
      descartar: () => { g.setNuevoPrecio(g.precioInicial); g.setEditandoPrecioId(null); }
    };
  }

  const mostrarPestanaClinica = g.vistaActual === 'nueva_medicion' || tieneClinicaBorrador;

  useEffect(() => {
    const cerrarConEscape = (e) => {
      if (e.key === 'Escape') cancelarConfirmacion();
    };
    if (dialogoVisible) {
      window.addEventListener('keydown', cerrarConEscape);
      return () => window.removeEventListener('keydown', cerrarConEscape);
    }
  }, [dialogoVisible, cancelarConfirmacion]);

  useEffect(() => {
    if (dialogoVisible) refDialogo.current?.focus();
  }, [dialogoVisible]);

  if (!g.estaAutenticado) {
    return (
      <Login
        dispositivo={g.dispositivo}
        entrarSinConexion={g.entrarSinConexion}
        modoSinConexion={g.modoSinConexion}
      />
    );
  }

  const tieneAvisoSuperior = esOffline || pendientes > 0 || conflictos > 0 || fallos.length > 0 || g.modoSinConexion;

  const textoFechaCompilacion = (() => {
    if (typeof __BUILD_ID__ === 'undefined') return 'Copia en desarrollo';
    try {
      const timestamp = Number.parseInt(__BUILD_ID__, 36);
      if (Number.isFinite(timestamp)) {
        return `Compilada el ${new Date(timestamp).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' })}`;
      }
    } catch {
      /* Silencioso */
    }
    return `Versión (${__BUILD_ID__})`;
  })();

  const totalAtascados = fallos.length + descartadas + conflictos + (esOffline ? 0 : pendientes);

  return (
    <div className={`min-h-screen bg-gray-50 p-3 sm:p-6 relative touch-manipulation ${tieneAvisoSuperior ? 'pt-14 sm:pt-16' : ''}`}>

      <AvisoActualizacion hayTrabajoSinGuardar={pendientes > 0 || g.guardando} confirmar={g.confirmar} />

      {/* 1. Aviso de estado: Cápsula translúcida */}
      {tieneAvisoSuperior && (() => {
        const estiloContenedor = g.modoSinConexion 
          ? 'bg-purple-950/80 border-purple-500/50 text-purple-100 shadow-purple-900/30'
          : esOffline 
          ? 'bg-red-950/80 border-red-500/60 text-white shadow-red-950/40'
          : fallos.length > 0 
          ? 'bg-red-950/85 border-red-500/60 text-white shadow-red-950/40'
          : conflictos > 0 
          ? 'bg-amber-950/80 border-amber-500/60 text-amber-100 shadow-amber-950/40'
          : 'bg-blue-950/80 border-blue-500/50 text-blue-100 shadow-blue-950/40';

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
          <aside aria-label="Estado de conexión y sincronización" className="fixed top-2 left-0 w-full flex justify-center z-50 px-3 pointer-events-none">
            <div className={`pointer-events-auto backdrop-blur-md border rounded-full py-1.5 px-4 sm:px-6 shadow-xl flex items-center justify-center gap-2 sm:gap-3 text-xs md:text-sm font-bold tracking-wide transition-all ${estiloContenedor}`}>
              <span className="text-sm shrink-0">{iconoBarra}</span>
              <span className="truncate max-w-[80vw] text-red-100 font-semibold drop-shadow-xs">
                {textoBarra}
              </span>
              {pendientes > 0 && !esOffline && !g.modoSinConexion && (
                <button onClick={() => g.sincronizarAhora()} className="rounded-full bg-white/20 hover:bg-white/30 text-white px-2.5 py-0.5 text-xs font-bold shrink-0 transition-colors">
                  Sincronizar
                </button>
              )}
            </div>
          </aside>
        );
      })()}

      {/* 2. Etiqueta de versión ultra delgada vertical */}
      <aside 
        aria-label="Información de compilación" 
        className="fixed top-1/2 -translate-y-1/2 left-0 z-30 hidden sm:flex flex-col items-center py-2 px-0.5 bg-gray-900/30 hover:bg-gray-900/90 backdrop-blur-xs text-white rounded-r border-r border-t border-b border-gray-700/40 shadow-xs transition-all duration-300 opacity-40 hover:opacity-100 cursor-pointer group"
        onClick={() => {
          if (typeof __BUILD_ID__ !== 'undefined') {
            navigator.clipboard?.writeText(String(__BUILD_ID__));
          }
        }}
        title={`Versión: ${__BUILD_ID__ || 'DEV'} (${textoFechaCompilacion}). Haz clic para copiar.`}
      >
        <span className="text-[8px] font-mono text-gray-300 [writing-mode:vertical-rl] rotate-180 tracking-widest uppercase py-1 select-none">
          {typeof __BUILD_ID__ === 'undefined' ? 'DEV' : __BUILD_ID__}
        </span>
      </aside>

      {/* Pestaña flotante global para recuperar borrador minimizado */}
      {borradorActivo && (
        <aside
          aria-label="Documento sin guardar minimizado"
          className={`fixed top-16 sm:top-20 right-3 sm:right-6 z-40 bg-white border-2 ${borradorActivo.color} shadow-2xl rounded-xl p-3 sm:p-4 max-w-sm sm:max-w-md transition-all flex items-center justify-between gap-3 text-xs sm:text-sm`}
        >
          <button
            type="button"
            onClick={borradorActivo.recuperar}
            className="flex-1 text-left group cursor-pointer"
            title="Haz clic para volver a abrir el documento"
          >
            <div className="flex items-center gap-1.5 font-black text-gray-900 uppercase tracking-wide">
              <span>{borradorActivo.icono}</span>
              <span className="group-hover:underline">{borradorActivo.tipo} en curso</span>
              <span className={`text-[10px] ${borradorActivo.badge} px-2 py-0.5 rounded-full font-bold ml-1`}>Sin guardar</span>
            </div>
            <p className="text-gray-700 text-xs mt-1 leading-snug">
              Hay cambios en <strong className="text-gray-900">{borradorActivo.descripcion}</strong>. Pulsa aquí para continuar.
            </p>
          </button>
          <button
            type="button"
            onClick={() => {
              g.solicitarConfirmacion(
                `¿Deseas descartar este borrador de ${borradorActivo.tipo}? Los cambios sin guardar se perderán.`,
                borradorActivo.descartar
              );
            }}
            className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors text-base shrink-0"
            title="Descartar borrador"
          >
            🗑️
          </button>
        </aside>
      )}

      {g.toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-20 sm:top-24 right-3 sm:right-6 z-50 flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 rounded-xl shadow-2xl transition-all max-w-sm sm:max-w-md ${
            g.toast.tipo === 'success' ? 'bg-teal-600 text-white' : g.toast.tipo === 'error' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
          }`}
        >
          <span className="text-xl sm:text-2xl" aria-hidden="true">{g.toast.tipo === 'success' ? '✅' : g.toast.tipo === 'error' ? '❌' : '⚠️'}</span>
          <p className="font-bold text-xs sm:text-sm whitespace-pre-line leading-snug">{g.toast.mensaje}</p>
        </div>
      )}

      {/* Modal de sincronización con soporte para modo exclusivo de problemas */}
      <PanelSincronizacion 
        abierta={panelSync} 
        cerrar={() => setPanelSync(false)} 
        gestor={g} 
        soloProblemas={soloProblemasSync} 
      />

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

        <header className="bg-white p-3 sm:p-4 rounded-xl shadow-sm flex flex-col md:flex-row justify-between items-center border border-gray-100 gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center justify-between w-full md:w-auto gap-3">
            <h1 className="font-extrabold text-teal-800 text-xl sm:text-2xl tracking-wider">VER+ ÓPTICA</h1>
            <div className="flex items-center gap-2 shrink-0">
              {/* Botón único de estado de sincronización (se quitó el botón redundante) */}
              <button
                type="button"
                onClick={() => { 
                  setSoloProblemasSync(totalAtascados > 0); 
                  setPanelSync(true); 
                }}
                title={
                  historialParcial
                    ? `Este equipo tiene ${descargas} de ${tope} consultas descargadas.`
                    : 'Abrir el estado de sincronización.'
                }
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-black shadow-sm transition-colors ${estadoOutbox.clases} ${sincronizando ? 'animate-pulse' : ''}`}
              >
                <span>{estadoOutbox.icono}</span>
                <span className="leading-tight text-left">
                  <span className="block">{estadoOutbox.texto}</span>
                  <span className="block text-[10px] font-bold opacity-75">{estadoOutbox.detalle}</span>
                </span>
              </button>
            </div>
          </div>

          {/* Botón directo de resolver problemas cuando existen fallos o elementos atascados */}
          {totalAtascados > 0 && (
            <button
              type="button"
              onClick={() => { setSoloProblemasSync(true); setPanelSync(true); }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-red-300 bg-red-100 text-red-800 text-xs font-black shadow-sm hover:bg-red-200 transition-colors w-full sm:w-auto justify-center"
            >
              <span aria-hidden="true">⚠️</span>
              <span>Resolver problemas ({totalAtascados})</span>
            </button>
          )}

          <nav aria-label="Secciones principales" className="flex flex-wrap sm:flex-nowrap gap-1.5 sm:gap-2 items-center w-full md:w-auto overflow-x-auto pb-1 sm:pb-0">
            <button type="button" onClick={() => g.setVistaActual('historial')} className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all shrink-0 ${g.vistaActual === 'historial' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>📋 Historial</button>
            
            {mostrarPestanaClinica && (
              <button type="button" onClick={() => g.setVistaActual('nueva_medicion')} className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all shrink-0 ${g.vistaActual === 'nueva_medicion' ? 'bg-teal-600 text-white' : 'bg-teal-50 text-teal-800 border border-teal-300 hover:bg-teal-100'}`}>🩺 Clínica</button>
            )}

            <button type="button" onClick={() => g.setVistaActual('pedidos_lista')} className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all shrink-0 ${g.vistaActual.includes('pedido') ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>🛍️ Pedidos</button>
            <button type="button" onClick={() => {g.setVistaActual('inventario'); g.cancelarEdicionInventario();}} className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all shrink-0 ${g.vistaActual === 'inventario' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>👓 Inventario</button>
            <button type="button" onClick={() => g.setVistaActual('precios')} className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all shrink-0 ${g.vistaActual === 'precios' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>🏷️ Tarifario</button>
            <button type="button" onClick={() => g.setVistaActual('dashboard')} className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all shrink-0 ${g.vistaActual === 'dashboard' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>📊 Stats</button>
            
            <div className="border-l-2 border-gray-200 h-6 mx-1 hidden md:block"></div>
            <button type="button" onClick={g.cerrarSesion} className="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-all shrink-0 ml-auto">🚪 Salir</button>
          </nav>
        </header>

        <ErrorBoundary etiqueta={ETIQUETAS[g.vistaActual] || g.vistaActual} clave={g.vistaActual}>
          {g.vistaActual === 'dashboard' && <Dashboard stats={g.stats} historial={g.historial} inventario={g.inventario} />}
          {g.vistaActual === 'precios' && <Tarifario nuevoPrecio={g.nuevoPrecio} setNuevoPrecio={g.setNuevoPrecio} precioInicial={g.precioInicial} editandoPrecioId={g.editandoPrecioId} setEditandoPrecioId={g.setEditandoPrecioId} manejarCambioPrecio={g.manejarCambioPrecio} guardarPrecio={g.guardarPrecio} busquedaPrecio={g.busquedaPrecio} setBusquedaPrecio={g.setBusquedaPrecio} listaPreciosFiltrada={g.listaPreciosFiltrada} cargarParaEditarPrecio={g.cargarParaEditarPrecio} eliminarPrecio={g.eliminarPrecio} />}
          {g.vistaActual === 'inventario' && <Inventario inventario={g.inventario} nuevoItemInv={g.nuevoItemInv} editandoInvId={g.editandoInvId} cargandoImagen={g.cargandoImagen} manejarCambioInv={g.manejarCambioInv} setImagenSeleccionada={g.setImagenSeleccionada} guardarItemInventario={g.guardarItemInventario} cancelarEdicionInventario={g.cancelarEdicionInventario} cargarParaEditarInventario={g.cargarParaEditarInventario} eliminarItemInventario={g.eliminarItemInventario} />}
          {g.vistaActual === 'historial' && (
            <Historial 
              historialReciente={g.historial} 
              enviarWhatsApp={g.enviarWhatsApp} 
              cargarParaEditarClinico={g.cargarParaEditarClinico} 
              iniciarNuevaConsulta={g.iniciarNuevaConsulta} 
              borrarHistoriaClinica={g.borrarHistoriaClinica} 
              archivarConsultaPuntual={g.archivarConsultaPuntual}
              abrirPedido={g.abrirPedido} 
              confirmarAccion={g.solicitarConfirmacion} 
              crearNuevoPaciente={g.crearNuevoPaciente} 
            />
          )}
          {g.vistaActual === 'nueva_medicion' && <Clinica paciente={g.paciente} setPaciente={g.setPaciente} estadoInicial={g.estadoInicial} editandoId={g.editandoId} setEditandoId={g.setEditandoId} guardarPacienteClinico={g.guardarPacienteClinico} manejarCambio={g.manejarCambio} edadActual={g.edadActual} claseInputRef={g.claseInputRef} historial={g.historial} cedulasArchivadas={g.cedulasArchivadas} guardando={g.guardando} />}
          {g.vistaActual === 'pedidos_lista' && <PedidosLista crearVentaDirecta={g.crearVentaDirecta} busqueda={g.busqueda} setBusqueda={g.setBusqueda} pedidosFiltrados={g.pedidosFiltrados} imprimirRecibo={imprimirRecibo} imprimirOrdenTrabajo={imprimirOrdenTrabajo} cancelarPedido={g.cancelarPedido} abrirPedido={g.abrirPedido} refrescarDatos={g.obtenerDatos} />}
          {g.vistaActual === 'pedidos_form' && g.pedidoSeleccionado && <PedidosForm pedidoSeleccionado={g.pedidoSeleccionado} setPedidoSeleccionado={g.setPedidoSeleccionado} setVistaActual={g.setVistaActual} guardarPedido={g.guardarPedido} manejarCambioPedido={g.manejarCambioPedido} cambiarMedicionPedido={g.cambiarMedicionPedido} medidasPaciente={g.medidasPaciente} inventario={g.inventario} accesorioOriginalId={g.accesorioOriginalId} forzarRecalculo={g.forzarRecalculo} confirmarAccion={g.solicitarConfirmacion} />}
        </ErrorBoundary>

      </main>
    </div>
  );
}

export default App;
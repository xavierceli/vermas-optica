import { useEffect, useState, useRef, lazy, Suspense } from 'react'
import { useGestor } from './useGestor'
import { imprimirOrdenTrabajo, imprimirRecibo } from './impresiones'
import AvisoActualizacion from './AvisoActualizacion'
import PanelSincronizacion from './PanelSincronizacion'

// Las vistas se cargan bajo demanda. Antes todas viajaban en el bundle inicial
// (mas de 700 kB) aunque el usuario solo mirara el historial: el telefono
// descargaba clinica, inventario, tarifario y dashboard sin abrirlos nunca.
const Login = lazy(() => import('./Login'));
const Historial = lazy(() => import('./Historial'));
const Clinica = lazy(() => import('./Clinica'));
const Inventario = lazy(() => import('./Inventario'));
const Tarifario = lazy(() => import('./Tarifario'));
const Dashboard = lazy(() => import('./Dashboard'));
const PedidosLista = lazy(() => import('./PedidosLista'));
const PedidosForm = lazy(() => import('./PedidosForm'));

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
  // El detalle del tooltip explica SIEMPRE el motivo. Un numero suelto ("21
  // pendientes") sin decir por que deja al usuario sin ningun siguiente paso.
  const detalleCola = descartadas > 0
    ? `${descartadas} se descartaron; revisa la consola (F12)`
    : fallos.length > 0
    ? String(fallos[0].motivo || '').slice(0, 100)
    : esOffline
    ? (pendientes > 0 ? 'Se subiran al recuperar conexion' : 'Todo guardado aqui')
    : 'En cola de salida';
  const estadoOutbox = sesionInvalida
    ? { texto: 'Sesion expirada', detalle: 'Vuelve a iniciar sesion', clases: 'bg-red-100 text-red-800 border-red-300', icono: '🔑' }
    : fallos.length > 0
    ? { texto: `Rechazadas (${fallos.length})`, detalle: detalleCola, clases: 'bg-red-100 text-red-800 border-red-300', icono: '⛔' }
    : descartadas > 0
    ? { texto: `Descartadas (${descartadas})`, detalle: detalleCola, clases: 'bg-red-100 text-red-800 border-red-300', icono: '🗑️' }
    : hayErrorSync
    ? { texto: 'Error al sincronizar', detalle: String(g.syncEstado.lastError).slice(0, 90), clases: 'bg-red-100 text-red-800 border-red-300', icono: '⛔' }
    : conflictos > 0
      ? { texto: 'Conflictos', detalle: `${conflictos} por revisar`, clases: 'bg-amber-100 text-amber-800 border-amber-300', icono: '⚠️' }
      : esOffline
        ? { texto: 'Sin conexion', detalle: detalleCola, clases: 'bg-slate-800 text-slate-100 border-slate-600', icono: '📴' }
        : sincronizando
          ? { texto: 'Sincronizando...', detalle: pendientes > 0 ? `Pendientes: ${pendientes}` : 'Enviando a la nube', clases: 'bg-blue-100 text-blue-800 border-blue-300', icono: '🔄' }
          : pendientes > 0
            ? { texto: `Pendientes: ${pendientes}`, detalle: detalleCola, clases: 'bg-blue-100 text-blue-800 border-blue-300', icono: '⏳' }
            : { texto: 'Sincronizado', detalle: 'Nube al dia', clases: 'bg-emerald-100 text-emerald-800 border-emerald-300', icono: '✅' };
  // La barra de sincronizacion abre este panel cuando hay algo atascado.
  // Antes resolverlo exigia abrir la consola del navegador.
  const [panelSync, setPanelSync] = useState(false);
  const dialogoVisible = g.confirmDialog.visible;
  const setDialogoConfirmacion = g.setConfirmDialog;
  const refDialogo = useRef(null);

  // Cerrar el diálogo de confirmación con la tecla Escape
  useEffect(() => {
    const cerrarConEscape = (e) => {
      if (e.key === 'Escape') setDialogoConfirmacion({ visible: false });
    };
    if (dialogoVisible) {
      window.addEventListener('keydown', cerrarConEscape);
      return () => window.removeEventListener('keydown', cerrarConEscape);
    }
  }, [dialogoVisible, setDialogoConfirmacion]);

  // Al abrir, el foco entra en el diálogo. Sin esto el teclado sigue en el body y
  // un usuario de lector de pantalla no se entera de que hay una pregunta
  // esperándole (WCAG 2.4.3 Foco en orden).
  useEffect(() => {
    if (dialogoVisible) refDialogo.current?.focus();
  }, [dialogoVisible]);

  // Si no está autenticado, mostramos el login de inmediato (evita quedarse congelado cargando)
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

  return (
    // El atributo translate="no" se elimino de aqui: no es un prop de React, es
    // un atributo global de HTML. La regla equivalente vive ahora en index.css
    // (input, textarea), que es donde realmente se necesita: que el teclado
    // movil no capitalice los datos medidos de la clinica.
    <div className={`min-h-screen bg-gray-50 p-6 relative ${esOffline || pendientes > 0 ? 'pt-14' : ''}`}>

      {/* Con registerType:'prompt' el service worker espera. Este aviso es quien
          activa el cambio, y solo cuando el usuario lo decide. */}
      <AvisoActualizacion hayTrabajoSinGuardar={pendientes > 0 || g.guardando} />

      {(esOffline || pendientes > 0 || conflictos > 0 || fallos.length > 0 || g.modoSinConexion) && (
        <div className={`fixed top-0 left-0 w-full text-white text-center py-2 font-black text-xs md:text-sm z-[200] shadow-md flex items-center justify-center gap-3 px-4 ${g.modoSinConexion ? 'bg-purple-800' : fallos.length > 0 ? 'bg-red-700' : conflictos > 0 ? 'bg-amber-600' : esOffline ? 'bg-slate-800' : 'bg-blue-700'}`}>
          <span>{g.modoSinConexion ? '🔓' : fallos.length > 0 ? '⛔' : conflictos > 0 ? '⚠️' : esOffline ? '📴' : '🔄'}</span>
          <span>{g.modoSinConexion
            ? 'Modo sin conexión: entraste con el PIN local. Los cambios se guardan aquí y se subirán al volver a iniciar sesión.'
            : fallos.length > 0
            ? `El servidor rechazó ${fallos.length} operación(es): ${String(fallos[0].motivo || '').slice(0, 160)}`
            : conflictos > 0 ? `${conflictos} conflictos requieren revisión.`
            : sincronizando ? `Sincronizando ${pendientes} operación(es)…`
            : esOffline ? 'Modo local: los datos se guardan en este dispositivo.'
            : `${pendientes} operaciones en cola, esperando el próximo intento.`}</span>
          {pendientes > 0 && !esOffline && !g.modoSinConexion && <button onClick={() => g.sincronizarAhora()} className="rounded bg-white/20 px-2 py-1">Sincronizar ahora</button>}
        </div>
      )}
      {g.toast && (
        // role="status" + aria-live: sin esto el lector de pantalla no anuncia
        // el resultado de la accion. Es el unico canal para confirmar que el
        // guardado funciono cuando no se ve el mensaje.
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-20 right-6 z-[300] flex items-center gap-3 px-6 py-4 rounded-xl shadow-2xl transition-all max-w-md ${
          g.toast.tipo === 'success' ? 'bg-teal-600 text-white' : g.toast.tipo === 'error' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
        }`}
        >
          <span className="text-2xl" aria-hidden="true">{g.toast.tipo === 'success' ? '✅' : g.toast.tipo === 'error' ? '❌' : '⚠️'}</span>
          <p className="font-bold text-sm whitespace-pre-line leading-snug">{g.toast.mensaje}</p>
        </div>
      )}

      <PanelSincronizacion abierta={panelSync} cerrar={() => setPanelSync(false)} gestor={g} />

      {g.confirmDialog.visible && (
        // Clic en el fondo oscuro cierra: solo si el destino es el propio fondo,
        // no el panel, para que un clic dentro no lo cierre por error.
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] px-4"
          onClick={e => e.target === e.currentTarget && g.setConfirmDialog({ visible: false })}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-confirmacion"
            ref={refDialogo}
            tabIndex={-1}
            className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full text-center"
          >
            <div className="text-5xl mb-4" aria-hidden="true">⚠️</div>
            <h3 id="titulo-confirmacion" className="text-xl font-black text-gray-800 mb-6">{g.confirmDialog.mensaje}</h3>
            <div className="flex gap-4 justify-center">
              <button onClick={() => g.setConfirmDialog({visible: false})} className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-xl font-bold transition-colors">Cancelar</button>
              <button onClick={() => { g.confirmDialog.onConfirm(); g.setConfirmDialog({visible: false}); }} className="flex-1 px-4 py-3 bg-red-600 text-white hover:bg-red-700 rounded-xl font-bold shadow-lg shadow-red-200 transition-colors">Sí, Continuar</button>
            </div>
          </div>
        </div>
      )}

      {/* id="contenido": destino del enlace de salto de index.html. Permite
          al usuario de teclado saltarse la barra de navegacion. */}
      <main id="contenido" className="max-w-[1400px] mx-auto space-y-6">
        {/* VERSION DESPLEGADA
            Este bloque era un texto de 9px casi invisible y era la unica forma
            de saber si el navegador esta sirviendo el bundle nuevo o uno viejo
            desde la cache del service worker. Sin eso, "no funciona" y "esta
            cargando la version anterior" son indistinguibles.
            Ahora es clicable, muestra la fecha de compilacion y, si el
            identificador no llego (bundle viejo servido), lo avisa en rojo. */}
        <div className="flex items-center justify-between gap-3 bg-gray-900 text-white rounded-xl px-4 py-2.5 shadow-lg">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-black uppercase tracking-wider text-gray-400 shrink-0">
              Version desplegada
            </span>
            <code
              className={`text-sm font-mono font-black px-2.5 py-1 rounded ${
                typeof __BUILD_ID__ === 'undefined'
                  ? 'bg-red-600 text-white'
                  : 'bg-teal-500 text-white'
              }`}
            >
              {typeof __BUILD_ID__ === 'undefined' ? 'SIN IDENTIFICAR (bundle viejo)' : __BUILD_ID__}
            </code>
            <span className="text-xs text-gray-400 truncate">
              {typeof __BUILD_ID__ === 'undefined'
                ? 'El navegador esta sirviendo una copia antigua. Recarga con Ctrl+Shift+R.'
                : `Compilada el ${new Date(Number.parseInt(__BUILD_ID__, 36)).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' })}`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(String(__BUILD_ID__))}
            title="Copiar el codigo de version"
            className="text-xs font-bold text-gray-300 hover:text-white hover:bg-white/10 px-2 py-1 rounded transition-colors shrink-0"
          >
            Copiar
          </button>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm flex flex-col md:flex-row justify-between items-center border gap-4">
          <div className="flex items-center gap-3">
            <h1 className="font-extrabold text-teal-800 text-2xl tracking-wider">VER+ ÓPTICA</h1>
            <button
              type="button"
              onClick={() => {
                // Si hay algo atascado, el clic abre el panel con el detalle y las
                // acciones. Antes había que abrir la consola del navegador, lo
                // cual dejaba al usuario sin salida si no era desarrollador.
                if (fallos.length > 0 || descartadas > 0 || conflictos > 0) setPanelSync(true);
                else g.sincronizarAhora();
              }}
              title={
                fallos.length > 0 || descartadas > 0 || conflictos > 0
                  ? 'Hay operaciones con problemas. Clic para verlas y resolverlas.'
                  : `Cola Outbox: ${pendientes} pendiente(s). Clic para sincronizar ahora.`
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
          {/* Aviso explicito: si hay atascos, no hay que deducir que la barra
              de arriba es clicable. */}
          {(fallos.length > 0 || descartadas > 0 || conflictos > 0) && (
            <button
              type="button"
              onClick={() => setPanelSync(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-red-300 bg-red-100 text-red-800 text-xs font-black shadow-sm hover:bg-red-200 transition-colors"
            >
              <span aria-hidden="true">⚠️</span>
              <span>Resolver problemas ({fallos.length + descartadas + conflictos})</span>
            </button>
          )}
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

        <Suspense fallback={<Cargando />}>

        {g.vistaActual === 'dashboard' && <Dashboard stats={g.stats} historial={g.historial} inventario={g.inventario} />}
        {g.vistaActual === 'precios' && <Tarifario nuevoPrecio={g.nuevoPrecio} setNuevoPrecio={g.setNuevoPrecio} precioInicial={g.precioInicial} editandoPrecioId={g.editandoPrecioId} setEditandoPrecioId={g.setEditandoPrecioId} manejarCambioPrecio={g.manejarCambioPrecio} guardarPrecio={g.guardarPrecio} busquedaPrecio={g.busquedaPrecio} setBusquedaPrecio={g.setBusquedaPrecio} listaPreciosFiltrada={g.listaPreciosFiltrada} cargarParaEditarPrecio={g.cargarParaEditarPrecio} eliminarPrecio={g.eliminarPrecio} />}
        {g.vistaActual === 'inventario' && <Inventario inventario={g.inventario} nuevoItemInv={g.nuevoItemInv} editandoInvId={g.editandoInvId} cargandoImagen={g.cargandoImagen} manejarCambioInv={g.manejarCambioInv} setImagenSeleccionada={g.setImagenSeleccionada} guardarItemInventario={g.guardarItemInventario} cancelarEdicionInventario={g.cancelarEdicionInventario} cargarParaEditarInventario={g.cargarParaEditarInventario} eliminarItemInventario={g.eliminarItemInventario} />}
        {g.vistaActual === 'historial' && <Historial historialReciente={g.historial} enviarWhatsApp={g.enviarWhatsApp} cargarParaEditarClinico={g.cargarParaEditarClinico} borrarHistoriaClinica={g.borrarHistoriaClinica} abrirPedido={g.abrirPedido} crearNuevoPaciente={() => {g.setVistaActual('nueva_medicion'); g.setEditandoId(null); g.setPaciente(g.estadoInicial)}} />}
        {g.vistaActual === 'nueva_medicion' && <Clinica paciente={g.paciente} setPaciente={g.setPaciente} estadoInicial={g.estadoInicial} editandoId={g.editandoId} setEditandoId={g.setEditandoId} guardarPacienteClinico={g.guardarPacienteClinico} manejarCambio={g.manejarCambio} edadActual={g.edadActual} claseInputRef={g.claseInputRef} historial={g.historial} guardando={g.guardando} />}
        {g.vistaActual === 'pedidos_lista' && <PedidosLista crearVentaDirecta={g.crearVentaDirecta} busqueda={g.busqueda} setBusqueda={g.setBusqueda} pedidosFiltrados={g.pedidosFiltrados} imprimirRecibo={imprimirRecibo} imprimirOrdenTrabajo={imprimirOrdenTrabajo} cancelarPedido={g.cancelarPedido} abrirPedido={g.abrirPedido} refrescarDatos={g.obtenerDatos} />}
        {g.vistaActual === 'pedidos_form' && g.pedidoSeleccionado && <PedidosForm pedidoSeleccionado={g.pedidoSeleccionado} setPedidoSeleccionado={g.setPedidoSeleccionado} setVistaActual={g.setVistaActual} guardarPedido={g.guardarPedido} manejarCambioPedido={g.manejarCambioPedido} cambiarMedicionPedido={g.cambiarMedicionPedido} medidasPaciente={g.medidasPaciente} inventario={g.inventario} accesorioOriginalId={g.accesorioOriginalId} forzarRecalculo={g.forzarRecalculo} confirmarAccion={g.solicitarConfirmacion} />}
        </Suspense>

      </main>
    </div>
  )
}

export default App

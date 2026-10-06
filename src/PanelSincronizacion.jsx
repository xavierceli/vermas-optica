// ---------------------------------------------------------------------------
// PANEL DE SINCRONIZACION Y RESOLUCION DE PROBLEMAS
// ---------------------------------------------------------------------------
import { useState, useEffect, useCallback, useRef } from 'react';
import RespaldoDatos from './RespaldoDatos.jsx';

const TIPOS = {
  GUARDAR_CONSULTA: 'Consulta clínica', CREAR_VENTA: 'Venta', EDITAR_VENTA: 'Edición de venta',
  REGISTRAR_PAGO: 'Cobro', REEMBOLSAR_PAGO: 'Devolución de dinero',
  CAMBIAR_ESTADO_VENTA: 'Cambio de estado', ANULAR_VENTA: 'Anulación de venta',
  UPSERT_INVENTARIO: 'Producto de inventario', ELIMINAR_INVENTARIO: 'Baja de producto',
  UPSERT_PRECIO: 'Tarifa', ELIMINAR_PRECIO: 'Baja de tarifa',
  ARCHIVAR_CONSULTA: 'Archivo de consulta', SUBIR_ADJUNTO: 'Comprobante o foto'
};

const ESTADOS = {
  pending: { txt: 'En espera / Cola', cls: 'bg-blue-100 text-blue-800', borde: 'border-l-blue-400' },
  failed: { txt: 'Rechazada / Error', cls: 'bg-red-100 text-red-800', borde: 'border-l-red-500' },
  conflict: { txt: 'En conflicto', cls: 'bg-amber-100 text-amber-800', borde: 'border-l-amber-400' },
  descartada: { txt: 'Descartada', cls: 'bg-gray-200 text-gray-600', borde: 'border-l-gray-300' }
};

export default function PanelSincronizacion({ abierta, cerrar, gestor, soloProblemas = false }) {
  const [ops, setOps] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [errorPanel, setErrorPanel] = useState('');
  const ref = useRef(null);

  const cargar = useCallback(async () => {
    if (!gestor?.obtenerDetalleCola) return;
    setCargando(true);
    try {
      setOps(await gestor.obtenerDetalleCola());
      setErrorPanel('');
    } catch {
      setErrorPanel('No se pudo consultar la cola de sincronización. Inténtalo de nuevo.');
    } finally {
      setCargando(false);
    }
  }, [gestor]);

  useEffect(() => {
    if (!abierta) return;
    void Promise.resolve().then(cargar);
    ref.current?.focus();
  }, [abierta, cargar]);

  useEffect(() => {
    if (!abierta) return;
    const esc = e => { if (e.key === 'Escape') cerrar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [abierta, cerrar]);

  if (!abierta) return null;

  // En modo problemas mostramos todo lo que está pendiente o con fallos
  const itemsAMostrar = soloProblemas 
    ? ops.filter(o => o.estado !== 'descartada') 
    : ops;
  const problemas = ops.filter(o => o.estado !== 'pending' && o.estado !== 'descartada');

  const reintentar = async op => {
    setTrabajando(true);
    setErrorPanel('');
    try {
      await gestor.reintentarOperacion(op.id);
      await cargar();
    } catch {
      setErrorPanel('No se pudo reintentar el cambio. Sigue guardado en el dispositivo.');
    } finally {
      setTrabajando(false);
    }
  };

  const descartar = async op => {
    setTrabajando(true);
    setErrorPanel('');
    try {
      await gestor.descartarOperacion(op.id);
      await cargar();
    } catch {
      setErrorPanel('No se pudo quitar el cambio de la cola. No se borraron sus datos.');
    } finally {
      setTrabajando(false);
    }
  };

  const descartarTodo = async () => {
    const totalDescartar = itemsAMostrar.length;
    const ok = typeof gestor?.confirmar === 'function'
      ? await gestor.confirmar(
        `Se quitarán ${totalDescartar} operaciones de la cola.\n\nNO se borra ningún paciente, venta ni producto: esos cambios simplemente no se enviarán al servidor.`,
        'Descartar todo'
      )
      : false;
    if (!ok) return;

    setTrabajando(true);
    setErrorPanel('');
    try {
      if (typeof gestor?.descartarTodoLoAtascado === 'function') {
        await gestor.descartarTodoLoAtascado();
      } else {
        for (const op of itemsAMostrar) {
          await gestor.descartarOperacion(op.id);
        }
      }
      await cargar();
    } catch {
      setErrorPanel('No se pudieron quitar los cambios de la cola. No se borraron sus datos.');
    } finally {
      setTrabajando(false);
    }
  };

  const sincronizar = async () => {
    if (typeof gestor?.sincronizarAhora !== 'function') return;
    setTrabajando(true);
    setErrorPanel('');
    try {
      await gestor.sincronizarAhora();
      await cargar();
    } catch {
      setErrorPanel('No se pudo sincronizar ahora. Los cambios siguen guardados localmente.');
    } finally {
      setTrabajando(false);
    }
  };

  const estadoSync = gestor?.syncEstado || {};
  const ultimaSync = estadoSync.lastSync && Number.isFinite(Date.parse(estadoSync.lastSync))
    ? new Date(estadoSync.lastSync).toLocaleString('es-EC')
    : null;

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[150] p-4"
      onClick={e => e.target === e.currentTarget && cerrar()}
    >
      <div 
        role="dialog" 
        aria-modal="true" 
        aria-labelledby="titulo-sync" 
        ref={ref} 
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b bg-gray-50">
          <div>
            <h2 id="titulo-sync" className="text-lg font-black text-gray-800 flex items-center gap-2">
              {soloProblemas ? '⚠️ Resolver problemas de sincronización' : 'Estado de sincronización'}
            </h2>
            <p className="text-xs text-gray-600 mt-1" aria-live="polite">
              {estadoSync.online === false
                ? 'Sin conexión: los cambios están seguros en este equipo.'
                : 'Con conexión a internet.'}
              {estadoSync.phase === 'syncing' ? ' Sincronizando ahora…' : ''}
              {ultimaSync ? ` Última sincronización: ${ultimaSync}.` : ''}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {itemsAMostrar.length === 0 
                ? 'No hay operaciones pendientes ni bloqueadas.'
                : `${itemsAMostrar.length} elemento(s) en lista - ${problemas.length} con advertencia o error`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button 
              type="button" 
              onClick={sincronizar}
              disabled={trabajando || estadoSync.online === false || estadoSync.phase === 'syncing'}
              className="text-xs font-bold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {estadoSync.phase === 'syncing' ? 'Sincronizando…' : 'Reintentar todo'}
            </button>
            <button 
              type="button" 
              onClick={cerrar} 
              aria-label="Cerrar"
              className="text-gray-500 hover:text-gray-800 text-2xl leading-none px-2 py-1 rounded hover:bg-gray-100 transition-colors"
            >
              &times;
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {errorPanel && (
            <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
              {errorPanel}
            </p>
          )}
          {cargando && <p className="text-sm text-gray-500 text-center py-4">Consultando cola…</p>}
          
          {!cargando && itemsAMostrar.length === 0 && (
            <div className="text-center py-10">
              <span className="text-4xl block mb-2">✅</span>
              <p className="text-sm font-bold text-gray-700">Todo está al día.</p>
              <p className="text-xs text-gray-500 mt-1">No hay operaciones pendientes ni rechazadas.</p>
            </div>
          )}

          {!cargando && itemsAMostrar.length > 0 && (
            <ul className="space-y-3">
              {itemsAMostrar.map(op => {
                const e = ESTADOS[op.estado] || ESTADOS.pending;
                return (
                  <li key={op.id} className={`border-l-4 ${e.borde} bg-gray-50 rounded-r-lg p-3.5 border border-gray-100 shadow-xs`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-gray-800">{TIPOS[op.tipo] || op.tipo}</span>
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${e.cls}`}>{e.txt}</span>
                          {op.intentos > 0 && (
                            <span className="text-[10px] text-gray-500 font-semibold">
                              {op.intentos} {op.intentos === 1 ? 'intento' : 'intentos'}
                            </span>
                          )}
                        </div>
                        {op.motivo && (
                          <p className="text-xs text-red-700 bg-red-50/60 p-1.5 rounded mt-1.5 border border-red-100 break-words font-medium">
                            <span className="font-bold">Causa: </span>{op.motivo}
                          </p>
                        )}
                        <p className="text-[10px] text-gray-400 mt-1">
                          Registrado: {new Date(op.creada).toLocaleString('es-EC')}
                        </p>
                      </div>

                      {/* Las 2 opciones individuales claras para cada registro */}
                      <div className="flex gap-2 shrink-0 items-center">
                        <button 
                          type="button" 
                          disabled={trabajando} 
                          onClick={() => reintentar(op)}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-xs"
                          title="Volver a intentar subir al servidor"
                        >
                          🔄 Reintentar
                        </button>
                        <button 
                          type="button" 
                          disabled={trabajando} 
                          onClick={() => descartar(op)}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg bg-gray-200 text-gray-700 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 transition-colors"
                          title="Quitar de la cola de subida"
                        >
                          🗑️ Descartar
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Solo mostramos la sección de respaldo si NO se abrió en modo de resolver problemas */}
        {!soloProblemas && <RespaldoDatos />}

        {itemsAMostrar.length > 0 && (
          <div className="p-4 border-t bg-gray-50 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <p className="text-xs text-gray-600 leading-tight">
              <strong className="font-bold">Descartar</strong> retira los elementos de la cola. Tus pacientes y ventas locales no se borran.
            </p>
            <button 
              type="button" 
              disabled={trabajando} 
              onClick={descartarTodo}
              className="text-xs font-bold px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors shrink-0"
            >
              Descartar todo ({itemsAMostrar.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
// ---------------------------------------------------------------------------
// PANEL DE SINCRONIZACION Y RESOLUCION DE PROBLEMAS
// ---------------------------------------------------------------------------
import { useState, useEffect, useCallback, useRef } from 'react';
import RespaldoDatos from './RespaldoDatos.jsx';
import AccesoSinConexion from './AccesoSinConexion.jsx';
import { resumenTiempoReal } from './tiempoRealResumen.js';
import { CATEGORIAS_CONFLICTO, resumirConflictos } from './conflictos.js';

const CATEGORIAS_PANEL = ['version_clinica', 'stock', 'version_venta', 'otro'];

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
  const [resumenConflictos, setResumenConflictos] = useState(null);
  const ref = useRef(null);

  const cargar = useCallback(async () => {
    if (!gestor?.obtenerDetalleCola) return;
    setCargando(true);
    try {
      const [detalle, resumen] = await Promise.all([
        gestor.obtenerDetalleCola(),
        typeof gestor.obtenerResumenConflictos === 'function'
          ? gestor.obtenerResumenConflictos().catch(() => null)
          : Promise.resolve(null)
      ]);
      setOps(detalle);
      setResumenConflictos(resumen);
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

  // Si el gestor no expone el registro histórico (o aún no hay eventos), se
  // resume lo que sí está en la cola: nunca se oculta un conflicto activo.
  const conflictosEnCola = ops
    .filter(o => o.estado === 'conflict')
    .map(o => ({ motivo: o.motivo, tipoOperacion: o.tipo }));
  const resumenVisible = resumenConflictos?.total > 0
    ? resumenConflictos
    : { ...resumirConflictos(conflictosEnCola), equipo: null, activos: conflictosEnCola.length };
  const totalConflictos = resumenVisible.total || 0;

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

  // Tiempo real: aviso discreto solo si lleva caido de verdad. El sondeo de
  // 30 s sigue trayendo los cambios, asi que no es una alarma.
  const avisoTiempoReal = resumenTiempoReal({
    estado: gestor?.tiempoReal?.estado,
    caidoMs: gestor?.tiempoReal?.caidoMs,
    online: estadoSync.online !== false
  });

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
                ? (gestor?.modoSinConexion
                  ? 'Sin sesión: los cambios están seguros en este equipo y subirán al iniciar sesión.'
                  : 'Sin conexión: los cambios están seguros en este equipo.')
                : 'Con conexión a internet.'}
              {estadoSync.phase === 'syncing' ? ' Sincronizando ahora…' : ''}
              {ultimaSync ? ` Última sincronización: ${ultimaSync}.` : ''}
            </p>
            {estadoSync.almacenamiento && (
              <p
                className={`text-xs mt-1 font-bold ${estadoSync.almacenamiento.porcentaje >= 80 ? 'text-amber-800' : 'text-gray-500'}`}
              >
                Almacenamiento del equipo: {estadoSync.almacenamiento.porcentaje} % usado
                {estadoSync.almacenamiento.porcentaje >= 80
                  ? ' — libera espacio en Respaldo y espacio.'
                  : '.'}
              </p>
            )}
            {avisoTiempoReal.nivel !== 'oculto' && (
              <p
                role="status"
                aria-live="polite"
                className={`text-xs mt-1 font-semibold ${
                  avisoTiempoReal.nivel === 'aviso'
                    ? 'text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1'
                    : avisoTiempoReal.nivel === 'ok'
                      ? 'text-green-700'
                      : 'text-gray-500'
                }`}
              >
                {avisoTiempoReal.mensaje}
              </p>
            )}
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

          {!cargando && totalConflictos > 0 && (
            <section
              aria-labelledby="titulo-conflictos"
              className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="titulo-conflictos" className="text-sm font-black text-amber-900">
                  Resumen de conflictos
                </h3>
                <span className="text-[11px] font-bold text-amber-800">
                  {resumenVisible.activos > 0
                    ? `${resumenVisible.activos} activo(s) en la cola`
                    : 'Ninguno activo ahora'}
                  {' · '}{totalConflictos} registrado(s)
                </span>
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2.5">
                {CATEGORIAS_PANEL.map(clave => {
                  const categoria = CATEGORIAS_CONFLICTO[clave];
                  const cantidad = resumenVisible.porCategoria?.[clave] || 0;
                  return (
                    <div key={clave} data-testid={`conflicto-${clave}`} className="rounded-lg bg-white/80 border border-amber-100 px-2.5 py-2">
                      <dt className="text-[10px] font-bold text-gray-600 uppercase tracking-wide">
                        <span aria-hidden="true">{categoria.icono} </span>{categoria.etiqueta}
                      </dt>
                      <dd className={`text-lg font-black ${cantidad > 0 ? 'text-amber-900' : 'text-gray-400'}`}>
                        {cantidad}
                      </dd>
                    </div>
                  );
                })}
              </dl>

              <p className="text-[10px] text-gray-500 mt-1.5">
                Conteo de los conflictos registrados; los que siguen activos están incluidos.
              </p>

              {resumenVisible.equipo && (
                <p className="text-[11px] text-gray-700 mt-2 break-words">
                  <span className="font-bold">Equipo: </span>{resumenVisible.equipo.etiqueta}
                  <span className="font-mono text-gray-500" title={resumenVisible.equipo.id}>
                    {' '}#{String(resumenVisible.equipo.id || '').slice(0, 8)}
                  </span>
                  {resumenVisible.equipo.usuario ? ` · ${resumenVisible.equipo.usuario}` : ''}
                </p>
              )}

              {resumenVisible.porEquipo?.length > 1 && (
                <ul className="text-[11px] text-gray-700 mt-1 space-y-0.5">
                  {resumenVisible.porEquipo.map(equipo => (
                    <li key={equipo.equipoId}>
                      {equipo.equipo}: <strong>{equipo.total}</strong>
                      {equipo.usuario ? ` (${equipo.usuario})` : ''}
                    </li>
                  ))}
                </ul>
              )}

              {resumenVisible.ultimo && Number.isFinite(Date.parse(resumenVisible.ultimo)) && (
                <p className="text-[10px] text-gray-500 mt-1.5">
                  Último conflicto: {new Date(resumenVisible.ultimo).toLocaleString('es-EC')}
                  {' · '}se conservan 90 días en este equipo
                </p>
              )}
            </section>
          )}
          
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
                        <p className="text-[10px] text-gray-500 mt-1">
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

          {/* Va dentro del area que se desplaza (y no fija abajo) para no robarle
              alto a la lista de la cola en pantallas bajas. */}
          {!soloProblemas && <AccesoSinConexion gestor={gestor} />}
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
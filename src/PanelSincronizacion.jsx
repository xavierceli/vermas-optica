// ---------------------------------------------------------------------------
// PANEL DE SINCRONIZACION
// ---------------------------------------------------------------------------
// Cuando el servidor rechaza una operacion por una causa permanente, la barra
// superior se queda en rojo y el usuario no puede hacer nada. Antes la unica
// salida era abrir la consola del navegador y ejecutar un script, lo cual no es
// una interfaz: quien no supiera de desarrollo quedaba bloqueado para siempre.
//
// Aqui se resuelve desde la app: se ve QUE se atasco y POR QUE, y hay botones
// para reintentar o descartar. Descartar solo quita el comando de la cola; NO
// borra pacientes, ventas ni inventario.
import { useState, useEffect, useCallback, useRef } from 'react';
import RespaldoDatos from './RespaldoDatos.jsx';

const TIPOS = {
  GUARDAR_CONSULTA: 'Consulta clinica', CREAR_VENTA: 'Venta', EDITAR_VENTA: 'Edicion de venta',
  REGISTRAR_PAGO: 'Cobro', REEMBOLSAR_PAGO: 'Devolucion de dinero',
  CAMBIAR_ESTADO_VENTA: 'Cambio de estado', ANULAR_VENTA: 'Anulacion de venta',
  UPSERT_INVENTARIO: 'Producto de inventario', ELIMINAR_INVENTARIO: 'Baja de producto',
  UPSERT_PRECIO: 'Tarifa', ELIMINAR_PRECIO: 'Baja de tarifa',
  ARCHIVAR_CONSULTA: 'Archivo de consulta', SUBIR_ADJUNTO: 'Comprobante o foto'
};

const ESTADOS = {
  pending: { txt: 'En cola', cls: 'bg-blue-100 text-blue-800', borde: 'border-l-blue-400' },
  failed: { txt: 'Rechazada', cls: 'bg-red-100 text-red-800', borde: 'border-l-red-500' },
  conflict: { txt: 'En conflicto', cls: 'bg-amber-100 text-amber-800', borde: 'border-l-amber-400' },
  descartada: { txt: 'Descartada', cls: 'bg-gray-200 text-gray-600', borde: 'border-l-gray-300' }
};

export default function PanelSincronizacion({ abierta, cerrar, gestor }) {
  const [ops, setOps] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const ref = useRef(null);

  const cargar = useCallback(async () => {
    if (!gestor?.obtenerDetalleCola) return;
    setCargando(true);
    try { setOps(await gestor.obtenerDetalleCola()); } finally { setCargando(false); }
  }, [gestor]);

  useEffect(() => {
    if (!abierta) return;
    // La carga se dispara sin setState sincronico en el efecto.
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
  const problemas = ops.filter(o => o.estado !== 'pending');

  const reintentar = async op => { setTrabajando(true); try { await gestor.reintentarOperacion(op.id); await cargar(); } finally { setTrabajando(false); } };
  const descartar = async op => { setTrabajando(true); try { await gestor.descartarOperacion(op.id); await cargar(); } finally { setTrabajarFinal(); } };
  const setTrabajarFinal = () => {};

  const descartarTodo = async () => {
    const ok = window.confirm(
      `Se quitaran ${problemas.length} operaciones de la cola.\n\n` +
      'NO se borra ningun paciente, venta ni producto: esos cambios simplemente no se enviaran al servidor.\n\n' +
      'Continuar?'
    );
    if (!ok) return;
    setTrabajando(true);
    try { await gestor.descartarTodoLoAtascado(); await cargar(); } finally { setTrabajando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[150] p-4"
         onClick={e => e.target === e.currentTarget && cerrar()}>
      <div role="dialog" aria-modal="true" aria-labelledby="titulo-sync" ref={ref} tabIndex={-1}
           className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 p-5 border-b bg-gray-50">
          <div>
            <h2 id="titulo-sync" className="text-lg font-black text-gray-800">Estado de sincronizacion</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {ops.length === 0 ? 'No hay nada en la cola.'
                : `${ops.length} en la cola - ${problemas.length} con problemas`}
            </p>
          </div>
          <button type="button" onClick={cerrar} aria-label="Cerrar"
                  className="text-gray-500 hover:text-gray-800 text-2xl leading-none px-2 py-1 rounded hover:bg-gray-100 transition-colors">
            <span aria-hidden="true">x</span>
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {cargando && <p className="text-sm text-gray-500">Cargando...</p>}
          {!cargando && ops.length === 0 && (
            <p className="text-sm text-gray-600 text-center py-8">Todo esta sincronizado. No hay nada pendiente.</p>
          )}
          {!cargando && ops.length > 0 && (
            <ul className="space-y-3">
              {ops.map(op => {
                const e = ESTADOS[op.estado] || ESTADOS.pending;
                const esProblema = op.estado !== 'pending';
                return (
                  <li key={op.id} className={`border-l-4 ${e.borde} bg-gray-50 rounded-r-lg p-3`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-gray-800">{TIPOS[op.tipo] || op.tipo}</span>
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${e.cls}`}>{e.txt}</span>
                          {op.intentos > 0 && (
                            <span className="text-[10px] text-gray-500">{op.intentos} {op.intentos === 1 ? 'intento' : 'intentos'}</span>
                          )}
                        </div>
                        {op.motivo && (
                          <p className="text-xs text-gray-600 mt-1.5 break-words">
                            <span className="font-bold">Motivo: </span>{op.motivo}
                          </p>
                        )}
                        <p className="text-[10px] text-gray-400 mt-1">{new Date(op.creada).toLocaleString('es-EC')}</p>
                      </div>
                      {esProblema && (
                        <div className="flex gap-2 shrink-0">
                          <button type="button" disabled={trabajando} onClick={() => reintentar(op)}
                                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                            Reintentar
                          </button>
                          <button type="button" disabled={trabajando} onClick={() => descartar(op)}
                                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 transition-colors">
                            Descartar
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* El respaldo va siempre, no solo cuando hay atascos: la cola puede
            estar vacia y aun asi este dispositivo ser la unica copia de la
            semana sin conexion. */}
        <RespaldoDatos />

        {problemas.length > 0 && (
          <div className="p-4 border-t bg-gray-50 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <p className="text-xs text-gray-600">
              <strong className="font-bold">Descartar</strong> quita el cambio de la cola. No borra pacientes, ventas ni productos.
            </p>
            <button type="button" disabled={trabajando} onClick={descartarTodo}
                    className="text-xs font-bold px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors shrink-0">
              Descartar todo ({problemas.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
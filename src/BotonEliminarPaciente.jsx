import { useState } from 'react';
import {
  contarRegistrosPaciente, contarComprobantesCopia, traducirErrorEliminacion
} from './eliminacionPaciente';

const normalizar = valor => String(valor ?? '').replace(/[^0-9A-Za-z]/g, '').toLowerCase();
const dinero = valor => '$' + (Number(valor) || 0).toFixed(2).replace('.', ',');
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Boton de papelera + ventana de confirmacion del borrado definitivo de un paciente.
 * Si no hay conexion a internet, previene la accion y muestra un aviso informativo claro.
 */
export default function BotonEliminarPaciente({ item, onEliminar }) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [resumen, setResumen] = useState(null);
  const [error, setError] = useState('');
  const [escrita, setEscrita] = useState('');
  const [descargarCopia, setDescargarCopia] = useState(true);
  const [comprobantes, setComprobantes] = useState(null);
  const [ejecutando, setEjecutando] = useState(false);

  const nombre = String(item?.nombre ?? '').trim() || 'ESTE PACIENTE';
  const cedula = String(item?.cedula ?? '').trim();
  const cedulaCoincide = normalizar(escrita) !== '' && normalizar(escrita) === normalizar(cedula);
  const estaOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const abrir = async () => {
    setAbierto(true);
    setError('');
    setEscrita('');
    setDescargarCopia(true);
    setComprobantes(null);
    setResumen(null);

    // Bloqueo preventivo en offline (Opción A)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setCargando(false);
      return;
    }

    setCargando(true);
    try {
      setResumen(await contarRegistrosPaciente(cedula));
      try {
        setComprobantes(await contarComprobantesCopia(cedula));
      } catch {
        setComprobantes(null);
      }
    } catch (err) {
      setError(traducirErrorEliminacion(err));
    } finally {
      setCargando(false);
    }
  };

  const cerrar = () => {
    if (ejecutando) return;
    setAbierto(false);
  };

  const confirmar = async () => {
    if (estaOffline || !cedulaCoincide || ejecutando || cargando || error) return;
    setEjecutando(true);
    try {
      const borrado = await onEliminar(item, { descargarCopia });
      if (borrado) setAbierto(false);
    } finally {
      setEjecutando(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="text-xs sm:text-sm bg-red-50 text-red-700 border border-red-200 px-2.5 py-1.5 rounded-lg font-bold shadow-sm hover:bg-red-100 transition-colors"
        title="Eliminar definitivamente todo el paciente y sus ventas"
        aria-label={`Eliminar definitivamente a ${nombre}`}
      >
        🗑️
      </button>

      {abierto && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4 isolate"
          onClick={e => e.target === e.currentTarget && cerrar()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-eliminar-paciente"
            className="bg-white p-5 sm:p-8 rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto text-left"
          >
            <div className="text-4xl mb-3 text-center" aria-hidden="true">
              {estaOffline ? '📴' : '⚠️'}
            </div>
            <h3 id="titulo-eliminar-paciente" className="text-lg sm:text-xl font-black text-gray-800 mb-4 text-center">
              ¿ELIMINAR DEFINITIVAMENTE A {nombre}?
            </h3>

            {estaOffline ? (
              <div role="status" className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-4 mb-5 text-sm space-y-2">
                <p className="font-bold flex items-center gap-1.5">
                  <span>🔒</span> Función no disponible sin conexión a internet
                </p>
                <p className="text-xs text-amber-800 leading-relaxed">
                  Para eliminar definitivamente un expediente se requiere conexión activa con el servidor. Esto garantiza la descarga completa de la copia de respaldo y la eliminación física segura de las consultas, pagos y fotos en la nube.
                </p>
                <p className="text-xs font-semibold text-amber-950 pt-1">
                  Reconecta el equipo a internet para poder realizar esta acción.
                </p>
              </div>
            ) : (
              <>
                {cargando && <p className="text-sm text-gray-600 text-center mb-4">Calculando qué se va a borrar…</p>}

                {error && (
                  <p role="alert" className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                    {error}
                  </p>
                )}

                {resumen && resumen.encontrado === false && (
                  <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                    Este paciente no aparece en el servidor (puede que ya se haya eliminado). Si continúas,
                    solo se limpiará la copia guardada en este equipo.
                  </p>
                )}

                {resumen && resumen.encontrado !== false && (
                  <div className="text-sm text-gray-800 mb-4">
                    <p className="font-bold mb-2">Se borrará para siempre:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>La ficha del paciente y sus antecedentes</li>
                      <li>{plural(Number(resumen.consultas) || 0, 'consulta clínica', 'consultas clínicas')} con todas sus versiones anteriores</li>
                      <li>{plural(Number(resumen.ventas) || 0, 'venta / pedido', 'ventas / pedidos')}</li>
                      <li>
                        {plural(Number(resumen.cobros) || 0, 'cobro', 'cobros')} ({dinero(resumen.monto_cobrado)})
                        {' y '}
                        {plural(Number(resumen.reembolsos) || 0, 'reembolso', 'reembolsos')} ({dinero(resumen.monto_reembolsado)})
                      </li>
                      <li>Los comprobantes de pago guardados</li>
                    </ul>
                    <p className="mt-3 text-xs text-gray-600">
                      Los productos de las ventas que aún no se entregaron vuelven al inventario. Los de ventas
                      ya entregadas no.
                    </p>
                  </div>
                )}

                <p className="text-xs font-bold text-red-700 mb-4">
                  Esta acción NO se puede deshacer y no existe un respaldo del servidor.
                </p>

                <label className="flex items-start gap-2 text-sm text-gray-800 mb-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={descargarCopia}
                    onChange={e => setDescargarCopia(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    Descargar una copia de este paciente antes de borrar (guárdala en un lugar privado).
                    {comprobantes !== null && comprobantes > 0 && (
                      <span className="block mt-1 text-xs text-gray-700">
                        Tu copia incluirá{' '}
                        <strong>{plural(comprobantes, 'comprobante de pago', 'comprobantes de pago')}</strong>,{' '}
                        guardados dentro del mismo archivo.
                      </span>
                    )}
                    {comprobantes === 0 && (
                      <span className="block mt-1 text-xs text-amber-800">
                        ⚠️ No hay comprobantes guardados en este equipo. Si ya se subieron al servidor, esta copia{' '}
                        <strong>no</strong> los incluirá y no quedará copia de ellos.
                      </span>
                    )}
                  </span>
                </label>

                <label htmlFor="confirmar-cedula-eliminar" className="block text-sm font-bold text-gray-800 mb-1">
                  Para confirmar, escribe la cédula: <span className="font-mono">{cedula}</span>
                </label>
                <input
                  id="confirmar-cedula-eliminar"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  value={escrita}
                  onChange={e => setEscrita(e.target.value)}
                  disabled={ejecutando}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-5 font-mono outline-none focus:ring-2 focus:ring-red-500"
                />
              </>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={cerrar}
                disabled={ejecutando}
                className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-xl font-bold transition-colors disabled:opacity-50"
              >
                {estaOffline ? 'Cerrar' : 'Cancelar'}
              </button>
              {!estaOffline && (
                <button
                  type="button"
                  onClick={confirmar}
                  disabled={!cedulaCoincide || ejecutando || cargando || Boolean(error)}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white hover:bg-red-700 rounded-xl font-bold shadow-lg shadow-red-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {ejecutando ? 'Eliminando…' : 'Eliminar definitivamente'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
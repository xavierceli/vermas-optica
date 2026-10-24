// ---------------------------------------------------------------------------
// VISTA DE TARJETAS DE PACIENTES (LISTA PRINCIPAL)
// ---------------------------------------------------------------------------
// La pantalla de inicio del Historial: buscador y una tarjeta por paciente con
// su ultima visita. La tarjeta vive en TarjetaPaciente.jsx (memoizada): aqui
// solo queda el mapa. Este componente tambien va envuelto en memo, y para que
// sirva Historial le pasa callbacks estables (useCallback) y filasVisibles ya
// memoizado (si el slice creara un array nuevo en cada render, la comparacion
// fallaria siempre).
// ---------------------------------------------------------------------------
import { memo } from 'react';
import { safeString } from '../utilidades.js';
import TarjetaPaciente from './TarjetaPaciente.jsx';

function ListaTarjetas({
  busquedaTexto,
  setBusquedaTexto,
  hayTermino,
  pacientesAgrupados = [],
  filasPorMostrar,
  filasVisibles = [],
  visibles,
  setVisibles,
  incremento,
  buscando,
  aliasVisibles,
  toggleAlias,
  abrirExpedienteCompleto,
  cargarParaEditarClinico,
  iniciarNuevaConsulta,
  abrirPedido,
  enviarWhatsApp,
  manejarBorradoCompleto,
  crearNuevoPaciente,
  confirmarAccion,
  esAdmin = false
}) {
  return (
    <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 border-t-4 border-blue-600">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Resumen e Historia de Pacientes</h2>
          <p className="text-xs text-gray-600">Búsqueda rápida. Muestra la última visita de cada paciente.</p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (typeof crearNuevoPaciente === 'function') {
              crearNuevoPaciente(busquedaTexto.trim());
            }
          }}
          className="w-full sm:w-auto bg-teal-700 hover:bg-teal-800 text-white px-5 py-2.5 rounded-lg font-bold shadow-md transition-colors flex items-center justify-center gap-2"
        >
          ➕ Registrar Nuevo Paciente
        </button>
      </div>

      <div className="flex gap-2 sm:gap-3 mb-6">
        <input
          type="text"
          placeholder="🔍 Escribe mínimo 2 letras de Cédula, Nombre o Alias..."
          value={busquedaTexto}
          onChange={(e) => { setVisibles(50); setBusquedaTexto(e.target.value); }}
          aria-label="Buscar paciente por cédula, nombre o alias"

          className="flex-1 p-2.5 sm:p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 shadow-sm text-sm font-medium bg-gray-50 focus:bg-white text-gray-900"
        />
        {buscando && hayTermino && (
          <div className="flex items-center text-xs font-bold text-blue-700 px-2 shrink-0 animate-pulse">
            Buscando en la nube... ☁️
          </div>
        )}
      </div>

      <div className="space-y-4 sm:space-y-6">
        {filasVisibles.map(item => (
          <TarjetaPaciente
            key={safeString(item?.id) || safeString(item?.cedula) || 'paciente-sin-id'}
            item={item}
            aliasVisible={Boolean(aliasVisibles?.[safeString(item?.id) || safeString(item?.cedula) || 'paciente-sin-id'])}
            toggleAlias={toggleAlias}
            abrirExpedienteCompleto={abrirExpedienteCompleto}
            cargarParaEditarClinico={cargarParaEditarClinico}
            iniciarNuevaConsulta={iniciarNuevaConsulta}
            abrirPedido={abrirPedido}
            enviarWhatsApp={enviarWhatsApp}
            manejarBorradoCompleto={manejarBorradoCompleto}
            confirmarAccion={confirmarAccion}
            esAdmin={esAdmin}
          />
        ))}

        {pacientesAgrupados.length > filasPorMostrar && (
          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => setVisibles(v => v + incremento)}
              className="px-6 py-2.5 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md transition-colors text-sm"
            >
              Ver más ({pacientesAgrupados.length - visibles} restantes)
            </button>
            <p className="text-xs text-gray-500 font-medium mt-2">
              Mostrando {visibles} de {pacientesAgrupados.length}. Usa el buscador para encontrar un paciente específico.
            </p>
          </div>
        )}

        {pacientesAgrupados.length === 0 && (
          <div className="text-center bg-white p-8 sm:p-12 rounded-xl border border-dashed border-gray-300">
            <p className="text-gray-700 font-bold text-base sm:text-lg mb-2">
              {buscando
                ? "Buscando coincidencias en el servidor..."
                : busquedaTexto.trim().length >= 2
                ? "No se encontraron pacientes coincidentes."
                : "Escribe en el buscador para localizar un paciente."}
            </p>
            {busquedaTexto.trim().length >= 2 && !buscando && (
              <button
                type="button"
                onClick={() => {
                  if (typeof crearNuevoPaciente === 'function') {
                    crearNuevoPaciente(busquedaTexto.trim());
                  }
                }}
                className="mt-3 bg-teal-700 text-white px-6 py-2.5 rounded-lg font-bold shadow-md hover:bg-teal-800 transition-colors text-sm"
              >
                ➕ Registrar como Nuevo Paciente
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ListaTarjetas);

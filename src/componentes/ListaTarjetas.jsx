// ---------------------------------------------------------------------------
// VISTA DE TARJETAS DE PACIENTES (LISTA PRINCIPAL)
// ---------------------------------------------------------------------------
// La pantalla de inicio del Historial: buscador y una tarjeta por paciente con
// su ultima visita. Antes vivia dentro de Historial.jsx (mas de 700 lineas).
// Aqui solo se pinta: la busqueda, la paginacion y las acciones las resuelve
// Historial.jsx, que le pasa los datos ya calculados como props.
// ---------------------------------------------------------------------------
import { safeString, safeNum, calcularEdad, calcularTiempoTranscurrido } from '../utilidades.js';
import { generarDiagnosticos, resumenConsulta } from '../historial.js';
import { imprimirInforme, imprimirRecetaSimple } from '../impresiones.js';
import BotonComprobante from '../BotonComprobante.jsx';
import BotonEliminarPaciente from '../BotonEliminarPaciente.jsx';

export default function ListaTarjetas({
  busquedaTexto,
  setBusquedaTexto,
  hayTermino,
  pacientesAgrupados,
  filasPorMostrar,
  filasVisibles,
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
  crearNuevoPaciente
}) {
  return (
  <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 border-t-4 border-blue-600">
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Resumen e Historia de Pacientes</h2>
        <p className="text-xs text-gray-600">Búsqueda rápida. Muestra la última visita de cada paciente.</p>
      </div>
      
      <button type="button" onClick={crearNuevoPaciente} className="w-full sm:w-auto bg-teal-600 hover:bg-teal-700 text-white px-5 py-2.5 rounded-lg font-bold shadow-md transition-colors flex items-center justify-center gap-2">
        ➕ Registrar Nuevo Paciente
      </button>
    </div>

    <div className="flex gap-2 sm:gap-3 mb-6">
      <input 
        type="text" 
        placeholder="🔍 Escribe mínimo 2 letras de Cédula, Nombre o Alias..." 
        value={busquedaTexto} 
        onChange={(e) => { setVisibles(50); setBusquedaTexto(e.target.value); }}
        className="flex-1 p-2.5 sm:p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 shadow-sm text-sm font-medium bg-gray-50 focus:bg-white text-gray-900" 
      />
      {buscando && hayTermino && <div className="flex items-center text-xs font-bold text-blue-700 px-2 shrink-0">Buscando... ☁️</div>}
    </div>

    <div className="space-y-4 sm:space-y-6">
      {filasVisibles.map(item => {
        try {
          const claveItem = safeString(item?.id) || safeString(item?.cedula) || 'paciente-sin-id';
          const diagnosticos = generarDiagnosticos(item);
          const { saldo: saldoPendiente, tieneDeuda, tienePedido, total: vFinal, descuento: desc } = resumenConsulta(item);
          const esAnulado = safeString(item.estado).trim().toLowerCase() === 'anulado';
          
          return (
            <div key={claveItem} className="border border-gray-200 bg-white p-4 sm:p-6 rounded-2xl shadow-sm hover:shadow-md transition-all">
              
              <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center border-b border-gray-100 pb-4 mb-4 gap-3">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="bg-blue-100 text-blue-800 p-2.5 sm:p-3 rounded-full hidden sm:block text-lg">👤</div>
                  <div>
                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                      <h3 className="font-extrabold text-lg sm:text-xl text-gray-900">{safeString(item.nombre) || 'Sin Nombre'}</h3>
                      {tieneDeuda && (
                        <span className="bg-red-100 text-red-800 px-2.5 py-0.5 rounded-full text-[11px] font-black border border-red-300 shadow-sm animate-pulse flex items-center gap-1">
                          ⚠️ SALDO PENDIENTE: ${saldoPendiente.toFixed(2)}
                        </span>
                      )}
                    </div>
                    
                    {safeString(item.alias) && (
                      <div className="mt-1 flex items-center">
                        <button 
                          type="button" 
                          onClick={() => toggleAlias(claveItem)}
                          className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold transition-all shadow-sm border ${aliasVisibles[claveItem] ? 'bg-teal-50 text-teal-800 border-teal-300' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-teal-50 hover:text-teal-700'}`}
                          title="Clic para ver u ocultar Alias"
                        >
                          🏷️ {aliasVisibles[claveItem] ? safeString(item.alias) : 'Alias'}
                        </button>
                      </div>
                    )}
                    
                    <p className="text-xs sm:text-sm text-gray-700 font-semibold mt-1 flex flex-wrap gap-2 sm:gap-4">
                      {item.cedula && <span>🆔 {safeString(item.cedula)}</span>}
                      {item.telefono && <span>📱 {safeString(item.telefono)}</span>}
                      {item.fecha_nacimiento && <span>🎂 {calcularEdad(item.fecha_nacimiento)} años</span>}
                    </p>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-1.5 sm:gap-2 w-full xl:w-auto items-center">
                  <button 
                    type="button" 
                    onClick={() => {
                      if (typeof iniciarNuevaConsulta === 'function') {
                        iniciarNuevaConsulta(item);
                      } else {
                        cargarParaEditarClinico(item);
                      }
                    }} 
                    className="text-xs sm:text-sm bg-teal-50 text-teal-800 border border-teal-300 px-3 py-1.5 rounded-lg font-bold shadow-sm hover:bg-teal-100 transition-colors flex items-center gap-1"
                    title="Registrar una nueva evaluación clínica a este paciente"
                  >
                    ➕ Nueva Consulta
                  </button>
                  <button type="button" onClick={() => abrirExpedienteCompleto(item)} className="text-xs sm:text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg font-bold shadow-sm hover:bg-indigo-100 transition-colors flex items-center gap-1">
                    🗂️ Ver Evolución
                  </button>
                  <button type="button" onClick={() => enviarWhatsApp(item)} className="text-xs sm:text-sm bg-green-600 text-white px-3 py-1.5 rounded-lg font-semibold shadow-sm hover:bg-green-700 transition-colors">
                    💬 WhatsApp
                  </button>
                  
                  <div className="flex border border-gray-300 rounded-lg overflow-hidden shadow-sm">
                    <button type="button" onClick={() => imprimirInforme(item)} className="text-xs sm:text-sm bg-gray-100 text-gray-800 px-2.5 sm:px-3 py-1.5 font-semibold hover:bg-gray-200 transition-colors">
                      📄 Informe
                    </button>
                    <button type="button" onClick={() => imprimirRecetaSimple(item)} className="text-xs sm:text-sm bg-gray-100 text-gray-800 px-2.5 sm:px-3 py-1.5 font-semibold border-l border-gray-300 hover:bg-gray-200 transition-colors">
                      📝 Receta
                    </button>
                  </div>
                  
                  <button type="button" onClick={() => cargarParaEditarClinico(item)} className="text-xs sm:text-sm bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1.5 rounded-lg font-bold shadow-sm hover:bg-blue-100 transition-colors" title="Editar / Corregir esta consulta">
                    ✏️
                  </button>
                  <BotonEliminarPaciente item={item} onEliminar={manejarBorradoCompleto} />
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                <div className="bg-gray-50 p-3 sm:p-4 rounded-xl border border-gray-100 shadow-inner">
                  <div className="flex justify-between items-center mb-2.5">
                    <strong className="text-blue-900 text-sm sm:text-base font-extrabold">Última RX Clínica</strong>
                    <span className="text-[11px] sm:text-xs text-gray-700 font-bold bg-white px-2 py-0.5 rounded border border-gray-200">
                      📅 {safeString(item.fecha_receta || item.fecha)}{item.fecha_receta && item.fecha_receta !== item.fecha ? ` (receta del ${safeString(item.fecha_receta)})` : ` (${calcularTiempoTranscurrido(item.fecha_receta || item.fecha)})`}
                    </span>
                  </div>
                  <table className="w-full text-center text-xs sm:text-sm bg-white rounded border border-gray-200 overflow-hidden">
                    <thead className="bg-blue-50/70 text-gray-800">
                      <tr><th className="p-1.5 border-b border-r"></th><th className="p-1.5 border-b border-r">Esf.</th><th className="p-1.5 border-b border-r">Cil.</th><th className="p-1.5 border-b border-r">Eje</th><th className="p-1.5 border-b">Adi.</th></tr>
                    </thead>
                    <tbody>
                      <tr><td className="p-1.5 border-b border-r font-bold text-gray-800">OD</td><td className="p-1.5 border-b border-r font-semibold text-gray-900">{safeString(item.esfera_od) || '—'}</td><td className="p-1.5 border-b border-r font-semibold text-gray-900">{safeString(item.cilindro_od) || '—'}</td><td className="p-1.5 border-b border-r font-semibold text-gray-900">{safeString(item.eje_od) || '—'}</td><td className="p-1.5 border-b font-semibold text-gray-900">{safeString(item.adicion_od) || '—'}</td></tr>
                      <tr><td className="p-1.5 border-r font-bold text-gray-800">OI</td><td className="p-1.5 border-r font-semibold text-gray-900">{safeString(item.esfera_oi) || '—'}</td><td className="p-1.5 border-r font-semibold text-gray-900">{safeString(item.cilindro_oi) || '—'}</td><td className="p-1.5 border-r font-semibold text-gray-900">{safeString(item.eje_oi) || '—'}</td><td className="p-1.5 font-semibold text-gray-900">{safeString(item.adicion_oi) || '—'}</td></tr>
                    </tbody>
                  </table>
                  <div className="mt-3 flex flex-wrap gap-1.5 sm:gap-2">
                    {diagnosticos.map((d, i) => (
                      <span key={i} className="bg-teal-50 text-teal-800 border border-teal-200 px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wide shadow-sm">
                        {d}
                      </span>
                    ))}
                  </div>
                </div>

                <div className={`p-3 sm:p-4 rounded-xl border shadow-inner flex flex-col justify-between transition-colors ${tieneDeuda ? 'bg-red-50/40 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <strong className="text-gray-900 text-sm sm:text-base font-extrabold block">Último Detalle Comercial / Pedido</strong>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow-sm ${item.estado === 'Entregado' ? 'bg-green-100 text-green-900' : item.estado === 'Listo para Entrega' ? 'bg-blue-100 text-blue-900' : esAnulado ? 'bg-red-100 text-red-900' : 'bg-yellow-100 text-yellow-900'}`}>
                        {safeString(item.estado) || 'Sin estado'}
                      </span>
                    </div>

                    {tienePedido ? (
                      <div className="space-y-1.5 text-xs text-gray-800">
                        <div className="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm space-y-1">
                          <p>
                            <strong className="text-indigo-900">👓 Armazón:</strong>{' '}
                            <span className="font-semibold text-gray-900">
                              {safeString(item.codigo_armazon) === '2905' ? 'Del Paciente' : (safeString(item.codigo_armazon) || 'No registrado')}
                            </span>
                          </p>
                          
                          {(item.tipo_lente || item.material_lente) && (
                            <p>
                              <strong className="text-indigo-900">🔍 Lente:</strong>{' '}
                              <span className="font-semibold text-gray-900">
                                {safeString(item.tipo_lente) || 'Estándar'} {safeString(item.material_lente) ? `(${safeString(item.material_lente)})` : ''}
                              </span>
                            </p>
                          )}

                          {Boolean(item.tratam_ar === 'SI' || item.tratam_ar_azul === 'SI' || item.tratam_azul === 'SI' || item.tratam_foto === 'SI' || item.tratam_trans === 'SI' || item.tratam_tinturado === 'SI') && (
                            <p className="text-[11px] text-teal-800 font-bold">
                              ✨ Tratamientos:{' '}
                              {[
                                item.tratam_ar === 'SI' && 'Antirreflejo Verde',
                                item.tratam_ar_azul === 'SI' && 'Antirreflejo Azul',
                                item.tratam_azul === 'SI' && 'Filtro Azul',
                                item.tratam_foto === 'SI' && 'Fotocromático',
                                item.tratam_trans === 'SI' && 'Transition',
                                item.tratam_tinturado === 'SI' && 'Tinturado'
                              ].filter(Boolean).join(' • ')}
                            </p>
                          )}

                          {item.accesorio_id && (
                            <p className="text-[11px] text-purple-800 font-semibold">
                              👜 Accesorio incluido
                            </p>
                          )}
                        </div>

                        {(() => {
                          // Extracción limpia y sin duplicados de métodos de pago
                          const metodosSet = new Set();
                          const inicial = safeString(item.forma_pago).trim();
                          if (inicial) metodosSet.add(inicial);

                          const notaCompleta = safeString(item.pago_nota);
                          const regexAbonos = /\+\s*\$?\s*[\d.]+\s+(Efectivo|Transferencia|Tarjeta)/gi;
                          let match;
                          while ((match = regexAbonos.exec(notaCompleta)) !== null) {
                            const metodoDetectado = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
                            metodosSet.add(metodoDetectado);
                          }

                          if (item.comprobante_url && !Array.from(metodosSet).some(m => m.toLowerCase().includes('transferencia'))) {
                            metodosSet.add('Transferencia');
                          }

                          const metodosReales = Array.from(metodosSet);
                          if (metodosReales.length === 0) metodosReales.push('Efectivo');

                          return (
                            <div className="pt-1 text-[11px]">
                              <div className="text-gray-700 flex items-center gap-1.5 flex-wrap">
                                <strong>Método(s) de pago:</strong>
                                <div className="inline-flex items-center gap-1.5 flex-wrap">
                                  {metodosReales.map((metodo, idx) => (
                                    <span key={idx} className="inline-flex items-center font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                                      {metodo}
                                    </span>
                                  ))}
                                  
                                  {/* Un solo botón de comprobante limpio por pedido si existe voucher */}
                                  {item.comprobante_url && (
                                    <BotonComprobante
                                      ruta={item.comprobante_url}
                                      refId={safeString(item.pedido_id) || claveItem}
                                      texto="Ver Comprobante 📄"
                                      className="font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-0.5 rounded border border-indigo-300 shadow-sm cursor-pointer transition-colors"
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {item.notas && (
                          <p className="text-[11px] text-gray-600 italic">
                            📝 Notas: {safeString(item.notas)}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-xs sm:text-sm font-semibold py-4">No hay pedido registrado en esta fecha.</p>
                    )}
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between items-end">
                    <div>
                      {tienePedido ? (
                        <>
                          <span className={`block text-[11px] uppercase font-black tracking-wider mb-0.5 ${tieneDeuda ? 'text-red-700' : 'text-gray-600'}`}>
                            {esAnulado ? 'Venta Anulada' : tieneDeuda ? '⚠ Costo Final (Con Saldo Pendiente)' : 'Costo Final'}
                          </span>
                          <div className="flex items-baseline gap-2">
                            <span className={`text-base sm:text-xl font-black ${esAnulado ? 'line-through text-gray-400' : tieneDeuda ? 'text-red-600 animate-pulse' : 'text-gray-900'}`}>
                              ${esAnulado ? safeNum(item.venta).toFixed(2) : vFinal.toFixed(2)}
                            </span>
                            {!esAnulado && desc > 0 && <span className="text-xs text-green-700 font-bold">(-{desc}%)</span>}
                            {tieneDeuda && (
                              <span className="text-xs font-black text-red-700 bg-red-100 px-2 py-0.5 rounded border border-red-300">
                                A pagar: ${saldoPendiente.toFixed(2)}
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Sin venta asociada</span>
                      )}
                    </div>

                    <button 
                      type="button" 
                      onClick={() => abrirPedido(item)} 
                      className={`text-xs px-3.5 py-1.5 rounded-lg font-bold transition-all shadow-sm flex items-center gap-1.5 ${
                        !tienePedido
                          ? 'bg-teal-600 hover:bg-teal-700 text-white active:scale-95'
                          : esAnulado
                          ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                          : tieneDeuda 
                          ? 'bg-red-600 hover:bg-red-700 text-white' 
                          : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200'
                      }`}
                    >
                      {tienePedido ? '👁️ Ver Venta' : '➕ Crear Venta'}
                    </button>
                  </div>
                </div>

              </div>
            </div>
          );
        } catch {
          return <div key={item?.id || item?.cedula || 'paciente-error'} className="bg-red-50 p-4 rounded-xl text-red-700 font-bold border border-red-200 mb-4">Error visual al cargar paciente.</div>;
        }
      })}

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
            {busquedaTexto.trim().length >= 2 ? "No se encontraron pacientes coincidentes." : "Escribe en el buscador para localizar un paciente."}
          </p>
          {busquedaTexto.trim().length >= 2 && (
            <button type="button" onClick={crearNuevoPaciente} className="mt-3 bg-teal-600 text-white px-6 py-2.5 rounded-lg font-bold shadow-md hover:bg-teal-700 transition-colors text-sm">
              ➕ Registrar como Nuevo Paciente
            </button>
          )}
        </div>
      )}
    </div>
  </div>
  );
}

// ---------------------------------------------------------------------------
// TARJETA DE UN PACIENTE (item de la lista principal del Historial)
// ---------------------------------------------------------------------------
// Extraida de ListaTarjetas y envuelta en memo: la lista puede llevar decenas
// de tarjetas con tablas clinicas, y antes cada latido del estado global de la
// app (un toast, un cambio de fase del sync) re-renderizaba las cincuenta.
// Para que el memo sirva, TODO lo que recibe debe ser estable entre renders:
// los callbacks vienen estabilizados con useCallback desde Historial/useGestor
// y el alias se pasa como booleano (no como el mapa completo, que cambia cada
// vez que se despliega un alias y romperia la comparacion de las demas).
// ---------------------------------------------------------------------------
import { memo } from 'react';
import { safeString, calcularEdad, calcularTiempoTranscurrido } from '../utilidades.js';
import { generarDiagnosticos, resumenConsulta } from '../historial.js';
import { imprimirInforme, imprimirRecetaSimple } from '../impresiones.js';
import BotonComprobante from '../BotonComprobante.jsx';
import BotonEliminarPaciente from '../BotonEliminarPaciente.jsx';

function TarjetaPaciente({
  item,
  aliasVisible = false,
  toggleAlias,
  abrirExpedienteCompleto,
  cargarParaEditarClinico,
  iniciarNuevaConsulta,
  abrirPedido,
  enviarWhatsApp,
  manejarBorradoCompleto,
  confirmarAccion,
  esAdmin = false
}) {
  const prepararNuevaVenta = (itemActual) => {
    const itemParaNuevaVenta = {
      ...itemActual,
      pedido_id: '',
      estado: 'En laboratorio',
      venta: '',
      abono: '0',
      descuento: '0',
      codigo_armazon: '',
      tipo_lente: '',
      accesorio_id: '',
      _nueva_venta: true
    };
    abrirPedido(itemParaNuevaVenta);
  };

  // El try/catch protege SOLO el calculo de datos derivados (funciones puras
  // que pueden lanzar con un dato corrupto): el JSX va fuera, porque un try
  // alrededor del render no atraparia nada (para eso existe ErrorBoundary, que
  // envuelve la vista en App). Asi una ficha corrupta degrada su tarjeta, no
  // toda la pantalla.
  let datos;
  try {
    datos = {
      diagnosticos: generarDiagnosticos(item),
      resumen: resumenConsulta(item),
      edad: item?.fecha_nacimiento ? calcularEdad(item.fecha_nacimiento) : null,
      tiempo: calcularTiempoTranscurrido(item?.fecha_receta || item?.fecha)
    };
  } catch {
    return <div key={item?.id || item?.cedula || 'paciente-error'} className="bg-red-50 p-4 rounded-xl text-red-700 font-bold border border-red-200 mb-4">Error visual al cargar paciente.</div>;
  }
  const { saldo: saldoPendiente, tieneDeuda, tienePedido, total: vFinal, descuento: desc } = datos.resumen;
  const { diagnosticos } = datos;
  const claveItem = safeString(item?.id) || safeString(item?.cedula) || 'paciente-sin-id';
  const esAnulado = safeString(item?.estado).trim().toLowerCase() === 'anulado';
  const tieneDeudaReal = tieneDeuda && !esAnulado;

  return (
      <div className="border border-gray-200 bg-white p-4 sm:p-6 rounded-2xl shadow-sm hover:shadow-md transition-all">

        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center border-b border-gray-100 pb-4 mb-4 gap-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="bg-blue-100 text-blue-800 p-2.5 sm:p-3 rounded-full hidden sm:block text-lg">👤</div>
            <div>
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <h3 className="font-extrabold text-lg sm:text-xl text-gray-900">{safeString(item?.nombre) || 'Sin Nombre'}</h3>
                {tieneDeudaReal && (
                  <span className="bg-red-100 text-red-800 px-2.5 py-0.5 rounded-full text-[11px] font-black border border-red-300 shadow-sm flex items-center gap-1">
                    ⚠️ SALDO PENDIENTE: ${saldoPendiente.toFixed(2)}
                  </span>
                )}
              </div>

              {safeString(item?.alias) && (
                <div className="mt-1 flex items-center">
                  <button
                    type="button"
                    onClick={() => toggleAlias(claveItem)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 min-h-8 rounded-full text-xs font-bold transition-all shadow-sm border ${aliasVisible ? 'bg-teal-50 text-teal-800 border-teal-300' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-teal-50 hover:text-teal-700'}`}
                    title="Clic para ver u ocultar Alias"
                  >
                    🏷️ {aliasVisible ? safeString(item?.alias) : 'Alias'}
                  </button>
                </div>
              )}

              <p className="text-xs sm:text-sm text-gray-700 font-semibold mt-1 flex flex-wrap gap-2 sm:gap-4">
                {item?.cedula && <span>🆔 {safeString(item.cedula)}</span>}
                {item?.telefono && <span>📱 {safeString(item.telefono)}</span>}
                {datos.edad !== null && <span>🎂 {datos.edad} años</span>}
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
              className="text-xs sm:text-sm bg-teal-50 text-teal-800 border border-teal-300 px-3 py-1.5 min-h-10 rounded-lg font-bold shadow-sm hover:bg-teal-100 transition-colors flex items-center gap-1"
              title="Registrar una nueva evaluación clínica a este paciente"
            >
              ➕ Nueva Consulta
            </button>
            <button type="button" onClick={() => abrirExpedienteCompleto(item)} className="text-xs sm:text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 min-h-10 rounded-lg font-bold shadow-sm hover:bg-indigo-100 transition-colors flex items-center gap-1">
              🗂️ Ver Evolución
            </button>
            <button type="button" onClick={() => enviarWhatsApp(item)} className="text-xs sm:text-sm bg-green-700 text-white px-3 py-1.5 min-h-10 rounded-lg font-semibold shadow-sm hover:bg-green-800 transition-colors">
              💬 WhatsApp
            </button>

            <div className="flex border border-gray-300 rounded-lg overflow-hidden shadow-sm">
              <button type="button" onClick={() => imprimirInforme(item)} className="text-xs sm:text-sm bg-gray-100 text-gray-800 px-2.5 sm:px-3 py-1.5 min-h-10 font-semibold hover:bg-gray-200 transition-colors">
                📄 Informe
              </button>
              <button type="button" onClick={() => imprimirRecetaSimple(item)} className="text-xs sm:text-sm bg-gray-100 text-gray-800 px-2.5 sm:px-3 py-1.5 min-h-10 font-semibold border-l border-gray-300 hover:bg-gray-200 transition-colors">
                📝 Receta
              </button>
            </div>

            <button type="button" onClick={() => cargarParaEditarClinico(item)} className="text-xs sm:text-sm bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1.5 min-h-10 min-w-10 rounded-lg font-bold shadow-sm hover:bg-blue-100 transition-colors flex items-center justify-center" title="Editar / Corregir esta consulta">
              ✏️
            </button>
            <BotonEliminarPaciente item={item} onEliminar={manejarBorradoCompleto} esAdmin={esAdmin} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <div className="bg-gray-50 p-3 sm:p-4 rounded-xl border border-gray-100 shadow-inner">
            <div className="flex justify-between items-center mb-2.5">
              <strong className="text-blue-900 text-sm sm:text-base font-extrabold">Última RX Clínica</strong>
              <span className="text-[11px] sm:text-xs text-gray-700 font-bold bg-white px-2 py-0.5 rounded border border-gray-200">
                📅 {safeString(item?.fecha_receta || item?.fecha)}{item?.fecha_receta && item.fecha_receta !== item.fecha ? ` (receta del ${safeString(item.fecha_receta)})` : ` (${datos.tiempo})`}
              </span>
            </div>
            <table className="w-full text-center text-xs sm:text-sm bg-white rounded border border-gray-200 overflow-hidden">
              <thead className="bg-blue-50/70 text-gray-800">
                <tr><th className="p-1.5 border-b border-r">Ojo</th><th className="p-1.5 border-b border-r">Esf.</th><th className="p-1.5 border-b border-r">Cil.</th><th className="p-1.5 border-b border-r">Eje</th><th className="p-1.5 border-b">Adi.</th></tr>
              </thead>
              <tbody>
                <tr><th scope="row" className="p-1.5 border-b border-r font-bold text-gray-800">OD</th><td className="p-1.5 border-b border-r font-semibold text-gray-900">{safeString(item?.esfera_od) || '—'}</td><td className="p-1.5 border-b border-r font-semibold text-gray-900">{safeString(item?.cilindro_od) || '—'}</td><td className="p-1.5 border-b border-r font-semibold text-gray-900">{safeString(item?.eje_od) || '—'}</td><td className="p-1.5 border-b font-semibold text-gray-900">{safeString(item?.adicion_od) || '—'}</td></tr>
                <tr><th scope="row" className="p-1.5 border-r font-bold text-gray-800">OI</th><td className="p-1.5 border-r font-semibold text-gray-900">{safeString(item?.esfera_oi) || '—'}</td><td className="p-1.5 border-r font-semibold text-gray-900">{safeString(item?.cilindro_oi) || '—'}</td><td className="p-1.5 border-r font-semibold text-gray-900">{safeString(item?.eje_oi) || '—'}</td><td className="p-1.5 font-semibold text-gray-900">{safeString(item?.adicion_oi) || '—'}</td></tr>
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

          <div className={`p-3 sm:p-4 rounded-xl border shadow-inner flex flex-col justify-between transition-colors ${tieneDeudaReal ? 'bg-red-50/40 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
            <div>
              <div className="flex justify-between items-center mb-2">
                <strong className="text-gray-900 text-sm sm:text-base font-extrabold block">Último Detalle Comercial / Pedido</strong>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow-sm ${item?.estado === 'Entregado' ? 'bg-green-100 text-green-900' : item?.estado === 'Listo para Entrega' ? 'bg-blue-100 text-blue-900' : esAnulado ? 'bg-red-100 text-red-900' : 'bg-yellow-100 text-yellow-900'}`}>
                  {safeString(item?.estado) || 'Sin estado'}
                </span>
              </div>

              {tienePedido ? (
                <div className="space-y-1.5 text-xs text-gray-800">
                  <div className="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm space-y-1">
                    <p>
                      <strong className="text-indigo-900">👓 Armazón:</strong>{' '}
                      <span className="font-semibold text-gray-900">
                        {safeString(item?.codigo_armazon) === '2905' ? 'Del Paciente' : (safeString(item?.codigo_armazon) || 'No registrado')}
                      </span>
                    </p>

                    {(item?.tipo_lente || item?.material_lente) && (
                      <p>
                        <strong className="text-indigo-900">🔍 Lente:</strong>{' '}
                        <span className="font-semibold text-gray-900">
                          {safeString(item?.tipo_lente) || 'Estándar'} {safeString(item?.material_lente) ? `(${safeString(item.material_lente)})` : ''}
                        </span>
                      </p>
                    )}

                    {Boolean(item?.tratam_ar === 'SI' || item?.tratam_ar_azul === 'SI' || item?.tratam_azul === 'SI' || item?.tratam_foto === 'SI' || item?.tratam_trans === 'SI' || item?.tratam_tinturado === 'SI') && (
                      <p className="text-[11px] text-teal-800 font-bold">
                        ✨ Tratamientos:{' '}
                        {[
                          item?.tratam_ar === 'SI' && 'Antirreflejo Verde',
                          item?.tratam_ar_azul === 'SI' && 'Antirreflejo Azul',
                          item?.tratam_azul === 'SI' && 'Filtro Azul',
                          item?.tratam_foto === 'SI' && 'Fotocromático',
                          item?.tratam_trans === 'SI' && 'Transition',
                          item?.tratam_tinturado === 'SI' && 'Tinturado'
                        ].filter(Boolean).join(' • ')}
                      </p>
                    )}

                    {item?.accesorio_id && (
                      <p className="text-[11px] text-purple-800 font-semibold">
                        👜 Accesorio incluido
                      </p>
                    )}
                  </div>

                  {(() => {
                    const metodosSet = new Set();
                    const inicial = safeString(item?.forma_pago).trim();
                    if (inicial && inicial !== 'Ninguno') metodosSet.add(inicial);

                    const notaCompleta = safeString(item?.pago_nota);
                    const regexAbonos = /\+\s*\$?\s*[\d.]+\s+(Efectivo|Transferencia|Tarjeta)/gi;
                    let match;
                    while ((match = regexAbonos.exec(notaCompleta)) !== null) {
                      const metodoDetectado = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
                      metodosSet.add(metodoDetectado);
                    }

                    if (item?.comprobante_url && !Array.from(metodosSet).some(m => m.toLowerCase().includes('transferencia'))) {
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

                            {item?.comprobante_url && (
                              <BotonComprobante
                                ruta={item.comprobante_url}
                                refId={safeString(item?.pedido_id) || claveItem}
                                className="font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 min-h-9 inline-flex items-center rounded border border-indigo-300 shadow-sm cursor-pointer transition-colors"
                              >
                                Ver Comprobante 📄
                              </BotonComprobante>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {item?.notas && (
                    <p className="text-[11px] text-gray-600 italic">
                      📝 Notas: {safeString(item.notas)}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-gray-500 text-xs sm:text-sm font-semibold py-4">No hay pedido registrado en esta fecha.</p>
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between items-end gap-2">
              <div>
                {tienePedido ? (
                  <>
                    <span className={`block text-[11px] uppercase font-black tracking-wider mb-0.5 ${tieneDeudaReal ? 'text-red-700' : 'text-gray-600'}`}>
                      {esAnulado ? 'Venta Anulada' : tieneDeudaReal ? '⚠ Costo Final (Con Saldo Pendiente)' : 'Costo Final'}
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-base sm:text-xl font-black ${esAnulado ? 'line-through text-gray-500' : tieneDeudaReal ? 'text-red-600' : 'text-gray-900'}`}>
                        ${vFinal.toFixed(2)}
                      </span>
                      {!esAnulado && desc > 0 && <span className="text-xs text-green-700 font-bold">(-{desc}%)</span>}
                      {tieneDeudaReal && (
                        <span className="text-xs font-black text-red-700 bg-red-100 px-2 py-0.5 rounded border border-red-300">
                          A pagar: ${saldoPendiente.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <span className="text-xs text-gray-500 italic">Sin venta asociada</span>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {esAnulado ? (
                  <>
                    <button
                      type="button"
                      onClick={() => abrirPedido(item)}
                      className="text-xs px-2.5 py-1.5 rounded-lg font-bold transition-all shadow-sm bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300"
                      title="Ver los datos del pedido anulado"
                    >
                      👁️ Ver Anulado
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const abrir = () => abrirPedido(item);
                        if (typeof confirmarAccion === 'function') {
                          confirmarAccion('Esta venta está anulada. ¿Deseas abrirla para editarla y reactivarla?', abrir);
                        } else {
                          abrir();
                        }
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-lg font-bold transition-all shadow-sm bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300"
                      title="Editar pedido anulado"
                    >
                      ✏️ Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => prepararNuevaVenta(item)}
                      className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all shadow-sm bg-emerald-700 hover:bg-emerald-800 text-white active:scale-95 flex items-center gap-1"
                      title="Crear una nueva venta para este paciente"
                    >
                      🛒 Nueva Venta
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => abrirPedido(item)}
                      className={`text-xs px-3.5 py-1.5 rounded-lg font-bold transition-all shadow-sm flex items-center gap-1.5 ${
                        !tienePedido
                          ? 'bg-teal-700 hover:bg-teal-800 text-white active:scale-95'
                          : tieneDeudaReal
                          ? 'bg-red-600 hover:bg-red-700 text-white active:scale-95'
                          : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 active:scale-95'
                      }`}
                    >
                      {tienePedido ? '👁️ Ver Venta' : '➕ Crear Venta'}
                    </button>
                    {tieneDeudaReal && (
                      <button
                        type="button"
                        onClick={() => prepararNuevaVenta(item)}
                        className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all shadow-sm bg-emerald-700 hover:bg-emerald-800 text-white active:scale-95 flex items-center gap-1"
                        title="Crear otra venta adicional para este paciente con saldo pendiente"
                      >
                        🛒 Nueva Venta
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

          </div>

        </div>
      </div>
    );
}

export default memo(TarjetaPaciente);

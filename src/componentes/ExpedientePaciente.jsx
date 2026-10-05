// ---------------------------------------------------------------------------
// VISTA DEL EXPEDIENTE COMPLETO DE UN PACIENTE
// ---------------------------------------------------------------------------
// Es la pantalla que se abre al tocar una tarjeta del historial: la cabecera con
// sus datos, el resumen clinico de cada visita y la tabla de sus compras.
// Antes vivia dentro de Historial.jsx, que superaba las 700 lineas. Aqui solo
// se pinta; la logica (busqueda, expediente, acciones) sigue en Historial.jsx,
// que le pasa los datos y los manejadores como props.
// ---------------------------------------------------------------------------
import { Fragment } from 'react';
import { safeString, safeNum, calcularEdad } from '../utilidades.js';
import { resumenConsulta } from '../historial.js';

export default function ExpedientePaciente({
  expediente,
  claveExpediente,
  aliasVisibles,
  cargando,
  registros,
  filasExpandidas,
  onToggleAlias,
  onToggleExpandir,
  onEliminarRegistro,
  onNuevaConsulta,
  onCargarParaEditar,
  onAbrirPedido,
  onVolver
}) {
  return (
    <div className="bg-white rounded-xl shadow-lg border-t-4 border-teal-600 overflow-hidden">
      <div className="bg-teal-50 p-4 sm:p-6 border-b border-teal-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-teal-900 uppercase tracking-wide">{safeString(expediente.nombre)}</h2>
          
          {safeString(expediente.alias) && (
            <div className="mt-2">
              <button 
                type="button"
                onClick={() => onToggleAlias(claveExpediente)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all shadow-sm border ${aliasVisibles[claveExpediente] ? 'bg-teal-200 text-teal-900 border-teal-300' : 'bg-white text-teal-800 border-teal-200 hover:bg-teal-100'}`}
                title="Clic para ver u ocultar Alias"
              >
                🏷️ {aliasVisibles[claveExpediente] ? safeString(expediente.alias) : 'Ver Alias'}
              </button>
            </div>
          )}

          <p className="text-teal-800 font-semibold flex flex-wrap gap-3 sm:gap-4 mt-2 text-xs sm:text-sm">
            <span>🆔 {safeString(expediente.cedula)}</span>
            <span>🎂 {calcularEdad(expediente.fecha_nacimiento)} años</span>
            <span>📱 {safeString(expediente.telefono)}</span>
          </p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button 
            type="button" 
            onClick={() => {
              if (typeof onNuevaConsulta === 'function') {
                onNuevaConsulta(expediente);
              } else {
                onCargarParaEditar(expediente);
              }
            }} 
            className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-bold text-sm shadow transition-colors w-full md:w-auto flex items-center justify-center gap-1.5"
          >
            ➕ Nueva Consulta
          </button>
          <button type="button" onClick={onVolver} className="bg-gray-800 text-white px-4 py-2 rounded-lg font-bold text-sm shadow hover:bg-gray-900 transition-colors w-full md:w-auto">
            🔙 Volver a Tarjetas
          </button>
        </div>
      </div>

      {cargando ? (
        <div className="p-16 text-center text-teal-700 font-bold text-base sm:text-lg animate-pulse">
          Cargando visitas anteriores...
        </div>
      ) : (
        <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
          
          {safeString(expediente.antecedentes) && (
            <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
              <h3 className="font-bold text-red-900 text-xs sm:text-sm uppercase mb-1">⚠️ Antecedentes Médicos / Personales:</h3>
              <p className="text-red-950 text-xs sm:text-sm leading-relaxed">{safeString(expediente.antecedentes)}</p>
            </div>
          )}

          <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end border-b-2 border-blue-200 pb-2 mb-4 gap-1">
              <h3 className="text-base sm:text-lg font-bold text-blue-900">📈 Evolución de Optometría y Refracción</h3>
              <span className="text-xs text-blue-700 font-medium">Clic en ➕ para ver Lensometría, AutoRef y Queratometría</span>
            </div>
            <div className="overflow-x-auto shadow-sm border border-gray-300 rounded-xl">
              <table className="w-full text-center text-xs bg-white min-w-[980px]">
                <thead>
                  <tr>
                    <th className="p-2 border-r border-b bg-gray-100 text-gray-700 w-10" rowSpan="2"></th>
                    <th className="p-2 border-r-2 border-b border-gray-300 bg-gray-100 text-gray-800 font-extrabold align-bottom whitespace-nowrap" rowSpan="2">
                      Fecha / Hora
                    </th>
                    
                    <th className="py-2 px-3 border-r-2 border-b-2 border-indigo-300 bg-indigo-100 text-indigo-950 font-black tracking-wider uppercase text-xs" colSpan="8">
                      👁️ Ojo Derecho (OD)
                    </th>

                    <th className="py-2 px-3 border-r border-b-2 border-emerald-300 bg-emerald-100 text-emerald-950 font-black tracking-wider uppercase text-xs" colSpan="8">
                      👁️ Ojo Izquierdo (OI)
                    </th>

                    <th className="p-2 border-l border-b bg-red-50 text-red-800" rowSpan="2">Acción</th>
                  </tr>

                  <tr className="text-gray-700 text-[11px]">
                    <th className="p-1 border-r border-b bg-indigo-50/70 font-bold">Esf.</th>
                    <th className="p-1 border-r border-b bg-indigo-50/70 font-bold">Cil.</th>
                    <th className="p-1 border-r border-b bg-indigo-50/70 font-bold">Eje</th>
                    <th className="p-1 border-r border-b bg-indigo-50/70 font-bold">Adi.</th>
                    <th className="p-1 border-r border-b bg-indigo-100/50 text-indigo-900 font-black">DNP</th>
                    <th className="p-1 border-r border-b bg-indigo-100/50 text-indigo-900 font-black">Alt.</th>
                    <th className="p-1 border-r border-b bg-indigo-50 text-indigo-800 font-bold">AV.CL</th>
                    <th className="p-1 border-r-2 border-b border-indigo-300 bg-indigo-100 text-indigo-950 font-black">AV.CC</th>

                    <th className="p-1 border-r border-b bg-emerald-50/70 font-bold">Esf.</th>
                    <th className="p-1 border-r border-b bg-emerald-50/70 font-bold">Cil.</th>
                    <th className="p-1 border-r border-b bg-emerald-50/70 font-bold">Eje</th>
                    <th className="p-1 border-r border-b bg-emerald-50/70 font-bold">Adi.</th>
                    <th className="p-1 border-r border-b bg-emerald-100/50 text-emerald-900 font-black">DNP</th>
                    <th className="p-1 border-r border-b bg-emerald-100/50 text-emerald-900 font-black">Alt.</th>
                    <th className="p-1 border-r border-b bg-emerald-50 text-emerald-800 font-bold">AV.CL</th>
                    <th className="p-1 border-r border-b bg-emerald-100 text-emerald-950 font-black">AV.CC</th>
                  </tr>
                </thead>

                <tbody>
                  {registros.map(reg => (
                    <Fragment key={reg.id}>
                      <tr className={`border-b hover:bg-gray-50/80 transition-colors ${filasExpandidas[reg.id] ? 'bg-indigo-50/20' : ''}`}>
                        <td className="p-2 border-r text-center">
                          <button 
                            type="button" 
                            onClick={() => onToggleExpandir(reg.id)} 
                            className={`w-6 h-6 flex items-center justify-center rounded-full font-bold transition-all shadow-sm ${
                              filasExpandidas[reg.id] ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200'
                            }`}
                          >
                            {filasExpandidas[reg.id] ? '−' : '＋'}
                          </button>
                        </td>
                        <td className="p-2 border-r-2 border-gray-300 font-bold text-gray-800 whitespace-nowrap bg-gray-50/40 text-[11px]">
                          {safeString(reg.fecha)}
                        </td>
                        
                        <td className="p-2 border-r font-semibold text-gray-900">{safeString(reg.esfera_od) || '—'}</td>
                        <td className="p-2 border-r font-semibold text-gray-900">{safeString(reg.cilindro_od) || '—'}</td>
                        <td className="p-2 border-r font-semibold text-gray-900">{safeString(reg.eje_od) || '—'}</td>
                        <td className="p-2 border-r font-semibold text-gray-900">{safeString(reg.adicion_od) || '—'}</td>
                        <td className="p-2 border-r font-semibold text-indigo-950 bg-indigo-50/40">{safeString(reg.dnp_od) || '—'}</td>
                        <td className="p-2 border-r font-semibold text-indigo-950 bg-indigo-50/40">{safeString(reg.altura_od) || '—'}</td>
                        <td className="p-2 border-r font-bold text-indigo-900 bg-indigo-50/20">{safeString(reg.avcl_od) || '—'}</td>
                        <td className="p-2 border-r-2 border-indigo-300 font-black text-indigo-950 bg-indigo-100/60 no-underline">
                          {safeString(reg.avcc_od) || '—'}
                        </td>

                        <td className="p-2 border-r font-semibold text-gray-900">{safeString(reg.esfera_oi) || '—'}</td>
                        <td className="p-2 border-r font-semibold text-gray-900">{safeString(reg.cilindro_oi) || '—'}</td>
                        <td className="p-2 border-r font-semibold text-gray-900">{safeString(reg.eje_oi) || '—'}</td>
                        <td className="p-2 border-r font-semibold text-gray-900">{safeString(reg.adicion_oi) || '—'}</td>
                        <td className="p-2 border-r font-semibold text-emerald-950 bg-emerald-50/40">{safeString(reg.dnp_oi) || '—'}</td>
                        <td className="p-2 border-r font-semibold text-emerald-950 bg-emerald-50/40">{safeString(reg.altura_oi) || '—'}</td>
                        <td className="p-2 border-r font-bold text-emerald-900 bg-emerald-50/20">{safeString(reg.avcl_oi) || '—'}</td>
                        <td className="p-2 border-r font-black text-emerald-950 bg-emerald-100/60 no-underline">
                          {safeString(reg.avcc_oi) || '—'}
                        </td>
                        
                        <td className="p-2 border-l text-center bg-red-50/20">
                          <button 
                            type="button" 
                            onClick={() => onEliminarRegistro(reg)} 
                            className="text-xs bg-red-100 text-red-700 hover:bg-red-200 p-1.5 rounded font-bold transition-colors shadow-sm" 
                            title="Eliminar esta consulta clínica puntual"
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                      
                      {filasExpandidas[reg.id] && (
                        <tr className="bg-slate-50 border-b shadow-inner">
                          <td colSpan="19" className="p-3 sm:p-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 text-xs text-left">
                              <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                                <h4 className="font-bold text-teal-900 border-b border-gray-100 pb-1 mb-2">👓 Lensometría Anterior</h4>
                                <p className="mb-1"><strong className="text-gray-600">OD:</strong> <span className="text-gray-900 font-semibold">{safeString(reg.lenso_esf_od) || '-'} | {safeString(reg.lenso_cil_od) || '-'} | {safeString(reg.lenso_eje_od) || '-'}</span></p>
                                <p><strong className="text-gray-600">OI:</strong> <span className="text-gray-900 font-semibold">{safeString(reg.lenso_esf_oi) || '-'} | {safeString(reg.lenso_cil_oi) || '-'} | {safeString(reg.lenso_eje_oi) || '-'}</span></p>
                              </div>
                              
                              <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                                <h4 className="font-bold text-blue-900 border-b border-gray-100 pb-1 mb-2">🤖 Autorrefractómetro</h4>
                                <p className="mb-1"><strong className="text-gray-600">OD:</strong> <span className="text-gray-900 font-semibold">{safeString(reg.auto_esf_od) || '-'} | {safeString(reg.auto_cil_od) || '-'} | {safeString(reg.auto_eje_od) || '-'}</span></p>
                                <p><strong className="text-gray-600">OI:</strong> <span className="text-gray-900 font-semibold">{safeString(reg.auto_esf_oi) || '-'} | {safeString(reg.auto_cil_oi) || '-'} | {safeString(reg.auto_eje_oi) || '-'}</span></p>
                              </div>
                              
                              <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                                <h4 className="font-bold text-indigo-900 border-b border-gray-100 pb-1 mb-2">👁 Queratometría</h4>
                                <p className="mb-1"><strong className="text-gray-600">OD:</strong> <span className="text-gray-900 font-semibold">K1: {safeString(reg.k1_d_od) || '-'} | K2: {safeString(reg.k2_d_od) || '-'}</span></p>
                                <p><strong className="text-gray-600">OI:</strong> <span className="text-gray-900 font-semibold">K1: {safeString(reg.k1_d_oi) || '-'} | K2: {safeString(reg.k2_d_oi) || '-'}</span></p>
                              </div>

                              <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                                <h4 className="font-bold text-amber-900 border-b border-gray-100 pb-1 mb-2">📝 Notas Clínicas</h4>
                                <p className="text-gray-800 italic leading-relaxed">{safeString(reg.notas_clinicas) || 'Sin notas registradas en esta visita.'}</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-end border-b-2 border-amber-200 pb-2 mb-4">
              <h3 className="text-base sm:text-lg font-bold text-amber-900">🛒 Historial de Pedidos y Compras</h3>
            </div>
            <div className="overflow-x-auto shadow-sm border border-gray-200 rounded-lg">
              <table className="w-full text-left text-xs bg-white min-w-[620px]">
                <thead className="bg-amber-50 text-amber-900 border-b">
                  <tr>
                    <th className="p-2 border-r">Fecha</th>
                    <th className="p-2 border-r">Armazón</th>
                    <th className="p-2 border-r">Lente / Tratamientos</th>
                    <th className="p-2 border-r text-center">Costo Final</th>
                    <th className="p-2 border-r text-center">Saldo Pendiente</th>
                    <th className="p-2 border-r text-center">Estado</th>
                    <th className="p-2 text-center">Gestión</th>
                  </tr>
                </thead>
                <tbody>
                  {registros.filter(r => safeString(r.estado) !== 'Ninguno' || safeNum(r.venta) > 0 || safeString(r.codigo_armazon)).length > 0 ? (
                    registros.filter(r => safeString(r.estado) !== 'Ninguno' || safeNum(r.venta) > 0 || safeString(r.codigo_armazon)).map(reg => {
                      const { total: vFinal, saldo } = resumenConsulta(reg);
                      const esAnulado = safeString(reg.estado).trim().toLowerCase() === 'anulado';
                      return (
                        <tr key={'venta-' + reg.id} className="border-b hover:bg-gray-50 transition-colors">
                          <td className="p-2 border-r font-bold text-gray-700">{safeString(reg.fecha)}</td>
                          <td className="p-2 border-r font-medium">{safeString(reg.codigo_armazon) === '2905' ? 'Del Paciente' : (safeString(reg.codigo_armazon) || '-')}</td>
                          <td className="p-2 border-r text-[11px] text-gray-700">
                            <span className="font-bold text-gray-900">{safeString(reg.tipo_lente) || '-'}</span>
                            <br/>
                            {reg.tratam_ar === 'SI' && ' +AR'} {reg.tratam_ar_azul === 'SI' && ' +AR Azul'} {reg.tratam_azul === 'SI' && ' +Filtro Azul'} {reg.tratam_foto === 'SI' && ' +Foto'}
                          </td>
                          <td className="p-2 border-r text-center font-bold text-gray-900">
                            {esAnulado ? <span className="line-through text-gray-400">${safeNum(reg.venta).toFixed(2)}</span> : `$${vFinal.toFixed(2)}`}
                          </td>
                          <td className={`p-2 border-r text-center font-black ${esAnulado ? 'text-gray-400' : saldo > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                            ${esAnulado ? '0.00' : Math.max(0, saldo).toFixed(2)}
                          </td>
                          <td className="p-2 border-r text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${reg.estado === 'Entregado' ? 'bg-green-100 text-green-900' : reg.estado === 'Listo para Entrega' ? 'bg-blue-100 text-blue-900' : esAnulado ? 'bg-red-100 text-red-900' : 'bg-yellow-100 text-yellow-900'}`}>
                              {safeString(reg.estado)}
                            </span>
                          </td>
                          <td className="p-2 text-center">
                            <button type="button" onClick={() => onAbrirPedido(reg)} className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 px-3 py-1 rounded-md font-bold transition-colors">
                              Ver / Cobrar
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr><td colSpan="7" className="p-6 text-center text-gray-500 font-medium">Sin compras registradas.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

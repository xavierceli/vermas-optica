import { useState, useEffect, useMemo, Fragment } from 'react';
import { supabase } from './supabaseClient'; 
import { safeString, safeNum, calcularEdad, calcularTiempoTranscurrido, buscarPacientesEnSupabase } from './utilidades';
import { imprimirInforme, imprimirRecetaSimple } from './impresiones';
import { obtenerSnapshotLocal, normalizeCedula } from './localRepository';
import { generarDiagnosticos, listaSegunBusqueda, resumenConsulta } from './historial';
import BotonComprobante from './BotonComprobante';

export default function Historial({
  historialReciente,
  enviarWhatsApp, cargarParaEditarClinico, borrarHistoriaClinica, abrirPedido, crearNuevoPaciente,
  confirmarAccion
}) {
  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState({ termino: '', datos: [] });
  const [buscando, setBuscando] = useState(false);
  const INCREMENTO = 50;
  const [visibles, setVisibles] = useState(50);
  const filasPorMostrar = visibles;

  const [expedienteActivo, setExpedienteActivo] = useState(null);
  const [registrosPaciente, setRegistrosPaciente] = useState([]);
  const [cargandoExpediente, setCargandoExpediente] = useState(false);
  
  const [filasExpandidas, setFilasExpandidas] = useState({});
  const [aliasVisibles, setAliasVisibles] = useState({});

  useEffect(() => {
    setVisibles(50);
  }, [busquedaTexto]);

  useEffect(() => {
    const termino = busquedaTexto.trim();
    if (termino.length < 2) return;

    const timer = setTimeout(async () => {
      setBuscando(true);
      let borradas = new Set();
      let filtradosLocales = [];
      try {
        const snapshot = await obtenerSnapshotLocal();
        const histLocal = snapshot?.historial || historialReciente || [];
        borradas = new Set(snapshot?.cedulasArchivadas || []);
        const busqueda = termino.toLowerCase();
        const filtrados = histLocal.filter(item => 
          safeString(item.nombre).toLowerCase().includes(busqueda) ||
          safeString(item.cedula).includes(busqueda) ||
          safeString(item.alias).toLowerCase().includes(busqueda)
        );
        filtradosLocales = filtrados;
        if (filtrados.length > 0) setResultadosBusqueda({ termino, datos: filtrados });
      } catch { /* continuar con la búsqueda remota si la local falla */ }

      try {
        if (navigator.onLine) {
          const datos = await buscarPacientesEnSupabase(termino);
          const enNube = (datos || []).filter(d => !borradas.has(normalizeCedula(d.cedula)));
          if (enNube.length > 0) setResultadosBusqueda({ termino, datos: enNube });
          else if (filtradosLocales.length === 0) setResultadosBusqueda({ termino, datos: [] });
        }
      } catch {
        console.warn("Búsqueda en nube falló, usando datos locales.");
      } finally {
        setBuscando(false);
      }
    }, 300);
    
    return () => clearTimeout(timer);
  }, [busquedaTexto, historialReciente]);

  const hayTermino = busquedaTexto.trim().length >= 2;

  const pacientesAgrupados = useMemo(() => {
    return listaSegunBusqueda({
      busquedaTexto, resultados: resultadosBusqueda, historial: historialReciente
    }).lista;
  }, [busquedaTexto, resultadosBusqueda, historialReciente]);

  const filasVisibles = pacientesAgrupados.slice(0, filasPorMostrar);

  const abrirExpedienteCompleto = async (paciente) => {
    setExpedienteActivo(paciente);
    setFilasExpandidas({});
    setCargandoExpediente(true);
    
    let borradas = new Set();
    try {
      const snapshot = await obtenerSnapshotLocal();
      borradas = new Set((snapshot?.cedulasArchivadas || []).map(normalizeCedula));
      const histLocal = snapshot?.historial || historialReciente || [];

      // Filtro local estricto: solo consultas del paciente que NO estén archivadas
      const registrosLocales = histLocal
        .filter(r => safeString(r.cedula) === safeString(paciente.cedula))
        .filter(r => !r.archived_at)
        .filter(r => !paciente.id || !r.patient_id || String(r.patient_id) === String(paciente.patient_id || paciente.id))
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
      
      setRegistrosPaciente(registrosLocales);
      if (registrosLocales.length > 0) {
        setCargandoExpediente(false);
      }
    } catch {
      console.warn("Fallo al leer datos locales del paciente.");
    }

    try {
      if (!navigator.onLine) return;

      let query = supabase
        .from('vista_pacientes')
        .select('*')
        .eq('cedula', paciente.cedula);

      try {
        query = query.is('archived_at', null);
      } catch {}

      const { data, error } = await query.order('fecha', { ascending: false });
        
      if (error) throw error;
      if (data && data.length > 0) {
        const filtradosNube = data.filter(d => !d.archived_at);
        
        const porPaciente = paciente.patient_id || paciente.id
          ? filtradosNube.filter(d => !d.patient_id || String(d.patient_id) === String(paciente.patient_id || paciente.id))
          : filtradosNube;

        setRegistrosPaciente(porPaciente.length > 0 ? porPaciente : filtradosNube);
      }
    } catch (e) { 
      console.warn("Supabase no respondió a tiempo para el expediente:", e);
    } finally {
      setCargandoExpediente(false);
    }
  };

  const toggleExpandir = (id) => {
    setFilasExpandidas(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleAlias = (id) => {
    setAliasVisibles(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const eliminarRegistroDeExpediente = async (reg) => {
    confirmarAccion(
      `¿Deseas eliminar la consulta del ${safeString(reg.fecha)}?`,
      async () => {
        await borrarHistoriaClinica(reg);
        setRegistrosPaciente(prev => prev.filter(r => r.id !== reg.id));
      }
    );
  };

  if (expedienteActivo) {
    return (
      <div className="bg-white rounded-xl shadow-lg border-t-4 border-teal-600 overflow-hidden">
        <div className="bg-teal-50 p-4 sm:p-6 border-b border-teal-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-teal-900 uppercase tracking-wide">{safeString(expedienteActivo.nombre)}</h2>
            
            {safeString(expedienteActivo.alias) && (
              <div className="mt-2">
                <button 
                  type="button"
                  onClick={() => toggleAlias(expedienteActivo.id)} 
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all shadow-sm border ${aliasVisibles[expedienteActivo.id] ? 'bg-teal-200 text-teal-900 border-teal-300' : 'bg-white text-teal-800 border-teal-200 hover:bg-teal-100'}`}
                  title="Clic para ver u ocultar Alias"
                >
                  🏷️ {aliasVisibles[expedienteActivo.id] ? safeString(expedienteActivo.alias) : 'Ver Alias'}
                </button>
              </div>
            )}

            <p className="text-teal-800 font-semibold flex flex-wrap gap-3 sm:gap-4 mt-2 text-xs sm:text-sm">
              <span>🆔 {safeString(expedienteActivo.cedula)}</span>
              <span>🎂 {calcularEdad(expedienteActivo.fecha_nacimiento)} años</span>
              <span>📱 {safeString(expedienteActivo.telefono)}</span>
            </p>
          </div>
          <button type="button" onClick={() => {setExpedienteActivo(null); setRegistrosPaciente([]);}} className="bg-gray-800 text-white px-4 py-2 rounded-lg font-bold text-sm shadow hover:bg-gray-900 transition-colors w-full sm:w-auto">
            🔙 Volver a Tarjetas
          </button>
        </div>

        {cargandoExpediente ? (
          <div className="p-16 text-center text-teal-700 font-bold text-base sm:text-lg animate-pulse">
            Cargando visitas anteriores...
          </div>
        ) : (
          <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
            
            {safeString(expedienteActivo.antecedentes) && (
              <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                <h3 className="font-bold text-red-900 text-xs sm:text-sm uppercase mb-1">⚠️ Antecedentes Médicos / Personales:</h3>
                <p className="text-red-950 text-xs sm:text-sm leading-relaxed">{safeString(expedienteActivo.antecedentes)}</p>
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
                    {/* Encabezado Nivel 1: Bloques OD y OI con colores diferenciados */}
                    <tr>
                      <th className="p-2 border-r border-b bg-gray-100 text-gray-700 w-10" rowSpan="2"></th>
                      <th className="p-2 border-r-2 border-b border-gray-300 bg-gray-100 text-gray-800 font-extrabold align-bottom" rowSpan="2">
                        Fecha
                      </th>
                      
                      {/* BLOQUE OJO DERECHO (AZUL ÍNDIGO) */}
                      <th className="py-2 px-3 border-r-2 border-b-2 border-indigo-300 bg-indigo-100 text-indigo-950 font-black tracking-wider uppercase text-xs" colSpan="8">
                        👁️ Ojo Derecho (OD)
                      </th>

                      {/* BLOQUE OJO IZQUIERDO (VERDE ESMERALDA) */}
                      <th className="py-2 px-3 border-r border-b-2 border-emerald-300 bg-emerald-100 text-emerald-950 font-black tracking-wider uppercase text-xs" colSpan="8">
                        👁️ Ojo Izquierdo (OI)
                      </th>

                      <th className="p-2 border-l border-b bg-red-50 text-red-800" rowSpan="2">Acción</th>
                    </tr>

                    {/* Encabezado Nivel 2: Columnas de cada ojo */}
                    <tr className="text-gray-700 text-[11px]">
                      {/* Columnas OD */}
                      <th className="p-1 border-r border-b bg-indigo-50/70 font-bold">Esf.</th>
                      <th className="p-1 border-r border-b bg-indigo-50/70 font-bold">Cil.</th>
                      <th className="p-1 border-r border-b bg-indigo-50/70 font-bold">Eje</th>
                      <th className="p-1 border-r border-b bg-indigo-50/70 font-bold">Adi.</th>
                      <th className="p-1 border-r border-b bg-indigo-100/50 text-indigo-900 font-black">DNP</th>
                      <th className="p-1 border-r border-b bg-indigo-100/50 text-indigo-900 font-black">Alt.</th>
                      <th className="p-1 border-r border-b bg-indigo-50 text-indigo-800 font-bold">AV.CL</th>
                      <th className="p-1 border-r-2 border-b border-indigo-300 bg-indigo-100 text-indigo-950 font-black">AV.CC</th>

                      {/* Columnas OI */}
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
                    {registrosPaciente.map(reg => (
                      <Fragment key={reg.id}>
                        <tr className={`border-b hover:bg-gray-50/80 transition-colors ${filasExpandidas[reg.id] ? 'bg-indigo-50/20' : ''}`}>
                          <td className="p-2 border-r text-center">
                            <button 
                              type="button" 
                              onClick={() => toggleExpandir(reg.id)} 
                              className={`w-6 h-6 flex items-center justify-center rounded-full font-bold transition-all shadow-sm ${
                                filasExpandidas[reg.id] ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200'
                              }`}
                            >
                              {filasExpandidas[reg.id] ? '−' : '＋'}
                            </button>
                          </td>
                          <td className="p-2 border-r-2 border-gray-300 font-bold text-gray-800 whitespace-nowrap bg-gray-50/40">
                            {safeString(reg.fecha)}
                          </td>
                          
                          {/* VALORES OJO DERECHO (OD) */}
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

                          {/* VALORES OJO IZQUIERDO (OI) */}
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
                              onClick={() => eliminarRegistroDeExpediente(reg)} 
                              className="text-xs bg-red-100 text-red-700 hover:bg-red-200 p-1.5 rounded font-bold transition-colors shadow-sm" 
                              title="Eliminar esta consulta clínica"
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
                                  <p className="mb-1"><strong className="text-gray-600">OD:</strong> <span className="text-gray-900 font-semibold">{safeString(reg.k1_d_od) || '-'} | K2: {safeString(reg.k2_d_od) || '-'}</span></p>
                                  <p><strong className="text-gray-600">OI:</strong> <span className="text-gray-900 font-semibold">{safeString(reg.k1_d_oi) || '-'} | K2: {safeString(reg.k2_d_oi) || '-'}</span></p>
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
                    {registrosPaciente.filter(r => String(r.estado) !== 'Ninguno' || safeNum(r.venta) > 0 || safeString(r.codigo_armazon)).length > 0 ? (
                      registrosPaciente.filter(r => String(r.estado) !== 'Ninguno' || safeNum(r.venta) > 0 || safeString(r.codigo_armazon)).map(reg => {
                        const { total: vFinal, saldo } = resumenConsulta(reg);
                        return (
                          <tr key={'venta-' + reg.id} className="border-b hover:bg-gray-50 transition-colors">
                            <td className="p-2 border-r font-bold text-gray-700">{safeString(reg.fecha)}</td>
                            <td className="p-2 border-r font-medium">{safeString(reg.codigo_armazon) === '2905' ? 'Del Paciente' : (safeString(reg.codigo_armazon) || '-')}</td>
                            <td className="p-2 border-r text-[11px] text-gray-700">
                              <span className="font-bold text-gray-900">{safeString(reg.tipo_lente) || '-'}</span>
                              <br/>
                              {reg.tratam_ar === 'SI' && ' +AR'} {reg.tratam_ar_azul === 'SI' && ' +AR Azul'} {reg.tratam_azul === 'SI' && ' +Filtro Azul'} {reg.tratam_foto === 'SI' && ' +Foto'}
                            </td>
                            <td className="p-2 border-r text-center font-bold text-gray-900">${vFinal.toFixed(2)}</td>
                            <td className={`p-2 border-r text-center font-black ${saldo > 0 ? 'text-red-600' : 'text-emerald-700'}`}>${Math.max(0, saldo).toFixed(2)}</td>
                            <td className="p-2 border-r text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${reg.estado === 'Entregado' ? 'bg-green-100 text-green-900' : reg.estado === 'Listo para Entrega' ? 'bg-blue-100 text-blue-900' : 'bg-yellow-100 text-yellow-900'}`}>
                                {safeString(reg.estado)}
                              </span>
                            </td>
                            <td className="p-2 text-center">
                              <button type="button" onClick={() => abrirPedido(reg)} className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 px-3 py-1 rounded-md font-bold transition-colors">
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
          onChange={(e) => setBusquedaTexto(e.target.value)} 
          className="flex-1 p-2.5 sm:p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 shadow-sm text-sm font-medium bg-gray-50 focus:bg-white text-gray-900" 
        />
        {buscando && hayTermino && <div className="flex items-center text-xs font-bold text-blue-700 px-2 shrink-0">Buscando... ☁️</div>}
      </div>

      <div className="space-y-4 sm:space-y-6">
        {filasVisibles.map(item => {
          try {
            const diagnosticos = generarDiagnosticos(item);
            const { saldo: saldoPendiente, tieneDeuda, tienePedido, total: vFinal, descuento: desc } = resumenConsulta(item);
            
            return (
              <div key={item.id} className="border border-gray-200 bg-white p-4 sm:p-6 rounded-2xl shadow-sm hover:shadow-md transition-all">
                
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
                            onClick={() => toggleAlias(item.id)} 
                            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold transition-all shadow-sm border ${aliasVisibles[item.id] ? 'bg-teal-50 text-teal-800 border-teal-300' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-teal-50 hover:text-teal-700'}`}
                            title="Clic para ver u ocultar Alias"
                          >
                            🏷️ {aliasVisibles[item.id] ? safeString(item.alias) : 'Alias'}
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
                    
                    <button type="button" onClick={() => cargarParaEditarClinico(item)} className="text-xs sm:text-sm bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1.5 rounded-lg font-bold shadow-sm hover:bg-blue-100 transition-colors" title="Editar Clínica">
                      ✏️
                    </button>
                    <button 
                      type="button" 
                      onClick={() => confirmarAccion(
                        `¿Eliminar a ${safeString(item.nombre) || 'este paciente'}?\n\n`
                        + 'Se archivará TODO su historial, no solo la última visita. '
                        + 'Las ventas y los pagos ya cobrados no se tocan, pero la ficha '
                        + 'clínica dejará de aparecer en este y en cualquier otro equipo.',
                        () => borrarHistoriaClinica(item)
                      )}
                      className="text-xs sm:text-sm bg-red-50 text-red-700 border border-red-200 px-2.5 py-1.5 rounded-lg font-bold shadow-sm hover:bg-red-100 transition-colors"
                      title="Eliminar todo el historial de este paciente"
                    >
                      🗑️
                    </button>
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

                  {/* Detalle Comercial / Pedido Actualizado */}
                  <div className={`p-3 sm:p-4 rounded-xl border shadow-inner flex flex-col justify-between transition-colors ${tieneDeuda ? 'bg-red-50/40 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <strong className="text-gray-900 text-sm sm:text-base font-extrabold block">Último Detalle Comercial / Pedido</strong>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow-sm ${item.estado === 'Entregado' ? 'bg-green-100 text-green-900' : item.estado === 'Listo para Entrega' ? 'bg-blue-100 text-blue-900' : 'bg-yellow-100 text-yellow-900'}`}>
                          {safeString(item.estado) || 'Sin estado'}
                        </span>
                      </div>

                      {tienePedido ? (
                        <div className="space-y-1.5 text-xs text-gray-800">
                          {/* 1. Detalle del Producto Vendido */}
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
                                  {safeString(item.tipo_lente) || 'Estándar'} {item.material_lente ? `(${item.material_lente})` : ''}
                                </span>
                              </p>
                            )}

                            {/* Tratamientos aplicados */}
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

                          {/* 2. Métodos de pago con enlace integrado al comprobante */}
                          {(() => {
                            const metodos = [];
                            const inicial = safeString(item.forma_pago).trim();
                            if (inicial) metodos.push(inicial);

                            // Extraemos métodos de pago registrados en las notas de abono (ej: "[01/10] +$20.00 Transferencia")
                            const notaCompleta = safeString(item.pago_nota);
                            const regexAbonos = /\+\s*\$?\s*[\d.]+\s+(Efectivo|Transferencia|Tarjeta)/gi;
                            let match;
                            while ((match = regexAbonos.exec(notaCompleta)) !== null) {
                              const metodoDetectado = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
                              metodos.push(metodoDetectado);
                            }

                            // Si tiene comprobante adjunto y no se detectó transferencia, la agregamos
                            if (item.comprobante_url && !metodos.some(m => m.toLowerCase().includes('transferencia'))) {
                              metodos.push('Transferencia');
                            }

                            const listaFinal = metodos.length > 0 ? metodos : ['Efectivo'];

                            return (
                              <div className="pt-1 text-[11px]">
                                <div className="text-gray-700 flex items-center gap-1.5 flex-wrap">
                                  <strong>Método(s) de pago:</strong>
                                  <div className="inline-flex items-center gap-1.5 flex-wrap">
                                    {listaFinal.map((metodo, idx) => {
                                      const esTransferencia = metodo.toLowerCase().includes('transferencia');
                                      const tieneFoto = esTransferencia && Boolean(item.comprobante_url);

                                      if (tieneFoto) {
                                        return (
                                          <span key={idx} className="inline-flex items-center">
                                            <BotonComprobante
                                              ruta={item.comprobante_url}
                                              refId={item.pedido_id || item.id}
                                              texto="Transferencia 📄"
                                              className="font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded border border-indigo-300 shadow-sm cursor-pointer transition-colors"
                                            />
                                            {idx < listaFinal.length - 1 && <span className="ml-1 text-gray-500">,</span>}
                                          </span>
                                        );
                                      }

                                      return (
                                        <span key={idx} className="inline-flex items-center font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                                          {metodo}
                                          {idx < listaFinal.length - 1 && <span className="ml-0.5 text-gray-500">,</span>}
                                        </span>
                                      );
                                    })}
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

                    {/* 3. Costo final y botón dinámico (Crear Venta vs Ver Venta) */}
                    <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between items-end">
                      <div>
                        {tienePedido ? (
                          <>
                            <span className={`block text-[11px] uppercase font-black tracking-wider mb-0.5 ${tieneDeuda ? 'text-red-700' : 'text-gray-600'}`}>
                              {tieneDeuda ? '⚠ Costo Final (Con Saldo Pendiente)' : 'Costo Final'}
                            </span>
                            <div className="flex items-baseline gap-2">
                              <span className={`text-base sm:text-xl font-black ${tieneDeuda ? 'text-red-600 animate-pulse' : 'text-gray-900'}`}>
                                ${vFinal.toFixed(2)}
                              </span>
                              {desc > 0 && <span className="text-xs text-green-700 font-bold">(-{desc}%)</span>}
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

                      {/* Botón dinámico según el estado del pedido */}
                      <button 
                        type="button" 
                        onClick={() => abrirPedido(item)} 
                        className={`text-xs px-3.5 py-1.5 rounded-lg font-bold transition-all shadow-sm flex items-center gap-1.5 ${
                          !tienePedido
                            ? 'bg-teal-600 hover:bg-teal-700 text-white active:scale-95'
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
              onClick={() => setVisibles(v => v + INCREMENTO)}
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
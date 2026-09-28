import { useState, useEffect, useMemo, Fragment } from 'react';
import { supabase } from './supabaseClient'; 
import { safeString, safeNum, calcularEdad, calcularTiempoTranscurrido, generarDiagnosticos, buscarPacientesEnSupabase } from './utilidades';
import { imprimirInforme, imprimirRecetaSimple } from './impresiones';
import { calcularTotal, calcularSaldo } from './reglas';
import { obtenerSnapshotLocal } from './localRepository';
import BotonComprobante from './BotonComprobante';

export default function Historial({
  historialReciente,
  enviarWhatsApp, cargarParaEditarClinico, borrarHistoriaClinica, abrirPedido, crearNuevoPaciente
}) {
  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState({ termino: '', datos: [] });
  const [buscando, setBuscando] = useState(false);
  // La paginacion descarga miles de consultas, pero pintarlas todas de golpe
  // saturaba el navegador y dejaba la app (y los guardados) sin respuesta.
  // Se muestran de 50 en 50 bajo demanda.
  const INCREMENTO = 50;
  const [visibles, setVisibles] = useState(50);
  const filasPorMostrar = visibles;

  const [expedienteActivo, setExpedienteActivo] = useState(null);
  const [registrosPaciente, setRegistrosPaciente] = useState([]);
  const [cargandoExpediente, setCargandoExpediente] = useState(false);
  
  const [filasExpandidas, setFilasExpandidas] = useState({});
  const [aliasVisibles, setAliasVisibles] = useState({});

  // --- BÚSQUEDA HÍBRIDA EXTREMA ---
  // El estado guarda CON QUÉ TÉRMINO se buscó, para que la vista nunca muestre
  // resultados de una búsqueda anterior mientras corre la nueva.
  useEffect(() => {
    const termino = busquedaTexto.trim();
    if (termino.length < 2) return;

    const timer = setTimeout(async () => {
      setBuscando(true);
      // 1. Mostrar resultados locales inmediatamente
      try {
        // Se lee el snapshot de Dexie, la MISMA fuente que usa useGestor. Antes
        // se consultaba el store legacy de localforage ('backup_historial'), que
        // importLegacyCache ya migra y vacia: ademas de no servir, introducia una
        // carrera con la migracion y hacia que la tabla cambiase sola mientras
        // el optometra la miraba.
        const snapshot = await obtenerSnapshotLocal();
        const histLocal = snapshot?.historial || historialReciente || [];
        const busqueda = termino.toLowerCase();
        const filtrados = histLocal.filter(item => 
          safeString(item.nombre).toLowerCase().includes(busqueda) ||
          safeString(item.cedula).includes(busqueda) ||
          safeString(item.alias).toLowerCase().includes(busqueda)
        );
        if (filtrados.length > 0) setResultadosBusqueda({ termino, datos: filtrados });
      } catch { /* la bóveda local falló: se muestran los resultados de la nube */ }

      // 2. Buscar en la nube de fondo
      try {
        if (navigator.onLine) {
          const datos = await buscarPacientesEnSupabase(termino);
          if (datos && datos.length > 0) setResultadosBusqueda({ termino, datos });
        }
      } catch {
        console.warn("Búsqueda en nube falló, usando local.");
      } finally {
        setBuscando(false);
      }
    }, 300);
    
    return () => clearTimeout(timer);
  }, [busquedaTexto, historialReciente]);

  // Sin término válido mostramos el historial completo. Con término, solo
  // mostramos resultados que pertenezcan a esa misma búsqueda: así no hace
  // falta un setState para "limpiar" y se evita el render en cascada.
  //
  // Elegir la lista Y agrupar por cédula van en el MISMO useMemo a propósito.
  // Si se separaran, la rama `[]` (cuando el término no coincide) crearía un
  // array nuevo en cada render y el memo de agrupación se invalidaría siempre,
  // dejando el cálculo igual de caro que antes pero con la ilusión de estar optimizado.
  // Se declara aquí porque el JSX lo usa para mostrar el aviso "Buscando...".
  const hayTermino = busquedaTexto.trim().length >= 2;

  const pacientesAgrupados = useMemo(() => {
    const terminoActual = busquedaTexto.trim();
    const listaBruta = hayTermino
      ? (resultadosBusqueda.termino === terminoActual ? resultadosBusqueda.datos : [])
      : (historialReciente || []);

    const agrupados = [];
    const cedulasVistas = new Set();
    for (const item of listaBruta) {
      if (!item || safeString(item.nombre) === 'CONSUMIDOR FINAL') continue;
      if (cedulasVistas.has(item.cedula)) continue;
      cedulasVistas.add(item.cedula);
      agrupados.push(item);
    }
    return agrupados;
  }, [busquedaTexto, resultadosBusqueda, historialReciente, hayTermino]);

  const filasVisibles = pacientesAgrupados.slice(0, filasPorMostrar);

  // --- APERTURA DE EXPEDIENTE HÍBRIDA EXTREMA (SOLUCIÓN AL CONGELAMIENTO) ---
  const abrirExpedienteCompleto = async (paciente) => {
    setExpedienteActivo(paciente);
    setFilasExpandidas({});
    setCargandoExpediente(true);
    
    // FASE 1: Mostrar datos locales en 0.1 segundos (Evita que se congele)
    try {
      const snapshot = await obtenerSnapshotLocal();
      const histLocal = snapshot?.historial || historialReciente || [];
      const registrosLocales = histLocal.filter(r => safeString(r.cedula) === safeString(paciente.cedula));
      registrosLocales.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      
      if (registrosLocales.length > 0) {
        setRegistrosPaciente(registrosLocales);
        setCargandoExpediente(false); // ¡Apagamos la pantalla de carga de inmediato!
      }
    } catch {
      console.warn("Fallo al leer bóveda local.");
    }

    // FASE 2: Sincronización invisible
    try {
      if (!navigator.onLine) return; // Rompe si sabe que no hay internet

      const { data, error } = await supabase
        .from('vista_pacientes')
        .select('*')
        .eq('cedula', paciente.cedula)
        .order('fecha', { ascending: false });
        
      if (error) throw error;
      if (data && data.length > 0) {
        setRegistrosPaciente(data); // Actualiza si encontró datos más nuevos en la nube
      }
    } catch(e) { 
      console.warn("Supabase no respondió a tiempo (Offline real).", e);
    } finally {
      setCargandoExpediente(false); // Por si todo falló, que no se quede congelado
    }
  };

  const toggleExpandir = (id) => {
    setFilasExpandidas(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleAlias = (id) => {
    setAliasVisibles(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (expedienteActivo) {
    return (
      <div className="bg-white rounded-xl shadow-lg border-t-4 border-teal-600 overflow-hidden">
        <div className="bg-teal-50 p-6 border-b border-teal-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-teal-900 uppercase tracking-wide">{safeString(expedienteActivo.nombre)}</h2>
            
            {safeString(expedienteActivo.alias) && (
              <div className="mt-2">
                <button 
                  onClick={() => toggleAlias(expedienteActivo.id)} 
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all shadow-sm border ${aliasVisibles[expedienteActivo.id] ? 'bg-teal-200 text-teal-900 border-teal-300' : 'bg-white text-teal-700 border-teal-200 hover:bg-teal-100'}`}
                  title="Clic para ver/ocultar Alias"
                >
                  🏷️ {aliasVisibles[expedienteActivo.id] ? safeString(expedienteActivo.alias) : 'Ver Alias'}
                </button>
              </div>
            )}

            <p className="text-teal-700 font-medium flex gap-4 mt-2">
              <span>🆔 {safeString(expedienteActivo.cedula)}</span>
              <span>🎂 {calcularEdad(expedienteActivo.fecha_nacimiento)} años</span>
              <span>📱 {safeString(expedienteActivo.telefono)}</span>
            </p>
          </div>
          <button onClick={() => {setExpedienteActivo(null); setRegistrosPaciente([]);}} className="bg-gray-800 text-white px-4 py-2 rounded-lg font-bold shadow hover:bg-gray-900 transition-colors">🔙 Volver a Tarjetas</button>
        </div>

        {cargandoExpediente ? (
          <div className="p-20 text-center text-teal-600 font-bold text-lg animate-pulse">Cargando todas sus visitas anteriores...</div>
        ) : (
          <div className="p-6 space-y-8">
            
            {safeString(expedienteActivo.antecedentes) && (
              <div className="bg-red-50 border border-red-100 p-4 rounded-lg">
                <h3 className="font-bold text-red-800 text-sm uppercase mb-1">⚠️ Antecedentes Médicos / Personales:</h3>
                <p className="text-red-900 text-sm">{safeString(expedienteActivo.antecedentes)}</p>
              </div>
            )}

            <div>
              <div className="flex justify-between items-end border-b-2 border-blue-200 pb-2 mb-4">
                <h3 className="text-lg font-bold text-blue-900">📈 Evolución de Optometría y Refracción</h3>
                <span className="text-xs text-blue-600 font-medium">Clic en ➕ para ver detalles (Lensometría, AutoRef, K's)</span>
              </div>
              <div className="overflow-x-auto shadow-sm border border-gray-200 rounded-lg">
                <table className="w-full text-center text-xs bg-white">
                  <thead className="bg-blue-50 text-blue-900">
                    <tr>
                      <th className="p-2 border-r border-b w-10" rowSpan="2"></th>
                      <th className="p-2 border-r border-b align-bottom" rowSpan="2">Fecha</th>
                      <th className="p-2 border-r border-b" colSpan="5">Ojo Derecho (OD)</th>
                      <th className="p-2 border-b" colSpan="5">Ojo Izquierdo (OI)</th>
                      <th className="p-2 border-l border-b bg-red-50 text-red-700" rowSpan="2">Acción</th>
                    </tr>
                    <tr className="bg-blue-100/50">
                      <th className="p-1 border-r border-b text-gray-600">Esf.</th><th className="p-1 border-r border-b text-gray-600">Cil.</th><th className="p-1 border-r border-b text-gray-600">Eje</th><th className="p-1 border-r border-b text-gray-600">Adi.</th><th className="p-1 border-r border-b text-teal-700">A.V.CC</th>
                      <th className="p-1 border-r border-b text-gray-600">Esf.</th><th className="p-1 border-r border-b text-gray-600">Cil.</th><th className="p-1 border-r border-b text-gray-600">Eje</th><th className="p-1 border-r border-b text-gray-600">Adi.</th><th className="p-1 border-b text-teal-700">A.V.CC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registrosPaciente.map(reg => (
                      <Fragment key={reg.id}>
                        <tr className={`border-b hover:bg-gray-50 transition-colors ${filasExpandidas[reg.id] ? 'bg-blue-50/30' : ''}`}>
                          <td className="p-2 border-r text-center">
                            <button onClick={() => toggleExpandir(reg.id)} className={`w-6 h-6 flex items-center justify-center rounded-full font-bold transition-all shadow-sm ${filasExpandidas[reg.id] ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}>
                              {filasExpandidas[reg.id] ? '−' : '＋'}
                            </button>
                          </td>
                          <td className="p-2 border-r font-bold text-gray-700">{safeString(reg.fecha)}</td>
                          <td className="p-2 border-r">{safeString(reg.esfera_od) || '—'}</td><td className="p-2 border-r">{safeString(reg.cilindro_od) || '—'}</td><td className="p-2 border-r">{safeString(reg.eje_od) || '—'}</td><td className="p-2 border-r">{safeString(reg.adicion_od) || '—'}</td><td className="p-2 border-r font-bold text-teal-700 bg-teal-50/30">{safeString(reg.avcc_od) || '-'}</td>
                          <td className="p-2 border-r">{safeString(reg.esfera_oi) || '—'}</td><td className="p-2 border-r">{safeString(reg.cilindro_oi) || '—'}</td><td className="p-2 border-r">{safeString(reg.eje_oi) || '—'}</td><td className="p-2 border-r">{safeString(reg.adicion_oi) || '—'}</td><td className="p-2 font-bold text-teal-700 bg-teal-50/30">{safeString(reg.avcc_oi) || '-'}</td>
                          
                          <td className="p-2 border-l text-center bg-red-50/20">
                            <button 
                              onClick={() => borrarHistoriaClinica(reg, () => setRegistrosPaciente(prev => prev.filter(r => r.id !== reg.id)))} 
                              className="text-xs bg-red-100 text-red-600 hover:bg-red-200 p-1.5 rounded font-bold transition-colors shadow-sm" 
                              title="Eliminar esta consulta clínica"
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                        
                        {filasExpandidas[reg.id] && (
                          <tr className="bg-slate-50 border-b shadow-inner">
                            <td colSpan="13" className="p-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs text-left">
                                
                                <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                                  <h4 className="font-bold text-teal-800 border-b border-gray-100 pb-1 mb-2">👓 Lensometría Anterior</h4>
                                  <p className="mb-1"><strong className="text-gray-500">OD:</strong> <span className="text-gray-800">{safeString(reg.lenso_esf_od)||'-'} | {safeString(reg.lenso_cil_od)||'-'} | {safeString(reg.lenso_eje_od)||'-'}</span></p>
                                  <p><strong className="text-gray-500">OI:</strong> <span className="text-gray-800">{safeString(reg.lenso_esf_oi)||'-'} | {safeString(reg.lenso_cil_oi)||'-'} | {safeString(reg.lenso_eje_oi)||'-'}</span></p>
                                </div>
                                
                                <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                                  <h4 className="font-bold text-blue-800 border-b border-gray-100 pb-1 mb-2">🤖 Autorrefractómetro</h4>
                                  <p className="mb-1"><strong className="text-gray-500">OD:</strong> <span className="text-gray-800">{safeString(reg.auto_esf_od)||'-'} | {safeString(reg.auto_cil_od)||'-'} | {safeString(reg.auto_eje_od)||'-'}</span></p>
                                  <p><strong className="text-gray-500">OI:</strong> <span className="text-gray-800">{safeString(reg.auto_esf_oi)||'-'} | {safeString(reg.auto_cil_oi)||'-'} | {safeString(reg.auto_eje_oi)||'-'}</span></p>
                                </div>
                                
                                <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                                  <h4 className="font-bold text-indigo-800 border-b border-gray-100 pb-1 mb-2">👁️ Queratometría</h4>
                                  <p className="mb-1"><strong className="text-gray-500">OD:</strong> <span className="text-gray-800">K1: {safeString(reg.k1_d_od)||'-'} | K2: {safeString(reg.k2_d_od)||'-'}</span></p>
                                  <p><strong className="text-gray-500">OI:</strong> <span className="text-gray-800">K1: {safeString(reg.k1_d_oi)||'-'} | K2: {safeString(reg.k2_d_oi)||'-'}</span></p>
                                </div>

                                <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                                  <h4 className="font-bold text-amber-800 border-b border-gray-100 pb-1 mb-2">📝 Notas Clínicas</h4>
                                  <p className="text-gray-700 italic">{safeString(reg.notas_clinicas) || 'Sin notas registradas en esta visita.'}</p>
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
                <h3 className="text-lg font-bold text-amber-900">🛒 Historial de Pedidos y Compras</h3>
              </div>
              <div className="overflow-x-auto shadow-sm border border-gray-200 rounded-lg">
                <table className="w-full text-left text-xs bg-white">
                  <thead className="bg-amber-50 text-amber-900 border-b">
                    <tr><th className="p-2 border-r">Fecha</th><th className="p-2 border-r">Armazón</th><th className="p-2 border-r">Lente / Tratamientos</th><th className="p-2 border-r text-center">Costo Final</th><th className="p-2 border-r text-center">Saldo Pendiente</th><th className="p-2 border-r text-center">Estado</th><th className="p-2 text-center">Gestión</th></tr>
                  </thead>
                  <tbody>
                    {registrosPaciente.filter(r => String(r.estado) !== 'Ninguno' || safeNum(r.venta) > 0 || safeString(r.codigo_armazon)).length > 0 ? (
                      registrosPaciente.filter(r => String(r.estado) !== 'Ninguno' || safeNum(r.venta) > 0 || safeString(r.codigo_armazon)).map(reg => {
                        {/* El total sale de calcularTotal() (reglas.js) y no de una
                            resta con float: con float, 250.50 @ 13% daba 217.93 y
                            el servidor 217.94. Este es el mismo centavo que
                            imprime el recibo, por eso ambos coinciden. */}
                        const vFinal = calcularTotal(reg.venta, reg.descuento);
                        const saldo = calcularSaldo(reg.venta, reg.descuento, reg.abono);
                        return (
                          <tr key={'venta-'+reg.id} className="border-b hover:bg-gray-50">
                            <td className="p-2 border-r font-bold text-gray-600">{safeString(reg.fecha)}</td>
                            <td className="p-2 border-r">{safeString(reg.codigo_armazon) === '2905' ? 'Del Paciente' : (safeString(reg.codigo_armazon) || '-')}</td>
                            <td className="p-2 border-r text-[10px] text-gray-600"><span className="font-bold">{safeString(reg.tipo_lente) || '-'}</span><br/>{reg.tratam_ar === 'SI' && ' +AR'} {reg.tratam_ar_azul === 'SI' && ' +AR Azul'} {reg.tratam_azul === 'SI' && ' +Filtro Azul'} {reg.tratam_foto === 'SI' && ' +Foto'}</td>
                            <td className="p-2 border-r text-center font-bold text-gray-800">${vFinal.toFixed(2)}</td>
                            <td className={`p-2 border-r text-center font-black ${saldo > 0 ? 'text-red-500' : 'text-green-500'}`}>${Math.max(0, saldo).toFixed(2)}</td>
                            <td className="p-2 border-r text-center"><span className={`px-2 py-1 rounded-full text-[10px] font-bold ${reg.estado === 'Entregado' ? 'bg-green-100 text-green-800' : reg.estado === 'Listo para Entrega' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>{safeString(reg.estado)}</span></td>
                            <td className="p-2 text-center"><button onClick={() => abrirPedido(reg)} className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded font-bold hover:bg-indigo-200">Ver / Cobrar</button></td>
                          </tr>
                        )
                      })
                    ) : ( <tr><td colSpan="7" className="p-6 text-center text-gray-400 font-medium">Sin compras registradas.</td></tr> )}
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
    <div className="bg-white rounded-xl shadow-lg p-6 border-t-4 border-blue-600">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Resumen e Historia de Pacientes</h2>
          <p className="text-xs text-gray-500">Búsqueda rápida. Muestra la última visita de cada paciente.</p>
        </div>
        
        <button onClick={crearNuevoPaciente} className="bg-teal-600 hover:bg-teal-700 text-white px-5 py-2.5 rounded-lg font-bold shadow-md transition-colors flex items-center gap-2">
          ➕ Registrar Nuevo Paciente
        </button>
      </div>

      <div className="flex gap-3 mb-6">
        <input 
          type="text" 
          placeholder="🔍 Escribe mínimo 2 letras de Cédula, Nombre o Alias..." 
          value={busquedaTexto} 
          onChange={(e) => setBusquedaTexto(e.target.value)} 
          className="flex-1 p-3 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500 shadow-sm text-sm font-medium bg-gray-50 focus:bg-white" 
        />
        {buscando && hayTermino && <div className="flex items-center text-xs font-bold text-blue-600 px-3">Buscando... ☁️</div>}
      </div>

      <div className="space-y-6">
        {filasVisibles.map(item => {
          try {
            const diagnosticos = generarDiagnosticos(item);
            const desc = safeNum(item.descuento);
            const vta = safeNum(item.venta);
            const abono = safeNum(item.abono);
            const vFinal = calcularTotal(vta, desc);
            // El saldo se calcula SIEMPRE con los datos locales de la venta. Antes
            // se preferia `deuda_total` (cache del servidor) y, al anular o borrar
            // una venta, ese valor se quedaba pegado: el historial seguia
            // mostrando "SALDO PENDIENTE" de algo ya cobrado o eliminado.
            const saldoPendiente = calcularSaldo(vta, desc, abono);
            const tieneDeuda = saldoPendiente > 0;
            // Solo hay pedido si existe una venta. Sin esta comprobacion, una
            // consulta clinica sin venta aparecia como pedido porque el servidor
            // le asigna el estado 'En laboratorio' por defecto.
            const tienePedido = Boolean(safeString(item.pedido_id).trim())
              || Number(item.venta || 0) > 0
              || String(item.codigo_armazon || '').trim() !== ''
              || String(item.accesorio_id || '').trim() !== '';
            
            return (
              <div key={item.id} className="border border-gray-200 bg-white p-6 rounded-2xl shadow-sm hover:shadow-md transition-all">
                
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center border-b border-gray-100 pb-4 mb-4 mt-2">
                  <div className="flex items-center gap-4 mb-4 xl:mb-0">
                    <div className="bg-blue-100 text-blue-700 p-3 rounded-full hidden md:block">👤</div>
                    <div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-extrabold text-xl text-gray-800">{safeString(item.nombre) || 'Sin Nombre'}</h3>
                        {tieneDeuda && (
                          <span className="bg-red-100 text-red-700 px-3 py-0.5 rounded-full text-[11px] font-black border border-red-300 shadow-sm animate-pulse flex items-center gap-1">
                            ⚠️ SALDO PENDIENTE: ${saldoPendiente.toFixed(2)}
                          </span>
                        )}
                      </div>
                      
                      {safeString(item.alias) && (
                        <div className="mt-1 flex items-center">
                          <button 
                            onClick={() => toggleAlias(item.id)} 
                            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold transition-all shadow-sm border ${aliasVisibles[item.id] ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-teal-50 hover:text-teal-600'}`}
                            title="Clic para ver/ocultar Alias"
                          >
                            🏷️ {aliasVisibles[item.id] ? safeString(item.alias) : 'Alias'}
                          </button>
                        </div>
                      )}
                      
                      <p className="text-sm text-gray-500 font-medium mt-1 flex flex-wrap gap-4">
                        {item.cedula && <span>🆔 {safeString(item.cedula)}</span>}
                        {item.telefono && <span>📱 {safeString(item.telefono)}</span>}
                        {item.fecha_nacimiento && <span>🎂 {calcularEdad(item.fecha_nacimiento)} años</span>}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 w-full xl:w-auto">
                    <button onClick={() => abrirExpedienteCompleto(item)} className="text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg font-bold shadow-sm hover:bg-indigo-100 transition-colors flex items-center gap-1">🗂️ Ver Evolución</button>
                    <button onClick={() => enviarWhatsApp(item)} className="text-sm bg-green-500 text-white px-3 py-1.5 rounded-lg font-medium shadow-sm hover:bg-green-600 transition-colors">💬 WhatsApp</button>
                    
                    <div className="flex gap-1 border border-gray-300 rounded-lg overflow-hidden shadow-sm">
                      <button onClick={() => imprimirInforme(item)} className="text-sm bg-gray-100 text-gray-800 px-3 py-1.5 font-medium hover:bg-gray-200 transition-colors">📄 Informe</button>
                      <button onClick={() => imprimirRecetaSimple(item)} className="text-sm bg-gray-100 text-gray-800 px-3 py-1.5 font-medium border-l border-gray-300 hover:bg-gray-200 transition-colors">📝 Receta</button>
                    </div>
                    
                    <button onClick={() => cargarParaEditarClinico(item)} className="text-sm bg-blue-50 text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg font-medium shadow-sm hover:bg-blue-100 transition-colors" title="Editar Clínica">✏️</button>
                    <button onClick={() => borrarHistoriaClinica(item)} className="text-sm bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg font-medium shadow-sm hover:bg-red-100 transition-colors" title="Borrar">🗑️</button>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 shadow-inner">
                    <div className="flex justify-between items-center mb-3">
                      <strong className="text-blue-900 text-base">Última RX Clínica</strong>
                      <span className="text-xs text-gray-500 font-medium bg-white px-2 py-1 rounded border">📅 {safeString(item.fecha)} ({calcularTiempoTranscurrido(item.fecha)})</span>
                    </div>
                    <table className="w-full text-center text-sm bg-white rounded border overflow-hidden">
                      <thead className="bg-blue-50/50 text-gray-600"><tr><th className="p-2 border-b border-r"></th><th className="p-2 border-b border-r">Esf.</th><th className="p-2 border-b border-r">Cil.</th><th className="p-2 border-b border-r">Eje</th><th className="p-2 border-b">Adi.</th></tr></thead>
                      <tbody>
                        <tr><td className="p-2 border-b border-r font-bold">OD</td><td className="p-2 border-b border-r">{safeString(item.esfera_od) || '—'}</td><td className="p-2 border-b border-r">{safeString(item.cilindro_od) || '—'}</td><td className="p-2 border-b border-r">{safeString(item.eje_od) || '—'}</td><td className="p-2 border-b">{safeString(item.adicion_od) || '—'}</td></tr>
                        <tr><td className="p-2 border-r font-bold">OI</td><td className="p-2 border-r">{safeString(item.esfera_oi) || '—'}</td><td className="p-2 border-r">{safeString(item.cilindro_oi) || '—'}</td><td className="p-2 border-r">{safeString(item.eje_oi) || '—'}</td><td className="p-2">{safeString(item.adicion_oi) || '—'}</td></tr>
                      </tbody>
                    </table>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {diagnosticos.map((d, i) => (<span key={i} className="bg-teal-50 text-teal-700 border border-teal-200 px-3 py-1 rounded-full text-xs font-bold tracking-wide shadow-sm">{d}</span>))}
                    </div>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 shadow-inner flex flex-col justify-between">
                    <div>
                      <strong className="text-gray-800 text-base mb-2 block">Último Detalle Comercial / Pedido</strong>
                      {tienePedido ? (
                        <>
                          <p className="text-gray-600 text-sm italic mb-1">Cod Armazón: {safeString(item.codigo_armazon)||'-'} | Lente: {safeString(item.tipo_lente)||'-'} {item.material_lente ? `(${item.material_lente})` : ''}</p>
                          <p className="text-gray-500 text-xs mb-3">Pago: {safeString(item.forma_pago)||'-'} {item.pago_nota ? `(${safeString(item.pago_nota)})`:''} | Notas: {safeString(item.notas) || 'Ninguna'}</p>
                          <div className="flex gap-2">
                            <span className={`px-3 py-1 rounded-full text-xs font-bold shadow-sm ${item.estado === 'Entregado' ? 'bg-green-100 text-green-800' : item.estado === 'Listo para Entrega' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>{safeString(item.estado)}</span>
                            {item.comprobante_url && (
                              <BotonComprobante
                                ruta={item.comprobante_url}
                                refId={item.pedido_id || item.id}
                                className="text-xs bg-indigo-50 text-indigo-700 font-bold px-2 py-1 rounded-full border border-indigo-200 hover:bg-indigo-100 flex items-center shadow-sm"
                              />
                            )}
                          </div>
                        </>
                      ) : (
                         <p className="text-gray-400 text-sm font-bold py-4">No hay pedido registrado en esta fecha.</p>
                      )}
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-200 flex justify-between items-end">
                      <div>
                        {tienePedido && (
                          <>
                            <span className="block text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Costo Final</span>
                            <span className="text-lg font-black text-gray-800">${vFinal.toFixed(2)}</span>
                            {desc > 0 && <span className="text-xs text-green-600 ml-2">(-{desc}%)</span>}
                          </>
                        )}
                      </div>
                      <button onClick={() => abrirPedido(item)} className="text-xs text-indigo-600 bg-indigo-100 px-3 py-1.5 rounded-lg hover:bg-indigo-200 font-bold transition-colors">{tienePedido ? 'Ver / Editar Venta' : '➕ Crear Venta'}</button>
                    </div>
                  </div>
                </div>
              </div>
            )
          } catch {
            return <div key={item?.id || item?.cedula || 'paciente-error'} className="bg-red-50 p-4 rounded-xl text-red-600 font-bold border border-red-200 mb-4">Error visual.</div>
          }
        })}

        {pacientesAgrupados.length > filasPorMostrar && (
          <div className="text-center">
            <button
              onClick={() => setVisibles(v => v + INCREMENTO)}
              className="px-6 py-3 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 shadow transition-colors"
            >
              Ver más ({pacientesAgrupados.length - visibles} restantes)
            </button>
            <p className="text-xs text-gray-400 mt-2">
              Mostrando {visibles} de {pacientesAgrupados.length}. Usa el buscador para encontrar uno concreto.
            </p>
          </div>
        )}
        
        {pacientesAgrupados.length === 0 && (
          <div className="text-center bg-white p-10 rounded-xl border border-dashed border-gray-300">
            <p className="text-gray-500 font-bold text-lg mb-2">
              {busquedaTexto.trim().length >= 2 ? "No se encontraron pacientes en la base de datos." : "Busca pacientes en la nube usando el buscador superior."}
            </p>
            {busquedaTexto.trim().length >= 2 && (
              <button onClick={crearNuevoPaciente} className="mt-4 bg-teal-600 text-white px-8 py-3 rounded-lg font-bold shadow-md hover:bg-teal-700 transition-colors">
                ➕ Registrar como Nuevo Paciente
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

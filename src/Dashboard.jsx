import { useState, useMemo } from 'react';
import { safeNum, safeString } from './utilidades';
import { nombreDelMes, nombreCortoDelMes } from './fechas.js';

export default function Dashboard({ stats, historial, inventario }) {
  const [periodo, setPeriodo] = useState('total'); // Por defecto 'total' para ver tu histórico completo

  const { topArmazones, topLentes, topTratamientos, alertasStock } = useMemo(() => {
    const armazonesVendidos = {};
    const lentesVendidos = {};
    const tratamientos = {
      'AR Verde': 0, 'AR Azul': 0, 'Filtro Azul': 0, 
      'Fotocromático': 0, 'Transition': 0, 'Tinturado': 0
    };

    for (const item of (historial || [])) {
      if (!item) continue;
      if (safeString(item.estado).trim().toLowerCase() === 'anulado') continue;
      const tieneVenta = safeString(item.estado) !== 'Ninguno' || safeNum(item.venta) > 0 || safeString(item.pedido_id);
      if (!tieneVenta) continue;

      const codArmazon = safeString(item.codigo_armazon).toUpperCase().trim();
      if (codArmazon && codArmazon !== '2905') {
        armazonesVendidos[codArmazon] = (armazonesVendidos[codArmazon] || 0) + 1;
      }

      const tipoLente = safeString(item.tipo_lente);
      if (tipoLente) {
        lentesVendidos[tipoLente] = (lentesVendidos[tipoLente] || 0) + 1;
      }

      if (item.tratam_ar === 'SI') tratamientos['AR Verde']++;
      if (item.tratam_ar_azul === 'SI') tratamientos['AR Azul']++;
      if (item.tratam_azul === 'SI') tratamientos['Filtro Azul']++;
      if (item.tratam_foto === 'SI') tratamientos['Fotocromático']++;
      if (item.tratam_trans === 'SI') tratamientos['Transition']++;
      if (item.tratam_tinturado === 'SI') tratamientos['Tinturado']++;
    }

    return {
      topArmazones: Object.entries(armazonesVendidos).sort((a, b) => b[1] - a[1]).slice(0, 5),
      topLentes: Object.entries(lentesVendidos).sort((a, b) => b[1] - a[1]),
      topTratamientos: Object.entries(tratamientos).sort((a, b) => b[1] - a[1]).filter(t => t[1] > 0),
      alertasStock: (inventario || []).filter(i => safeNum(i.stock) <= 2 && safeString(i.categoria) === 'Accesorio')
    };
  }, [historial, inventario]);

  const esMesActual = periodo === 'mes';
  // La etiqueta se calcula con la fecha REAL del sistema, no con un texto fijo.
  const etiquetaMes = useMemo(() => nombreDelMes(), []);
  const etiquetaMesCorta = useMemo(() => nombreCortoDelMes(), []);
  const ingresos = esMesActual ? (stats?.ventasMes || 0) : (stats?.ventasTotal || 0);
  const costos = esMesActual ? (stats?.gastosMes || 0) : (stats?.gastosTotal || 0);
  const utilidad = esMesActual ? (stats?.utilidadNeta || 0) : (stats?.utilidadTotal || 0);
  const abonosPend = stats?.abonosPendientes || 0;

  return (
    <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 border-t-4 border-amber-500">
      
      <div className="mb-6 sm:mb-8 border-b pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">📊 Panel de Inteligencia de Negocios</h2>
          <p className="text-gray-600 text-xs sm:text-sm">
            {esMesActual ? `Viendo resultados del mes de ${etiquetaMes}.` : 'Viendo resultados acumulados históricos.'}
          </p>
        </div>

        {/* Selector de periodo */}
        <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200">
          <button
            type="button"
            onClick={() => setPeriodo('mes')}
            className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              esMesActual ? 'bg-white text-teal-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            📅 {etiquetaMes} (Mes Actual)
          </button>
          <button
            type="button"
            onClick={() => setPeriodo('total')}
            className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              !esMesActual ? 'bg-white text-indigo-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            🏦 Histórico Total Acumulado
          </button>
        </div>
      </div>

      <h3 className="font-bold text-amber-900 mb-3 sm:mb-4 uppercase tracking-wider text-xs sm:text-sm">
        Resumen Estratégico {esMesActual ? `(Mes Actual: ${etiquetaMes})` : '(Histórico Total)'}
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-8 sm:mb-10">
        
        <div className="col-span-2 lg:col-span-1 bg-gradient-to-br from-indigo-50 to-indigo-100 p-4 sm:p-5 rounded-xl border border-indigo-200 shadow-sm flex flex-col justify-between">
          <p className="text-indigo-900 font-bold text-xs uppercase tracking-tight flex items-center gap-1"><span>👥</span> Total Pacientes</p>
          <p className="text-2xl sm:text-3xl font-black text-indigo-950 mt-2">{stats?.totalPacientes || 0}</p>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 sm:p-5 rounded-xl border border-green-200 shadow-sm flex flex-col justify-between">
          <p className="text-emerald-900 font-bold text-xs uppercase tracking-tight">
            {esMesActual ? `Ingresos Mes (${etiquetaMesCorta})` : 'Ingresos Totales'}
          </p>
          <p className="text-2xl sm:text-3xl font-black text-emerald-950 mt-2">${ingresos.toFixed(2)}</p>
        </div>
        
        <div className="bg-gradient-to-br from-red-50 to-red-100 p-4 sm:p-5 rounded-xl border border-red-200 shadow-sm flex flex-col justify-between">
          <p className="text-red-900 font-bold text-xs uppercase tracking-tight">
            {esMesActual ? `Costos Lab. (${etiquetaMesCorta})` : 'Costos Totales'}
          </p>
          <p className="text-2xl sm:text-3xl font-black text-red-950 mt-2">${costos.toFixed(2)}</p>
        </div>
        
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 sm:p-5 rounded-xl border border-blue-200 shadow-sm flex flex-col justify-between">
          <p className="text-blue-900 font-bold text-xs uppercase tracking-tight">Utilidad Neta</p>
          <p className="text-2xl sm:text-3xl font-black text-blue-950 mt-2">${utilidad.toFixed(2)}</p>
        </div>
        
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-4 sm:p-5 rounded-xl border border-amber-200 shadow-sm flex flex-col justify-between">
          <p className="text-amber-900 font-bold text-xs uppercase tracking-tight">Abonos Pend.</p>
          <p className="text-2xl sm:text-3xl font-black text-amber-950 mt-2">${abonosPend.toFixed(2)}</p>
        </div>
      </div>

      <h3 className="font-bold text-amber-900 mb-3 sm:mb-4 uppercase tracking-wider text-xs sm:text-sm">Analítica de Productos y Preferencias</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-8 sm:mb-10">
        
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-5">
          <h4 className="font-bold text-gray-900 border-b pb-2 mb-4 flex justify-between text-sm sm:text-base">
            <span>🔥 Top 5 Armazones</span>
          </h4>
          {topArmazones.length > 0 ? (
            <ul className="space-y-2.5 sm:space-y-3">
              {topArmazones.map((item, index) => (
                <li key={index} className="flex justify-between items-center bg-gray-50 p-2 sm:p-2.5 rounded-lg border border-gray-200">
                  <span className="font-bold text-gray-800 text-xs sm:text-sm">#{index + 1} {item[0]}</span>
                  <span className="bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-full text-xs font-black">{item[1]} unid.</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 text-xs sm:text-sm text-center py-4">No hay datos de ventas de armazones aún.</p>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-5">
          <h4 className="font-bold text-gray-900 border-b pb-2 mb-4 flex justify-between text-sm sm:text-base">
            <span>✨ Tratamientos Estrella</span>
          </h4>
          {topTratamientos.length > 0 ? (
            <ul className="space-y-3">
              {topTratamientos.map((item, index) => (
                <li key={index} className="flex justify-between items-center">
                  <span className="font-semibold text-gray-800 text-xs sm:text-sm">{item[0]}</span>
                  <div className="flex-1 mx-2 sm:mx-3 h-2.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                    <div className="h-full bg-teal-600 rounded-full" style={{ width: `${(item[1] / topTratamientos[0][1]) * 100}%` }}></div>
                  </div>
                  <span className="text-teal-900 font-black text-xs sm:text-sm">{item[1]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 text-xs sm:text-sm text-center py-4">No hay datos de tratamientos aún.</p>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-5">
          <h4 className="font-bold text-gray-900 border-b pb-2 mb-4 flex justify-between text-sm sm:text-base">
            <span>👁️ Tipos de Lente Frecuentes</span>
          </h4>
          {topLentes.length > 0 ? (
            <ul className="space-y-2.5 sm:space-y-3">
              {topLentes.map((item, index) => (
                <li key={index} className="flex justify-between items-center bg-indigo-50 p-2 sm:p-2.5 rounded-lg border border-indigo-100">
                  <span className="font-bold text-indigo-950 text-xs sm:text-sm">{item[0]}</span>
                  <span className="text-indigo-800 font-black text-xs sm:text-sm">{item[1]} rec.</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 text-xs sm:text-sm text-center py-4">No hay datos de lentes aún.</p>
          )}
        </div>

      </div>

      <h3 className="font-bold text-red-900 mb-3 sm:mb-4 uppercase tracking-wider text-xs sm:text-sm">Alertas Operativas</h3>
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 sm:p-5">
        <h4 className="font-bold text-red-900 mb-3 flex items-center gap-2 text-sm sm:text-base">⚠️ Accesorios con Stock Bajo (2 o menos unidades)</h4>
        {alertasStock.length > 0 ? (
          <div className="flex flex-wrap gap-2.5 sm:gap-3">
            {alertasStock.map(item => (
              <div key={item.id} className="bg-white border border-red-300 px-3 py-2 rounded-lg shadow-sm text-xs sm:text-sm">
                <span className="font-black text-gray-900 block uppercase">{safeString(item.nombre_accesorio) || 'Accesorio sin nombre'}</span>
                <span className="text-xs text-gray-600 font-medium">{safeString(item.caracteristica)}</span>
                <span className="text-red-700 font-black block mt-1">Quedan: {item.stock}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-green-800 font-bold text-xs sm:text-sm">✅ Todo el inventario de accesorios tiene niveles óptimos.</p>
        )}
      </div>

    </div>
  );
}
import { safeNum, safeString } from './utilidades';

export default function Dashboard({ stats, historial, inventario }) {
  
  // --- 1. PROCESAMIENTO DE DATOS ANALÍTICOS ---
  const armazonesVendidos = {};
  const lentesVendidos = {};
  const tratamientos = {
    'AR Verde': 0, 'AR Azul': 0, 'Filtro Azul': 0, 
    'Fotocromático': 0, 'Transition': 0, 'Tinturado': 0
  };

  // Recorremos el historial para contar qué es lo que más se ha vendido
  (historial || []).forEach(item => {
    const tieneVenta = safeString(item.estado) !== 'Ninguno' || safeNum(item.venta) > 0;
    
    if (tieneVenta) {
      // Conteo de Armazones (Ignoramos el 2905 que es armazón del paciente)
      const codArmazon = safeString(item.codigo_armazon).toUpperCase().trim();
      if (codArmazon && codArmazon !== '2905') {
        armazonesVendidos[codArmazon] = (armazonesVendidos[codArmazon] || 0) + 1;
      }

      // Conteo de Lentes
      const tipoLente = safeString(item.tipo_lente);
      if (tipoLente) {
        lentesVendidos[tipoLente] = (lentesVendidos[tipoLente] || 0) + 1;
      }

      // Conteo de Tratamientos
      if (item.tratam_ar === 'SI') tratamientos['AR Verde']++;
      if (item.tratam_ar_azul === 'SI') tratamientos['AR Azul']++;
      if (item.tratam_azul === 'SI') tratamientos['Filtro Azul']++;
      if (item.tratam_foto === 'SI') tratamientos['Fotocromático']++;
      if (item.tratam_trans === 'SI') tratamientos['Transition']++;
      if (item.tratam_tinturado === 'SI') tratamientos['Tinturado']++;
    }
  });

  // Ordenamos los resultados de mayor a menor
  const topArmazones = Object.entries(armazonesVendidos).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topLentes = Object.entries(lentesVendidos).sort((a, b) => b[1] - a[1]);
  const topTratamientos = Object.entries(tratamientos).sort((a, b) => b[1] - a[1]).filter(t => t[1] > 0);

  // --- SOLUCIÓN: Inventario con Stock Bajo AHORA SOLO VIGILA ACCESORIOS ---
  const alertasStock = (inventario || []).filter(i => safeNum(i.stock) <= 2 && safeString(i.categoria) === 'Accesorio');

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border-t-4 border-amber-500">
      
      <div className="mb-8 border-b pb-4">
        <h2 className="text-2xl font-bold text-gray-800">📊 Panel de Inteligencia de Negocios</h2>
        <p className="text-gray-500 text-sm">Resumen financiero mensual y métricas de ventas históricas.</p>
      </div>

      {/* --- SECCIÓN 1: KPI FINANCIEROS Y DE NEGOCIO --- */}
      <h3 className="font-bold text-amber-800 mb-4 uppercase tracking-wider text-sm">Resumen Estratégico</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 mb-10">
        
        {/* TARJETA: TOTAL PACIENTES */}
        <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 p-5 rounded-xl border border-indigo-200 shadow-sm flex flex-col justify-between">
          <p className="text-indigo-800 font-bold text-xs uppercase tracking-tight flex items-center gap-1"><span>👥</span> Total Pacientes</p>
          <p className="text-3xl font-black text-indigo-600 mt-2">{stats?.totalPacientes || 0}</p>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 p-5 rounded-xl border border-green-200 shadow-sm flex flex-col justify-between">
          <p className="text-green-800 font-bold text-xs uppercase tracking-tight">Ingresos Mes</p>
          <p className="text-3xl font-black text-green-600 mt-2">${(stats?.ventasMes || 0).toFixed(2)}</p>
        </div>
        
        <div className="bg-gradient-to-br from-red-50 to-red-100 p-5 rounded-xl border border-red-200 shadow-sm flex flex-col justify-between">
          <p className="text-red-800 font-bold text-xs uppercase tracking-tight">Costos Lab.</p>
          <p className="text-3xl font-black text-red-600 mt-2">${(stats?.gastosMes || 0).toFixed(2)}</p>
        </div>
        
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-5 rounded-xl border border-blue-200 shadow-sm flex flex-col justify-between">
          <p className="text-blue-800 font-bold text-xs uppercase tracking-tight">Utilidad Neta</p>
          <p className="text-3xl font-black text-blue-600 mt-2">${(stats?.utilidadNeta || 0).toFixed(2)}</p>
        </div>
        
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-5 rounded-xl border border-amber-200 shadow-sm flex flex-col justify-between">
          <p className="text-amber-800 font-bold text-xs uppercase tracking-tight">Abonos Pend.</p>
          <p className="text-3xl font-black text-amber-600 mt-2">${(stats?.abonosPendientes || 0).toFixed(2)}</p>
        </div>
      </div>

      {/* --- SECCIÓN 2: ANALÍTICA DE PRODUCTOS --- */}
      <h3 className="font-bold text-amber-800 mb-4 uppercase tracking-wider text-sm">Analítica de Productos y Preferencias</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        
        {/* TOP Armazones */}
        <div className="bg-white border rounded-xl shadow-sm p-5">
          <h4 className="font-bold text-gray-800 border-b pb-2 mb-4 flex justify-between">
            <span>🔥 Top 5 Armazones</span>
          </h4>
          {topArmazones.length > 0 ? (
            <ul className="space-y-3">
              {topArmazones.map((item, index) => (
                <li key={index} className="flex justify-between items-center bg-gray-50 p-2 rounded border">
                  <span className="font-bold text-gray-700">#{index + 1} {item[0]}</span>
                  <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-xs font-black">{item[1]} unid.</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm text-center py-4">No hay datos de ventas de armazones aún.</p>
          )}
        </div>

        {/* TOP Tratamientos */}
        <div className="bg-white border rounded-xl shadow-sm p-5">
          <h4 className="font-bold text-gray-800 border-b pb-2 mb-4 flex justify-between">
            <span>✨ Tratamientos Estrella</span>
          </h4>
          {topTratamientos.length > 0 ? (
            <ul className="space-y-3">
              {topTratamientos.map((item, index) => (
                <li key={index} className="flex justify-between items-center">
                  <span className="font-medium text-gray-600 text-sm">{item[0]}</span>
                  <div className="flex-1 mx-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-teal-500" style={{ width: `${(item[1] / topTratamientos[0][1]) * 100}%` }}></div>
                  </div>
                  <span className="text-teal-700 font-bold text-sm">{item[1]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm text-center py-4">No hay datos de tratamientos aún.</p>
          )}
        </div>

        {/* TOP Lentes */}
        <div className="bg-white border rounded-xl shadow-sm p-5">
          <h4 className="font-bold text-gray-800 border-b pb-2 mb-4 flex justify-between">
            <span>👁️ Tipos de Lente Frecuentes</span>
          </h4>
          {topLentes.length > 0 ? (
            <ul className="space-y-3">
              {topLentes.map((item, index) => (
                <li key={index} className="flex justify-between items-center bg-indigo-50 p-2 rounded border border-indigo-100">
                  <span className="font-bold text-indigo-900 text-sm">{item[0]}</span>
                  <span className="text-indigo-600 font-black text-sm">{item[1]} rec.</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm text-center py-4">No hay datos de lentes aún.</p>
          )}
        </div>

      </div>

      {/* --- SECCIÓN 3: ALERTAS DE INVENTARIO (AHORA SOLO ACCESORIOS) --- */}
      <h3 className="font-bold text-red-800 mb-4 uppercase tracking-wider text-sm">Alertas Operativas</h3>
      <div className="bg-red-50 border border-red-200 rounded-xl p-5">
        <h4 className="font-bold text-red-800 mb-3 flex items-center gap-2">⚠️ Accesorios con Stock Bajo (2 o menos unidades)</h4>
        {alertasStock.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {alertasStock.map(item => (
              <div key={item.id} className="bg-white border border-red-300 px-3 py-2 rounded-lg shadow-sm text-sm">
                <span className="font-black text-gray-800 block uppercase">{safeString(item.nombre_accesorio) || 'Accesorio sin nombre'}</span>
                <span className="text-xs text-gray-500">{safeString(item.caracteristica)}</span>
                <span className="text-red-600 font-bold block mt-1">Quedan: {item.stock}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-green-700 font-bold text-sm">✅ Todo el inventario de accesorios tiene niveles óptimos.</p>
        )}
      </div>

    </div>
  );
}
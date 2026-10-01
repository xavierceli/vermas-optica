import { safeString, safeNum } from './utilidades'

export default function Tarifario({
  nuevoPrecio, setNuevoPrecio, precioInicial, editandoPrecioId, setEditandoPrecioId,
  manejarCambioPrecio, guardarPrecio, busquedaPrecio, setBusquedaPrecio,
  listaPreciosFiltrada, cargarParaEditarPrecio, eliminarPrecio
}) {
  return (
    <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 border-t-4 border-emerald-600 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">🏷️ Lista de Precios Sugeridos</h2>
          <p className="text-xs sm:text-sm text-gray-600">Consulta y registra tus tarifas base por tipo de lente, material, tratamiento y rango dióptrico.</p>
        </div>
        {editandoPrecioId && (
          <button 
            type="button"
            onClick={() => { setNuevoPrecio(precioInicial); setEditandoPrecioId(null); }} 
            className="w-full sm:w-auto bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg font-bold text-xs sm:text-sm transition-colors"
          >
            Cancelar Edición
          </button>
        )}
      </div>

      <div className="bg-emerald-50/60 p-4 sm:p-5 rounded-xl border border-emerald-200">
        <h3 className="font-bold text-emerald-950 mb-3 text-sm sm:text-base">
          {editandoPrecioId ? '✏️ Editar Tarifa Sugerida' : '➕ Agregar Nueva Tarifa Sugerida'}
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-3">
          <div>
            <label htmlFor="tf-tipo-lente" className="block text-xs font-bold text-gray-800 mb-1">Tipo de Lente</label>
            <select id="tf-tipo-lente" name="tipo_lente" value={nuevoPrecio.tipo_lente} onChange={manejarCambioPrecio} className="w-full p-2 bg-white border border-emerald-300 rounded-lg outline-none text-xs sm:text-sm font-semibold text-gray-900">
              <option value="Monofocal">Monofocal</option>
              <option value="Bifocal">Bifocal</option>
              <option value="Ocupacional">Ocupacional</option>
              <option value="Progresivo">Progresivo</option>
              <option value="Lente de Contacto">Lente de Contacto</option>
            </select>
          </div>

          <div>
            <label htmlFor="tf-material" className="block text-xs font-bold text-gray-800 mb-1">Material</label>
            <select id="tf-material" name="material" value={nuevoPrecio.material} onChange={manejarCambioPrecio} className="w-full p-2 bg-white border border-emerald-300 rounded-lg outline-none text-xs sm:text-sm font-semibold text-gray-900">
              <option value="Plástico">Plástico (CR-39)</option>
              <option value="Policarbonato">Policarbonato</option>
              <option value="Reducido (1.61/1.67)">Reducido (1.61/1.67)</option>
              <option value="Hiperreducido (1.74)">Hiperreducido (1.74)</option>
              <option value="Mineral / Vidrio">Mineral / Vidrio</option>
              <option value="Otros">Otros</option>
            </select>
          </div>

          <div>
            <label htmlFor="tf-tratamiento" className="block text-xs font-bold text-gray-800 mb-1">Tratamiento</label>
            <select id="tf-tratamiento" name="tratamiento" value={nuevoPrecio.tratamiento} onChange={manejarCambioPrecio} className="w-full p-2 bg-white border border-emerald-300 rounded-lg outline-none text-xs sm:text-sm font-semibold text-gray-900">
              <option value="Ninguno / Blanco">Ninguno / Blanco</option>
              <option value="Antirreflejo Verde">Antirreflejo Verde</option>
              <option value="Antirreflejo Azul">Antirreflejo Azul</option>
              <option value="Filtro Azul (Blue Block)">Filtro Azul (Blue Block)</option>
              <option value="Fotocromático">Fotocromático</option>
              <option value="Transition">Transition</option>
              <option value="Tinturado">Tinturado</option>
              <option value="Polarizado">Polarizado</option>
            </select>
          </div>

          <div>
            <label htmlFor="tf-rango" className="block text-xs font-bold text-gray-800 mb-1">Rango Dióptrico / Graduación</label>
            <input id="tf-rango" name="rango_medida" value={nuevoPrecio.rango_medida} onChange={manejarCambioPrecio} type="text" className="w-full p-2 bg-white border border-emerald-300 rounded-lg outline-none text-xs sm:text-sm text-gray-900" placeholder="Ej: Esf 0 a +/-2.00 / Cil -2" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 items-end">
          <div>
            <label htmlFor="tf-costo-lab" className="block text-xs font-bold text-red-800 mb-1">Costo Laboratorio ($)</label>
            <input id="tf-costo-lab" name="costo_laboratorio" value={nuevoPrecio.costo_laboratorio} onChange={manejarCambioPrecio} type="number" className="w-full p-2 bg-white border border-red-300 rounded-lg outline-none text-xs sm:text-sm font-bold text-red-700" placeholder="Ej: 12.00" />
          </div>

          <div>
            <label htmlFor="tf-precio-sug" className="block text-xs font-bold text-emerald-900 mb-1">Precio Venta Sugerido ($)</label>
            <input id="tf-precio-sug" name="precio_sugerido" value={nuevoPrecio.precio_sugerido} onChange={manejarCambioPrecio} type="number" className="w-full p-2 bg-white border border-emerald-400 rounded-lg outline-none text-xs sm:text-sm font-bold text-emerald-800" placeholder="Ej: 45.00" />
          </div>

          <div>
            <label htmlFor="tf-notas" className="block text-xs font-bold text-gray-800 mb-1">Notas / Laboratorio</label>
            <input id="tf-notas" name="notas" value={nuevoPrecio.notas} onChange={manejarCambioPrecio} type="text" className="w-full p-2 bg-white border border-emerald-300 rounded-lg outline-none text-xs sm:text-sm text-gray-900" placeholder="Ej: Lab Servióptica / 3 días" />
          </div>

          <div>
            <button 
              type="button" 
              onClick={guardarPrecio} 
              className="w-full p-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-lg text-xs sm:text-sm shadow-md transition-all"
            >
              {editandoPrecioId ? '💾 Actualizar Tarifa' : '➕ Guardar en Tarifario'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <input 
          type="text" 
          aria-label="Buscar tarifas registradas por lente, material, tratamiento o rango"
          placeholder="🔍 Buscar por Lente, Material, Tratamiento o Rango (Ej: Progresivo, Fotocromático)..." 
          value={busquedaPrecio} 
          onChange={(e) => setBusquedaPrecio(e.target.value)} 
          className="flex-1 p-2.5 sm:p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm text-xs sm:text-sm text-gray-900 bg-gray-50 focus:bg-white" 
        />
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm">
        <table className="w-full text-left border-collapse text-xs sm:text-sm min-w-[720px] bg-white">
          <thead>
            <tr className="bg-emerald-50 text-emerald-950 border-b border-emerald-200">
              <th className="p-3">Tipo de Lente</th>
              <th className="p-3">Material</th>
              <th className="p-3">Tratamiento</th>
              <th className="p-3">Rango / Medida</th>
              <th className="p-3 text-center">Costo Lab</th>
              <th className="p-3 text-center">P. Sugerido</th>
              <th className="p-3 text-center">Margen</th>
              <th className="p-3">Notas</th>
              <th className="p-3 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listaPreciosFiltrada.map((item) => {
              const cLab = safeNum(item.costo_laboratorio);
              const pSug = safeNum(item.precio_sugerido);
              const ganancia = pSug - cLab;
              return (
                <tr key={item.id} className="border-b hover:bg-emerald-50/40 transition-colors">
                  <td className="p-3 font-bold text-gray-900">{safeString(item.tipo_lente)}</td>
                  <td className="p-3 font-semibold text-gray-800">{safeString(item.material)}</td>
                  <td className="p-3">
                    <span className="bg-emerald-100 text-emerald-900 text-xs font-bold px-2 py-0.5 rounded border border-emerald-200">
                      {safeString(item.tratamiento)}
                    </span>
                  </td>
                  <td className="p-3 text-gray-700 font-mono text-xs">{safeString(item.rango_medida) || 'Estándar'}</td>
                  <td className="p-3 text-center text-red-700 font-bold">${cLab.toFixed(2)}</td>
                  <td className="p-3 text-center text-emerald-800 font-black text-sm sm:text-base">${pSug.toFixed(2)}</td>
                  <td className="p-3 text-center font-bold text-blue-900 text-xs sm:text-sm">+${ganancia.toFixed(2)}</td>
                  <td className="p-3 text-xs text-gray-700 italic">{safeString(item.notas) || '-'}</td>
                  <td className="p-3 text-center">
                    <div className="flex justify-center gap-1.5">
                      <button 
                        type="button" 
                        onClick={() => cargarParaEditarPrecio(item)} 
                        className="text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded font-bold hover:bg-emerald-100 transition-colors shadow-sm"
                      >
                        Editar
                      </button>
                      <button 
                        type="button" 
                        onClick={() => eliminarPrecio(item.id)} 
                        className="text-xs bg-white text-red-700 border border-red-200 px-2.5 py-1 rounded font-semibold hover:bg-red-50 transition-colors shadow-sm"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {listaPreciosFiltrada.length === 0 && (
              <tr>
                <td colSpan="9" className="p-8 text-center text-gray-500 font-semibold">
                  No hay tarifas registradas en la lista de precios. Agrega tu primer paquete arriba.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
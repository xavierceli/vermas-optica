import { safeString, safeNum } from './utilidades'

export default function Tarifario({
  nuevoPrecio, setNuevoPrecio, precioInicial, editandoPrecioId, setEditandoPrecioId,
  manejarCambioPrecio, guardarPrecio, busquedaPrecio, setBusquedaPrecio,
  listaPreciosFiltrada, cargarParaEditarPrecio, eliminarPrecio
}) {
  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border-t-4 border-emerald-600 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">🏷️ Lista de Precios Sugeridos</h2>
          <p className="text-sm text-gray-500">Consulta y registra tus tarifas base por tipo de lente, material, tratamiento y rango dióptrico.</p>
        </div>
        {editandoPrecioId && (
          <button onClick={() => { setNuevoPrecio(precioInicial); setEditandoPrecioId(null); }} className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg font-bold text-sm">
            Cancelar Edición
          </button>
        )}
      </div>

      {/* Formulario de Registro de Precios */}
      <div className="bg-emerald-50/50 p-5 rounded-xl border border-emerald-100">
        <h3 className="font-bold text-emerald-900 mb-3 text-sm">
          {editandoPrecioId ? '✏️ Editar Tarifa Sugerida' : '➕ Agregar Nueva Tarifa Sugerida'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Tipo de Lente</label>
            <select name="tipo_lente" value={nuevoPrecio.tipo_lente} onChange={manejarCambioPrecio} className="w-full p-2 bg-white border border-emerald-200 rounded-lg outline-none text-sm font-medium">
              <option value="Monofocal">Monofocal</option>
              <option value="Bifocal">Bifocal</option>
              <option value="Ocupacional">Ocupacional</option>
              <option value="Progresivo">Progresivo</option>
              <option value="Lente de Contacto">Lente de Contacto</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Material</label>
            <select name="material" value={nuevoPrecio.material} onChange={manejarCambioPrecio} className="w-full p-2 bg-white border border-emerald-200 rounded-lg outline-none text-sm font-medium">
              <option value="Plástico">Plástico (CR-39)</option>
              <option value="Policarbonato">Policarbonato</option>
              <option value="Reducido (1.61/1.67)">Reducido (1.61/1.67)</option>
              <option value="Hiperreducido (1.74)">Hiperreducido (1.74)</option>
              <option value="Mineral / Vidrio">Mineral / Vidrio</option>
              <option value="Otros">Otros</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Tratamiento</label>
            <select name="tratamiento" value={nuevoPrecio.tratamiento} onChange={manejarCambioPrecio} className="w-full p-2 bg-white border border-emerald-200 rounded-lg outline-none text-sm font-medium">
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
            <label className="block text-xs font-semibold text-gray-700 mb-1">Rango Dióptrico / Graduación</label>
            <input name="rango_medida" value={nuevoPrecio.rango_medida} onChange={manejarCambioPrecio} type="text" className="w-full p-2 bg-white border border-emerald-200 rounded-lg outline-none text-sm" placeholder="Ej: Esf 0 a +/-2.00 / Cil -2" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-bold text-red-700 mb-1">Costo Laboratorio ($)</label>
            <input name="costo_laboratorio" value={nuevoPrecio.costo_laboratorio} onChange={manejarCambioPrecio} type="number" className="w-full p-2 bg-white border border-red-300 rounded-lg outline-none text-sm font-bold text-red-700" placeholder="Ej: 12.00" />
          </div>

          <div>
            <label className="block text-xs font-bold text-emerald-800 mb-1">Precio Venta Sugerido ($)</label>
            <input name="precio_sugerido" value={nuevoPrecio.precio_sugerido} onChange={manejarCambioPrecio} type="number" className="w-full p-2 bg-white border border-emerald-300 rounded-lg outline-none text-sm font-bold text-emerald-700" placeholder="Ej: 45.00" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Notas / Laboratorio</label>
            <input name="notas" value={nuevoPrecio.notas} onChange={manejarCambioPrecio} type="text" className="w-full p-2 bg-white border border-emerald-200 rounded-lg outline-none text-sm" placeholder="Ej: Lab Servióptica / 3 días" />
          </div>

          <div>
            <button onClick={guardarPrecio} className="w-full p-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-sm shadow transition-colors">
              {editandoPrecioId ? '💾 Actualizar Tarifa' : '➕ Guardar en Tarifario'}
            </button>
          </div>
        </div>
      </div>

      {/* Buscador de Tarifas */}
      <div className="flex gap-3">
        <input type="text" placeholder="🔍 Buscar por Lente, Material, Tratamiento o Rango (Ej: Progresivo, Fotocromático)..." value={busquedaPrecio} onChange={(e) => setBusquedaPrecio(e.target.value)} className="flex-1 p-3 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm text-sm" />
      </div>

      {/* Tabla de Tarifas Registradas */}
      <div className="overflow-x-auto border rounded-lg shadow-sm">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-emerald-50 text-emerald-900 border-b">
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
                <tr key={item.id} className="border-b hover:bg-emerald-50/30 transition-colors">
                  <td className="p-3 font-bold text-gray-800">{safeString(item.tipo_lente)}</td>
                  <td className="p-3 font-medium text-gray-700">{safeString(item.material)}</td>
                  <td className="p-3"><span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-1 rounded">{safeString(item.tratamiento)}</span></td>
                  <td className="p-3 text-gray-600 font-mono text-xs">{safeString(item.rango_medida) || 'Estándar'}</td>
                  <td className="p-3 text-center text-red-600 font-bold">${cLab.toFixed(2)}</td>
                  <td className="p-3 text-center text-emerald-700 font-black text-base">${pSug.toFixed(2)}</td>
                  <td className="p-3 text-center font-bold text-blue-700 text-xs">+${ganancia.toFixed(2)}</td>
                  <td className="p-3 text-xs text-gray-500 italic">{safeString(item.notas) || '-'}</td>
                  <td className="p-3 text-center">
                    <div className="flex justify-center gap-1">
                      <button onClick={() => cargarParaEditarPrecio(item)} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded hover:bg-emerald-100 font-bold">Editar</button>
                      <button onClick={() => eliminarPrecio(item.id)} className="text-xs bg-white text-red-600 border border-red-200 px-2.5 py-1 rounded hover:bg-red-50">Eliminar</button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {listaPreciosFiltrada.length === 0 && (
              <tr>
                <td colSpan="9" className="p-8 text-center text-gray-400">
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
import { useMemo, useState } from 'react';
import {
  CAMPOS_DE_TRATAMIENTO,
  ETIQUETAS_DE_TRATAMIENTO,
  combosDelTarifario,
  filaDeCombo,
  resumenDelCombo
} from './combos';

// ---------------------------------------------------------------------------
// COMBOS EN EL TARIFARIO
// ---------------------------------------------------------------------------
// Alta, edicion y baja de paquetes promocionales. Se guardan como filas de
// `lista_precios` con tipo_lente = 'COMBO', asi que sincronizan y funcionan
// sin conexion con el mismo motor que las demas tarifas.
// ---------------------------------------------------------------------------

const VACIO = {
  id: null,
  nombre: '',
  precio: '',
  costo: '',
  topeArmazon: '',
  tipoLente: '',
  materialLente: '',
  nota: '',
  tratamientos: []
};

const OPCIONES_LENTE = ['Monofocal', 'Bifocal', 'Ocupacional', 'Progresivo', 'Lente de Contacto'];
const OPCIONES_MATERIAL = [
  'Plástico', 'Policarbonato', 'Reducido (1.61/1.67)',
  'Hiperreducido (1.74)', 'Mineral / Vidrio', 'Otros'
];

export default function CombosTarifario({
  listaPrecios = [],
  guardarCombo,
  eliminarPrecio,
  esAdmin = false
}) {
  const combos = useMemo(() => combosDelTarifario(listaPrecios), [listaPrecios]);
  const [form, setForm] = useState(VACIO);

  if (combos.length === 0 && !esAdmin) return null;

  const cambiar = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const alternarTratamiento = (campo) => {
    setForm(prev => ({
      ...prev,
      tratamientos: prev.tratamientos.includes(campo)
        ? prev.tratamientos.filter(c => c !== campo)
        : [...prev.tratamientos, campo]
    }));
  };

  const editar = (combo) => {
    setForm({
      id: combo.id,
      nombre: combo.nombre,
      precio: combo.precio,
      costo: combo.costo,
      topeArmazon: combo.config.topeArmazon ?? '',
      tipoLente: combo.config.tipoLente,
      materialLente: combo.config.materialLente,
      nota: combo.config.nota,
      tratamientos: [...combo.config.tratamientos]
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const guardar = async (e) => {
    e.preventDefault();
    const ok = await guardarCombo(filaDeCombo({ ...form, id: form.id || undefined }));
    if (ok) setForm(VACIO);
  };

  const eliminar = (combo) => {
    eliminarPrecio(
      combo.id,
      `¿Seguro que deseas eliminar el combo "${combo.nombre}"?`,
      'Combo eliminado localmente.'
    );
  };

  return (
    <section className="bg-amber-50/60 p-4 sm:p-5 rounded-xl border border-amber-200">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
        <div>
          <h3 className="font-bold text-amber-950 text-sm sm:text-base">🎁 Combos / Paquetes Promocionales</h3>
          <p className="text-xs text-amber-900">
            Precio cerrado: el armazón no se suma. El accesorio sí se cobra aparte.
          </p>
        </div>
        {form.id !== null && (
          <button
            type="button"
            onClick={() => setForm(VACIO)}
            className="w-full sm:w-auto bg-gray-500 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg font-bold text-xs transition-colors"
          >
            Cancelar edición
          </button>
        )}
      </div>

      {combos.length > 0 && (
        <ul className="mb-4 divide-y divide-amber-200 rounded-lg bg-white border border-amber-200">
          {combos.map(combo => (
            <li key={combo.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-gray-900 text-sm truncate">
                  {combo.nombre} · <span className="text-emerald-800">${combo.precio.toFixed(2)}</span>
                </p>
                <p className="text-xs text-gray-600">{resumenDelCombo(combo) || 'Sin detalle'}</p>
                <p className="text-[11px] text-red-700">Costo lab: ${combo.costo.toFixed(2)}</p>
              </div>
              {esAdmin && (
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => editar(combo)}
                    className="text-xs bg-amber-50 text-amber-900 border border-amber-300 px-2.5 py-1 rounded font-bold hover:bg-amber-100 transition-colors"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => eliminar(combo)}
                    className="text-xs bg-white text-red-700 border border-red-200 px-2.5 py-1 rounded font-semibold hover:bg-red-50 transition-colors"
                  >
                    Eliminar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {esAdmin ? (
        <form onSubmit={guardar} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label htmlFor="combo-nombre" className="block text-xs font-bold text-gray-800 mb-1">Nombre del combo</label>
              <input
                id="combo-nombre"
                name="nombre"
                value={form.nombre}
                onChange={cambiar}
                required
                className="w-full p-2 bg-white border border-amber-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 text-xs sm:text-sm text-gray-900"
                placeholder="Ej: Armazón + Antirreflejo"
              />
            </div>
            <div>
              <label htmlFor="combo-precio" className="block text-xs font-bold text-emerald-900 mb-1">Precio cerrado ($)</label>
              <input
                id="combo-precio"
                name="precio"
                type="number"
                min="0.01"
                step="0.01"
                value={form.precio}
                onChange={cambiar}
                required
                className="w-full p-2 bg-white border border-emerald-400 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 text-xs sm:text-sm font-bold text-emerald-800"
                placeholder="Ej: 40.00"
              />
            </div>
            <div>
              <label htmlFor="combo-costo" className="block text-xs font-bold text-red-800 mb-1">Costo laboratorio ($)</label>
              <input
                id="combo-costo"
                name="costo"
                type="number"
                min="0"
                step="0.01"
                value={form.costo}
                onChange={cambiar}
                className="w-full p-2 bg-white border border-red-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 text-xs sm:text-sm font-bold text-red-700"
                placeholder="Ej: 12.00"
              />
            </div>
            <div>
              <label htmlFor="combo-tope" className="block text-xs font-bold text-gray-800 mb-1">Armazón hasta ($)</label>
              <input
                id="combo-tope"
                name="topeArmazon"
                type="number"
                min="0"
                step="0.01"
                value={form.topeArmazon}
                onChange={cambiar}
                className="w-full p-2 bg-white border border-amber-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 text-xs sm:text-sm text-gray-900"
                placeholder="Opcional"
              />
            </div>
            <div>
              <label htmlFor="combo-tipo-lente" className="block text-xs font-bold text-gray-800 mb-1">Tipo de lente</label>
              <select
                id="combo-tipo-lente"
                name="tipoLente"
                value={form.tipoLente}
                onChange={cambiar}
                className="w-full p-2 bg-white border border-amber-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 text-xs sm:text-sm text-gray-900"
              >
                <option value="">Sin especificar</option>
                {OPCIONES_LENTE.map(opcion => <option key={opcion} value={opcion}>{opcion}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="combo-material" className="block text-xs font-bold text-gray-800 mb-1">Material / índice</label>
              <select
                id="combo-material"
                name="materialLente"
                value={form.materialLente}
                onChange={cambiar}
                className="w-full p-2 bg-white border border-amber-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 text-xs sm:text-sm text-gray-900"
              >
                <option value="">Sin especificar</option>
                {OPCIONES_MATERIAL.map(opcion => <option key={opcion} value={opcion}>{opcion}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="combo-nota" className="block text-xs font-bold text-gray-800 mb-1">Nota (opcional)</label>
              <input
                id="combo-nota"
                name="nota"
                value={form.nota}
                onChange={cambiar}
                className="w-full p-2 bg-white border border-amber-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 text-xs sm:text-sm text-gray-900"
                placeholder="Ej: Incluye estuche"
              />
            </div>
          </div>

          <fieldset className="rounded-lg border border-amber-200 bg-white p-3">
            <legend className="px-1 text-xs font-bold text-gray-800">Tratamientos incluidos</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {CAMPOS_DE_TRATAMIENTO.map(campo => (
                <label key={campo} className="flex items-center gap-1.5 text-xs text-gray-800">
                  <input
                    type="checkbox"
                    checked={form.tratamientos.includes(campo)}
                    onChange={() => alternarTratamiento(campo)}
                  />
                  {ETIQUETAS_DE_TRATAMIENTO[campo]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="rounded-lg bg-amber-100 border border-amber-300 p-2 text-[11px] text-amber-900">
            Consejo: fija un <b>tope de armazón</b> para que el combo no se aplique a
            monturas caras. Al vender, la app avisa si el costo interno se come el precio.
          </div>

          <button
            type="submit"
            className="w-full p-2.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold rounded-lg text-xs sm:text-sm shadow-md transition-all"
          >
            {form.id !== null ? '💾 Actualizar combo' : '➕ Guardar combo'}
          </button>
        </form>
      ) : (
        <p className="text-xs text-gray-600 font-semibold">
          🔒 Solo un administrador puede crear, editar o eliminar combos.
        </p>
      )}
    </section>
  );
}

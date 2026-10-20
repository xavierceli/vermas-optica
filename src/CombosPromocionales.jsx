import { useMemo } from 'react';
import {
  ETIQUETAS_DE_TRATAMIENTO,
  combosDelTarifario,
  prepararCombo,
  problemaDelCombo,
  quitarCombo
} from './combos';
import { autoCalcularPrecio } from './calculoPrecio';

// ---------------------------------------------------------------------------
// COMBOS EN EL FORMULARIO DE PEDIDOS
// ---------------------------------------------------------------------------
// Tarjetas rapidas en la parte superior. Al elegir una:
//   - el precio de venta queda cerrado en el del combo,
//   - se marcan los tratamientos incluidos,
//   - el armazon se sigue eligiendo aparte (para stock y orden de laboratorio).
// Quitar el combo devuelve el calculo desglosado normal.
// ---------------------------------------------------------------------------

const texto = valor => (valor === null || valor === undefined ? '' : String(valor));

export default function CombosPromocionales({
  pedido,
  listaPrecios = [],
  inventario = [],
  setPedidoSeleccionado,
  bloqueado = false
}) {
  const combos = useMemo(() => combosDelTarifario(listaPrecios), [listaPrecios]);
  const activoId = texto(pedido?.combo_id).trim();
  const activo = combos.find(combo => texto(combo.id) === activoId) || null;
  const aviso = activo ? problemaDelCombo(pedido, activo, inventario) : null;
  const precioActivo = Number(pedido?.combo_precio || 0).toFixed(2);

  if (combos.length === 0 && activoId === '') return null;

  const aplicar = (combo) => {
    setPedidoSeleccionado(prev => {
      const siguiente = { ...prev, ...prepararCombo(combo) };
      return { ...siguiente, venta: autoCalcularPrecio(siguiente, inventario, listaPrecios) };
    });
  };

  const quitar = () => {
    setPedidoSeleccionado(prev => {
      const limpio = quitarCombo(prev);
      return { ...limpio, venta: autoCalcularPrecio(limpio, inventario, listaPrecios) };
    });
  };

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 sm:p-4" aria-label="Combos y promociones">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="font-bold text-amber-900 text-sm sm:text-base">🎁 Combos / Promociones</h3>
        {activoId !== '' && (
          <button
            type="button"
            onClick={quitar}
            disabled={bloqueado}
            className="text-xs font-bold text-red-700 underline disabled:opacity-50"
          >
            Quitar combo
          </button>
        )}
      </div>

      {activoId !== '' ? (
        <div aria-live="polite" className="rounded-lg bg-green-100 border border-green-300 p-2 text-xs sm:text-sm text-green-900">
          <b>Combo aplicado:</b> {texto(pedido.combo_nombre)} · ${precioActivo}
          <span className="block text-green-800">
            El armazón, las lunas y los tratamientos incluidos no se suman. El accesorio sí se cobra aparte.
          </span>
          {aviso && <span className="block mt-1 font-bold text-amber-900">⚠ {aviso}</span>}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {combos.map(combo => (
            <button
              key={combo.id}
              type="button"
              onClick={() => aplicar(combo)}
              disabled={bloqueado}
              className="shrink-0 max-w-[220px] text-left rounded-lg border-2 border-amber-300 bg-white px-3 py-2 shadow-sm hover:border-amber-500 active:scale-95 transition-all disabled:opacity-50"
            >
              <span className="block text-xs font-bold text-amber-900">{combo.nombre}</span>
              <span className="block text-lg font-black text-gray-900">${combo.precio.toFixed(2)}</span>
              {combo.config.tratamientos.length > 0 && (
                <span className="block text-[10px] text-gray-600 leading-tight">
                  {combo.config.tratamientos.map(campo => ETIQUETAS_DE_TRATAMIENTO[campo]).join(' + ')}
                </span>
              )}
              {combo.config.topeArmazon !== null && (
                <span className="block text-[10px] text-gray-600 leading-tight">
                  Armazón hasta ${combo.config.topeArmazon.toFixed(2)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

import { useState, useMemo } from 'react';
import { safeNum } from '../utilidades';
import { limpiarHtml } from '../escape';
import { guardarPrecioLocal, eliminarPrecioLocal } from '../localRepository';
import { sincronizarAhora } from '../syncEngine';
import { filtrarTarifario } from '../estadisticas';

// ---------------------------------------------------------------------------
// TARIFARIO
// ---------------------------------------------------------------------------
// Alta, edicion y baja de tarifas, mas el filtro de la lista. Recibe las piezas
// que no le pertenecen (lista ya cargada, avisos, recarga de datos y confirmacion).
// ---------------------------------------------------------------------------
export function useTarifario({ precioInicial, listaPrecios, mostrarToast, obtenerDatos, solicitarConfirmacion }) {
  const [nuevoPrecio, setNuevoPrecio] = useState(precioInicial);
  const [editandoPrecioId, setEditandoPrecioId] = useState(null);
  const [busquedaPrecio, setBusquedaPrecio] = useState('');

  const manejarCambioPrecio = (e) => {
    let { name, value, type, tagName } = e.target;
    if (type === 'text' || tagName === 'TEXTAREA') value = limpiarHtml(value).toUpperCase();
    setNuevoPrecio({ ...nuevoPrecio, [name]: value });
  };

  const guardarPrecio = async () => {
    try {
      if (!nuevoPrecio.rango_medida) return mostrarToast('Ingresa el rango de medida.', 'warning');
      const datosAGuardar = {
        ...nuevoPrecio,
        costo_laboratorio: Number(safeNum(nuevoPrecio.costo_laboratorio).toFixed(2)),
        precio_sugerido: Number(safeNum(nuevoPrecio.precio_sugerido).toFixed(2))
      };
      await guardarPrecioLocal({ id: editandoPrecioId || undefined, ...datosAGuardar });
      setNuevoPrecio(precioInicial);
      setEditandoPrecioId(null);
      await obtenerDatos({ sync: false });
      void sincronizarAhora({ pull: false });
      mostrarToast('Tarifa guardada en este dispositivo.', 'success');
    } catch (err) {
      mostrarToast('Error al guardar: ' + err.message, 'error');
    }
  };

  const guardarCombo = async (fila) => {
    try {
      const nombre = String(fila?.rango_medida || '').replace(/^COMBO:\s*/i, '').trim();
      if (!nombre) {
        mostrarToast('Escribe el nombre del combo.', 'warning');
        return false;
      }
      if (!(safeNum(fila?.precio_sugerido) > 0)) {
        mostrarToast('El combo necesita un precio mayor que 0.', 'warning');
        return false;
      }
      await guardarPrecioLocal({ ...fila, id: fila.id || undefined });
      await obtenerDatos({ sync: false });
      void sincronizarAhora({ pull: false });
      mostrarToast('Combo guardado en este dispositivo.', 'success');
      return true;
    } catch (err) {
      mostrarToast('Error al guardar el combo: ' + err.message, 'error');
      return false;
    }
  };

  const cargarParaEditarPrecio = (item) => {
    setNuevoPrecio({ ...item });
    setEditandoPrecioId(item.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const eliminarPrecio = (id, mensaje = '¿Seguro que deseas eliminar esta tarifa?', avisoExito = 'Tarifa eliminada localmente.') => {
    solicitarConfirmacion(mensaje, async () => {
      try {
        await eliminarPrecioLocal(id);
        await obtenerDatos({ sync: false });
        void sincronizarAhora({ pull: false });
        mostrarToast(avisoExito, 'success');
      } catch (err) {
        mostrarToast('Error al eliminar: ' + err.message, 'error');
      }
    });
  };

  const listaPreciosFiltrada = useMemo(
    () => filtrarTarifario(listaPrecios, busquedaPrecio),
    [listaPrecios, busquedaPrecio]
  );

  return {
    nuevoPrecio, setNuevoPrecio,
    editandoPrecioId, setEditandoPrecioId,
    busquedaPrecio, setBusquedaPrecio,
    manejarCambioPrecio, guardarPrecio, guardarCombo, cargarParaEditarPrecio, eliminarPrecio,
    listaPreciosFiltrada
  };
}

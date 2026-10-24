import { useState, useCallback, useRef } from 'react';
import { localDb } from '../localDb';
import { obtenerSnapshotLocal, importLegacyCache } from '../localRepository';
import { sincronizarAhora } from '../syncEngine';

// ---------------------------------------------------------------------------
// DATOS LOCALES
// ---------------------------------------------------------------------------
// Es la unica fuente de verdad de los datos que se leen del dispositivo:
// historial clinico, ventas (locales y archivadas), inventario y tarifario.
// `obtenerDatos` los recarga desde IndexedDB y, opcionalmente, dispara un pull
// del motor de sincronizacion. Las acciones de dominio (clinica, inventario,
// pedidos...) reciben estas funciones y describen los cambios con sus setters.
// ---------------------------------------------------------------------------
export function useDatosLocales() {
  const [historial, setHistorial] = useState([]);
  const [cedulasArchivadas, setCedulasArchivadas] = useState([]);
  const [ventasArchivadas, setVentasArchivadas] = useState([]);
  const [ventasLocales, setVentasLocales] = useState([]);
  const [inventario, setInventario] = useState([]);
  const [listaPrecios, setListaPrecios] = useState([]);

  // Marca cada obtención de datos: si dos `obtenerDatos` se solapan (p. ej. el
  // pull post-guardado y un login), el snapshot tardío de la primera no debe
  // pisar el estado que ya dejó la segunda.
  const generacion = useRef(0);

  const aplicarSnapshotLocal = useCallback(snapshot => {
    if (!snapshot) return;
    setHistorial(snapshot.historial || []);
    setVentasArchivadas(snapshot.ventasArchivadas || []);
    setInventario(snapshot.inventory || []);
    setListaPrecios(snapshot.prices || []);
    setCedulasArchivadas(snapshot.cedulasArchivadas || []);
    if (snapshot.sales) {
      setVentasLocales(snapshot.sales);
    }
  }, []);

  const obtenerDatos = useCallback(async ({ sync = true } = {}) => {
    const miGeneracion = ++generacion.current;
    try {
      await importLegacyCache();
    } catch (error) {
      console.warn('[datos] No se pudo migrar el caché antiguo:', error);
    }
    const snapshot = await obtenerSnapshotLocal();

    try {
      const ventasDirectas = await localDb.sales.toArray();
      if (ventasDirectas && ventasDirectas.length > 0) {
        snapshot.sales = ventasDirectas;
      }
    } catch (err) {
      console.warn('[datos] No se pudo leer localDb.sales:', err);
    }

    aplicarSnapshotLocal(snapshot);
    if (sync) {
      void sincronizarAhora({ pull: true }).then(async () => {
        // Si otro obtenerDatos arrancó mientras corría este pull, su snapshot
        // será más nuevo: no lo pisemos con este.
        if (miGeneracion !== generacion.current) return;
        const snapFresca = await obtenerSnapshotLocal();
        try {
          const vDirectas = await localDb.sales.toArray();
          if (vDirectas && vDirectas.length > 0) {
            snapFresca.sales = vDirectas;
          }
        } catch {
          // Fallback silencioso
        }
        aplicarSnapshotLocal(snapFresca);
      });
    }
    return snapshot;
  }, [aplicarSnapshotLocal]);

  // Al cerrar sesion se olvida lo que hay en pantalla (no se borra del
  // dispositivo): historial, ventas, inventario y tarifario.
  const limpiarDatos = useCallback(() => {
    setHistorial([]);
    setVentasLocales([]);
    setVentasArchivadas([]);
    setInventario([]);
    setListaPrecios([]);
  }, []);

  return {
    historial, setHistorial,
    cedulasArchivadas, setCedulasArchivadas,
    ventasArchivadas, setVentasArchivadas,
    ventasLocales, setVentasLocales,
    inventario, setInventario,
    listaPrecios, setListaPrecios,
    aplicarSnapshotLocal, obtenerDatos, limpiarDatos
  };
}

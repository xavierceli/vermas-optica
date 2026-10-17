import { useState, useCallback } from 'react';
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

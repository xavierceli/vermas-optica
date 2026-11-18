import { useState, useEffect } from 'react';
import { iniciarMotorSync, detenerMotorSync, suscribirSync, sinSesionActiva } from '../syncEngine';
import { iniciarTiempoReal, detenerTiempoReal, estadoTiempoReal } from '../tiempoReal';

// ---------------------------------------------------------------------------
// ESTADO DE SINCRONIZACION
// ---------------------------------------------------------------------------
// Arranca el motor de sync solo cuando hay sesion y refleja su estado en React.
// El motor en si vive en ../syncEngine; aqui solo se engancha al componente.
//
// Ademas abre el canal de tiempo real: es lo que hace que un cambio hecho en
// otro equipo aparezca en segundos en vez de esperar al sondeo de 30 s.
// En modo PIN local no hay sesion con la nube: no se abre canal (no podria
// autorizarlo) y se sigue trabajando con el sondeo normal.
// ---------------------------------------------------------------------------
export function useSincronizacion(estaAutenticado, obtenerDatos, modoSinConexion = false) {
  const [syncEstado, setSyncEstado] = useState({
    phase: 'idle', online: true, pending: 0, conflicts: 0, lastSync: null, lastError: null
  });
  // Estado del canal de tiempo real, para que el panel pueda avisar si lleva
  // demasiado caido. Se refresca cuando cambia el canal y cada 30 s (para que
  // "lleva X minutos" avance aunque no pase nada).
  const [tiempoReal, setTiempoReal] = useState(() => estadoTiempoReal());

  useEffect(() => {
    // Solo arrancar el motor de sincronización si el usuario ya inició sesión
    if (!estaAutenticado) return undefined;

    iniciarMotorSync();
    const desuscribir = suscribirSync(setSyncEstado);

    // Tiempo real: adelanta los cambios de otros equipos. Si no hay sesion en
    // la nube (modo PIN) no se abre, porque Realtime no tendria token valido.
    const puedeTiempoReal = !modoSinConexion && !sinSesionActiva();
    if (puedeTiempoReal && typeof obtenerDatos === 'function') {
      iniciarTiempoReal({
        alCambiar: () => { void obtenerDatos({ sync: false }); },
        // El panel se repinta en cuanto el canal cambia de estado.
        alCambiarEstado: () => setTiempoReal(estadoTiempoReal())
      });
    }

    const relojTiempoReal = setInterval(() => {
      setTiempoReal(estadoTiempoReal());
    }, 30000);

    // Al cerrar sesión (o desmontar) el motor se detiene: sin esto, el intervalo
    // de 30 s y los listeners online/offline/focus seguían vivos tras el logout
    // re-leyendo el outbox para nadie. El canal de tiempo real, igual.
    return () => {
      clearInterval(relojTiempoReal);
      desuscribir();
      void detenerTiempoReal();
      detenerMotorSync();
    };
  }, [estaAutenticado, modoSinConexion, obtenerDatos]);

  return { syncEstado, tiempoReal };
}

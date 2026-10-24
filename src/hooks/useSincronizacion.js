import { useState, useEffect } from 'react';
import { iniciarMotorSync, detenerMotorSync, suscribirSync } from '../syncEngine';

// ---------------------------------------------------------------------------
// ESTADO DE SINCRONIZACION
// ---------------------------------------------------------------------------
// Arranca el motor de sync solo cuando hay sesion y refleja su estado en React.
// El motor en si vive en ../syncEngine; aqui solo se engancha al componente.
// ---------------------------------------------------------------------------
export function useSincronizacion(estaAutenticado) {
  const [syncEstado, setSyncEstado] = useState({
    phase: 'idle', online: true, pending: 0, conflicts: 0, lastSync: null, lastError: null
  });

  useEffect(() => {
    // Solo arrancar el motor de sincronización si el usuario ya inició sesión
    if (!estaAutenticado) return undefined;

    iniciarMotorSync();
    const desuscribir = suscribirSync(setSyncEstado);
    // Al cerrar sesión (o desmontar) el motor se detiene: sin esto, el intervalo
    // de 30 s y los listeners online/offline/focus seguían vivos tras el logout
    // re-leyendo el outbox para nadie.
    return () => {
      desuscribir();
      detenerMotorSync();
    };
  }, [estaAutenticado]);

  return { syncEstado };
}

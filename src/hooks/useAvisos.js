import { useState, useEffect, useCallback } from 'react';
import { leerAviso, mostrarAviso, suscribirAvisos } from '../avisos';

// ---------------------------------------------------------------------------
// TOAST GLOBAL
// ---------------------------------------------------------------------------
// Se suscribe al canal central de avisos (./avisos) y expone el aviso vigente
// junto con el disparador. Aislado para que useGestor sea solo el orquestador.
// mostrarToast es estable (useCallback): viaja como dependencia de muchos
// handlers memoizados, y sin esto los invalidaba a todos en cada render.
// ---------------------------------------------------------------------------
export function useAvisos() {
  const [toast, setToast] = useState(() => leerAviso());
  useEffect(() => suscribirAvisos(setToast), []);

  const mostrarToast = useCallback(
    (mensaje, tipo = 'success', duracion = 3500) => mostrarAviso(mensaje, tipo, duracion),
    []
  );

  return { toast, mostrarToast };
}

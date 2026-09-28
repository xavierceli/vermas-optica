// ---------------------------------------------------------------------------
// AVISO DE VERSION NUEVA
// ---------------------------------------------------------------------------
// Con registerType: 'prompt' el service worker NO se activa solo: se queda
// esperando. Este componente es quien le dice al usuario que hay una version
// nueva y quien, al pulsar, activa el cambio.
//
// Por que importa: con 'autoUpdate' + skipWaiting, un despliegue tomaba el
// control de una pestana con una venta a medio llenar y recargaba la pagina.
// El optometria perdia el formulario entero. Ahora el decide cuando, con el
// trabajo a salvo.
// ---------------------------------------------------------------------------
import { useEffect, useState, useRef, useCallback } from 'react';
import { registerSW } from 'virtual:pwa-register';

export default function AvisoActualizacion({ hayTrabajoSinGuardar = false }) {
  const [hayNuevaVersion, setHayNuevaVersion] = useState(false);
  const [actualizando, setActualizando] = useState(false);
  // Si tras activar el worker la pagina no llega a recargarse, se avisa y se
  // ofrece recargar a mano. Antes el boton se quedaba en "Actualizando..."
  // para siempre y el optometria se quedaba sin salida.
  const [fallo, setFallo] = useState(false);
  // Guarda la funcion de actualizacion en una ref: mutarla no dispara render,
  // que es justo lo que se necesita aqui (no es estado de la vista).
  const actualizarRef = useRef(null);
  const temporizadoresRef = useRef([]);

  const programar = useCallback((fn, ms) => {
    temporizadoresRef.current.push(setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    // OJO: updateServiceWorker() SOLO envia el mensaje SKIP_WAITING al worker
    // en espera. Ignora su argumento y NO recarga la pagina. Se llama unica vez
    // desde el clic del usuario.
    // Sin cleanup a proposito: lo que devuelve registerSW no es un
    // "desregistrar", y llamarlo al desmontar mandaba otro SKIP_WAITING.
    const actualizar = registerSW({
      immediate: true,
      onNeedRefresh() {
        setHayNuevaVersion(true);
      },
      onOfflineReady() {
        // La app ya puede abrirse sin internet. No se avisa: en una optica es
        // el estado normal de trabajo, no una novedad.
      }
    });
    actualizarRef.current = actualizar;
  }, []);

  useEffect(() => () => { temporizadoresRef.current.forEach(clearTimeout); }, []);

  const aplicar = useCallback(async () => {
    if (hayTrabajoSinGuardar && !window.confirm(
      'Tienes cambios sin terminar de enviar. Si actualizas ahora se recargará la página y podrían perderse. '
      + '¿Guardar y continuar de todas formas?'
    )) return;

    setActualizando(true);
    setFallo(false);

    // 1) Avisar al worker en espera por las dos vias: la de la libreria y la
    //    directa, que no depende de workbox.
    try {
      if (typeof actualizarRef.current === 'function') await actualizarRef.current(true);
    } catch { /* se intenta igualmente por la via directa */ }
    try {
      const registro = await navigator.serviceWorker?.getRegistration();
      if (registro?.waiting) registro.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch { /* sin service worker no hay nada que activar */ }

    // 2) El worker nuevo ya esta descargado: activarlo y recargar no necesita
    //    red. Se recarga SIEMPRE, porque sin clientsClaim() el evento
    //    'controlling' no llega nunca y la app se quedaba en "Actualizando...".
    programar(() => window.location.reload(), 1500);
    // 3) Si aun asi no se recarga, se avisa y se deja recargar a mano.
    programar(() => setFallo(true), 8000);
  }, [hayTrabajoSinGuardar, programar]);

  // 4) Camino rapido: si el worker nuevo llega a tomar el control, se recarga ya.
  useEffect(() => {
    if (!actualizando) return undefined;
    const alCambiarControlador = () => window.location.reload();
    navigator.serviceWorker?.addEventListener('controllerchange', alCambiarControlador);
    return () => navigator.serviceWorker?.removeEventListener('controllerchange', alCambiarControlador);
  }, [actualizando]);

  if (!hayNuevaVersion) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 sm:right-auto z-[400] bg-gray-900 text-white p-4 rounded-xl shadow-2xl flex flex-col sm:flex-row items-start sm:items-center gap-3 max-w-md"
    >
      <span className="text-2xl shrink-0" aria-hidden="true">🆕</span>
      <p className="text-sm font-bold flex-1">
        Hay una versión nueva disponible.
        <span className="block font-normal text-gray-300 text-xs mt-0.5">
          Termina de guardar lo que estés haciendo antes de actualizar.
        </span>
      </p>
      <div className="flex gap-2 w-full sm:w-auto shrink-0">
        <button
          type="button"
          onClick={() => setHayNuevaVersion(false)}
          disabled={actualizando}
          className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 text-xs font-bold transition-colors"
        >
          Ahora no
        </button>
        {actualizando ? (
          // Mientras actualiza, este boton SIEMPRE se puede pulsar: es la salida
          // manual por si la recarga automatica no llega a ocurrir.
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-teal-500 hover:bg-teal-600 text-xs font-bold transition-colors"
          >
            {fallo ? 'Recargar ahora' : 'Actualizando…'}
          </button>
        ) : (
          <button
            type="button"
            onClick={aplicar}
            className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-teal-500 hover:bg-teal-600 text-xs font-bold transition-colors"
          >
            Actualizar
          </button>
        )}
      </div>
      {fallo && (
        <p className="w-full sm:w-auto text-xs font-normal text-red-300">
          No se pudo activar la versión nueva. Pulsa «Recargar ahora» o recarga la página con Ctrl+Shift+R.
        </p>
      )}
    </div>
  );
}

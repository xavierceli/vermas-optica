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
  // Guarda la funcion de actualizacion en una ref: mutarla no dispara render,
  // que es justo lo que se necesita aqui (no es estado de la vista).
  const actualizarRef = useRef(null);

  useEffect(() => {
    // updateServiceWorker(true) es el equivalente a skipWaiting: activa el
    // service worker en espera. Se llama SOLO desde el clic del usuario.
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
    return () => { if (typeof actualizar === 'function') actualizar({ immediate: false }); };
  }, []);

  const aplicar = useCallback(() => {
    if (hayTrabajoSinGuardar && !window.confirm(
      'Tienes cambios sin terminar de enviar. Si actualizas ahora se recargará la página y podrían perderse. '
      + '¿Guardar y continuar de todas formas?'
    )) return;
    setActualizando(true);
    // Activa el worker en espera y recarga: el bundle nuevo entra en control.
    if (typeof actualizarRef.current === 'function') actualizarRef.current(true);
  }, [hayTrabajoSinGuardar]);

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
          className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold transition-colors"
        >
          Ahora no
        </button>
        <button
          type="button"
          onClick={aplicar}
          disabled={actualizando}
          className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-xs font-bold transition-colors"
        >
          {actualizando ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>
    </div>
  );
}

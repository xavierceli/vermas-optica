import { useState, useEffect } from 'react';
import { resolverUrlComprobante } from './comprobantes';
import { mostrarAviso } from './avisos';

export default function BotonComprobante({ 
  ruta, 
  refId, 
  className = '', 
  children = '👁️ Comprobante' 
}) {
  const [cargando, setCargando] = useState(false);
  const [urlModal, setUrlModal] = useState(null);

  useEffect(() => {
    const alPresionarEsc = (e) => {
      if (e.key === 'Escape' && urlModal) {
        setUrlModal(null);
      }
    };
    if (urlModal) {
      window.addEventListener('keydown', alPresionarEsc);
      return () => window.removeEventListener('keydown', alPresionarEsc);
    }
  }, [urlModal]);

  if (!ruta) return null;

  const abrir = async () => {
    if (cargando) return;
    setCargando(true);

    try {
      const url = await resolverUrlComprobante(ruta, refId);

      if (url) {
        // En móviles y desktop abrimos modal in-app seguro sin depender de popups bloqueados
        setUrlModal(url);
      } else {
        mostrarAviso('El comprobante no se pudo abrir. Puede que siga pendiente de subir o que no haya conexión.', 'warning');
      }
    } catch (err) {
      mostrarAviso('Error al abrir comprobante: ' + (err?.message || 'Error desconocido'), 'error');
    } finally {
      setCargando(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        disabled={cargando}
        title={cargando ? 'Abriendo comprobante...' : 'Abrir comprobante'}
        aria-label={cargando ? 'Abriendo comprobante' : 'Abrir comprobante de pago'}
        aria-busy={cargando}
        className={`transition-all touch-manipulation ${className} ${cargando ? 'opacity-60 cursor-wait' : 'active:scale-95'}`}
      >
        {cargando ? '⏳ Abriendo…' : children}
      </button>

      {urlModal && (
        <div 
          className="fixed inset-0 bg-black/85 z-[300] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm isolate"
          onClick={() => setUrlModal(null)}
        >
          <div 
            className="relative max-w-3xl w-full max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Visualizador de Comprobante"
          >
            <div className="flex items-center justify-between p-3 sm:p-4 border-b bg-gray-50">
              <h3 className="font-bold text-gray-900 text-sm sm:text-base flex items-center gap-1.5">
                📄 Comprobante de Pago
              </h3>
              <div className="flex items-center gap-2">
                <a
                  href={urlModal}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold px-3 py-1.5 rounded-lg border border-indigo-200 transition-colors"
                >
                  Abrir en pestaña ↗
                </a>
                <button
                  type="button"
                  onClick={() => setUrlModal(null)}
                  className="text-gray-500 hover:text-gray-800 text-xl font-black w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"
                  aria-label="Cerrar comprobante"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-2 sm:p-4 overflow-auto flex-1 flex items-center justify-center bg-gray-100 min-h-[300px]">
              <img 
                src={urlModal} 
                alt="Comprobante de pago" 
                className="max-h-[75vh] max-w-full object-contain rounded-lg shadow-md"
                onError={() => {
                  mostrarAviso('No se pudo visualizar la imagen del comprobante.', 'error');
                  setUrlModal(null);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
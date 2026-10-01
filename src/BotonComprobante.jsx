import { useState } from 'react';
import { resolverUrlComprobante } from './comprobantes';
import { mostrarAviso } from './avisos';

export default function BotonComprobante({ 
  ruta, 
  refId, 
  className = '', 
  children = '👁️ Comprobante' 
}) {
  const [cargando, setCargando] = useState(false);

  if (!ruta) return null;

  const abrir = async () => {
    if (cargando) return;
    setCargando(true);

    try {
      const url = await resolverUrlComprobante(ruta, refId);
      if (url) {
        // En móviles, window.open con rel seguros evita el bloqueo de pop-ups
        const nuevaVentana = window.open(url, '_blank', 'noopener,noreferrer');
        if (!nuevaVentana) {
          // Si el navegador bloqueó la ventana emergente directa, navegamos limpiamente
          window.location.assign(url);
        }
      } else {
        mostrarAviso('El comprobante no se pudo abrir. Puede que siga pendiente de subir o que no haya conexión.');
      }
    } catch (err) {
      mostrarAviso('Error al abrir comprobante: ' + (err?.message || 'Error desconocido'));
    } finally {
      setCargando(false);
    }
  };

  return (
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
  );
}
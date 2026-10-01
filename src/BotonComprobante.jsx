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

    // Preabrimos la ventana dentro del contexto del evento del usuario para burlar el bloqueador de pop-ups
    const ventanaPrevia = window.open('', '_blank');

    try {
      const url = await resolverUrlComprobante(ruta, refId);

      if (url) {
        if (ventanaPrevia && !ventanaPrevia.closed) {
          ventanaPrevia.opener = null;
          ventanaPrevia.location.href = url;
        } else {
          // Si el navegador bloqueó la preapertura, disparamos un enlace temporal seguro en nueva pestaña
          const link = document.createElement('a');
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      } else {
        if (ventanaPrevia && !ventanaPrevia.closed) ventanaPrevia.close();
        mostrarAviso('El comprobante no se pudo abrir. Puede que siga pendiente de subir o que no haya conexión.', 'warning');
      }
    } catch (err) {
      if (ventanaPrevia && !ventanaPrevia.closed) ventanaPrevia.close();
      mostrarAviso('Error al abrir comprobante: ' + (err?.message || 'Error desconocido'), 'error');
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
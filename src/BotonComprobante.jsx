import { resolverUrlComprobante } from './comprobantes';
import { mostrarAviso } from './avisos'

// El bucket de comprobantes es privado, asi que no hay una URL fija: hay que
// firmarla. Pero NO se pide al montar el componente: el historial puede tener
// cientos de filas y eso disparaba cientos de peticiones a la vez al abrir la
// vista, dejando la app inutilizable. La URL se resuelve solo cuando el
// usuario pulsa el boton, que es el unico momento en que hace falta.
export default function BotonComprobante({ ruta, refId, className = '', children = '👁️ Comprobante' }) {
  if (!ruta) return null;

  const abrir = async () => {
    const url = await resolverUrlComprobante(ruta, refId);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else mostrarAviso('El comprobante no se pudo abrir. Puede que siga pendiente de subir o que no haya conexion.');
  };

  // <button> y no <a href="#">: un enlace sin destino no es un boton para la
  // tecnologia asistiva, y con href="#" el foco se perdia al pulsarlo.
  return (
    <button
      type="button"
      onClick={abrir}
      title="Abrir comprobante"
      className={className}
    >
      {children}
    </button>
  );
}
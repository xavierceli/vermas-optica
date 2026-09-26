import { resolverUrlComprobante } from './comprobantes';

// El bucket de comprobantes es privado, asi que no hay una URL fija: hay que
// firmarla. Pero NO se pide al montar el componente: el historial puede tener
// cientos de filas y eso disparaba cientos de peticiones a la vez al abrir la
// vista, dejando la app inutilizable. La URL se resuelve solo cuando el
// usuario pulsa el boton, que es el unico momento en que hace falta.
export default function BotonComprobante({ ruta, refId, className = '', children = '👁️ Comprobante' }) {
  if (!ruta) return null;

  const abrir = async event => {
    event.preventDefault();
    const url = await resolverUrlComprobante(ruta, refId);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else alert('El comprobante no se pudo abrir. Puede que siga pendiente de subir o que no haya conexion.');
  };

  return (
    <a
      href="#"
      onClick={abrir}
      title="Abrir comprobante"
      className={className}
    >
      {children}
    </a>
  );
}
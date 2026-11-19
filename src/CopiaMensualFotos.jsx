// ---------------------------------------------------------------------------
// RECORDATORIO: COPIA MENSUAL DE FOTOS Y COMPROBANTES
// ---------------------------------------------------------------------------
// Vive dentro del panel de sincronizacion, junto al respaldo del dispositivo.
// Avisa cuando hace mas de un mes de la ultima copia confirmada. El boton solo
// anota la fecha: los archivos se descargan a mano desde Supabase -> Storage.
import { useEffect, useState } from 'react';
import { estadoCopiaMensual } from './copiaMensual.js';
import { leerUltimaCopiaMensual, registrarCopiaMensual } from './repositorio/copiaMensual.js';

export default function CopiaMensualFotos() {
  // undefined = aun cargando; null = nunca se registro.
  const [ultimo, setUltimo] = useState(undefined);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    leerUltimaCopiaMensual()
      .then(valor => { if (vivo) setUltimo(valor ?? null); })
      .catch(() => {
        if (vivo) {
          setUltimo(null);
          setError('No se pudo leer la fecha de la última copia.');
        }
      });
    return () => { vivo = false; };
  }, []);

  const marcar = async () => {
    setOcupado(true);
    setError('');
    try {
      const ahora = new Date().toISOString();
      await registrarCopiaMensual(ahora);
      setUltimo(ahora);
    } catch {
      setError('No se pudo anotar la fecha. Inténtalo de nuevo.');
    } finally {
      setOcupado(false);
    }
  };

  if (ultimo === undefined) return null;

  const estado = estadoCopiaMensual({ ultimo });
  const pendiente = estado.nivel === 'aviso';

  return (
    <section
      aria-labelledby="titulo-copia-mensual"
      className={`mt-4 rounded-xl border p-3 ${pendiente ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}
    >
      <h3 id="titulo-copia-mensual" className="text-sm font-black text-gray-800">
        🖼️ Copia mensual de fotos y comprobantes
      </h3>
      <p
        role={pendiente ? 'status' : undefined}
        className={`text-xs mt-1 ${pendiente ? 'text-amber-900 font-semibold' : 'text-gray-600'}`}
      >
        {estado.mensaje}
      </p>
      <p className="text-[11px] text-gray-500 mt-1 leading-snug">
        El respaldo automático no incluye los archivos. Cópialos desde Supabase → Storage
        el día 1 de cada mes a un disco y a una nube privada. Este botón solo anota la fecha
        en este equipo; no descarga ni copia archivos.
      </p>
      <button
        type="button"
        onClick={marcar}
        disabled={ocupado}
        className="mt-2 text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
      >
        {ocupado ? 'Anotando…' : '✅ Ya hice la copia de este mes'}
      </button>
      {error && <p role="alert" className="text-xs text-red-700 mt-1.5">{error}</p>}
    </section>
  );
}

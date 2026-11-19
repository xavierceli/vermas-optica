// ---------------------------------------------------------------------------
// DIAGNOSTICO PARA PEDIR AYUDA
// ---------------------------------------------------------------------------
// Vive en el panel de "Resolver problemas". Muestra los errores que la app ya
// guarda en este equipo y permite copiarlos, junto con la version y el estado
// de la cola, en un solo texto. Nunca se envia nada solo: el usuario decide
// pegar el texto en un mensaje.
import { useEffect, useState } from 'react';
import { textoDiagnostico } from './registroErrores.js';
import { leerErroresLocales } from './repositorio/diagnostico.js';

const fechaLegible = valor => {
  const fecha = new Date(valor);
  return Number.isFinite(fecha.getTime()) ? fecha.toLocaleString('es-EC') : 'fecha desconocida';
};

const RESUMEN_VISIBLE = 5;

export default function DiagnosticoPanel({ pendientes = 0, online = null }) {
  // undefined = aun cargando; [] = sin errores.
  const [errores, setErrores] = useState(undefined);
  const [copiado, setCopiado] = useState(false);
  const [textoManual, setTextoManual] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    leerErroresLocales()
      .then(lista => { if (vivo) setErrores(Array.isArray(lista) ? lista : []); })
      .catch(() => {
        if (vivo) {
          setErrores([]);
          setError('No se pudo leer el historial de errores de este equipo.');
        }
      });
    return () => { vivo = false; };
  }, []);

  const copiar = async () => {
    setError('');
    setCopiado(false);
    setTextoManual('');
    const version = typeof __BUILD_ID__ === 'undefined' ? 'sin identificar' : __BUILD_ID__;
    const texto = textoDiagnostico({ errores, pendientes, version, online });
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      // Sin permiso de portapapeles: se muestra para copiarlo a mano.
      setTextoManual(texto);
    }
  };

  if (errores === undefined) {
    return <p className="text-sm text-gray-500 text-center py-4">Leyendo el historial de errores…</p>;
  }

  return (
    <section
      aria-labelledby="titulo-diagnostico"
      className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3.5"
    >
      <h3 id="titulo-diagnostico" className="text-sm font-black text-gray-800">
        🩺 Diagnóstico para pedir ayuda
      </h3>
      <p className="text-xs text-gray-600 mt-1 leading-snug">
        Este resumen incluye la versión, el estado de la cola y los últimos errores.
        No se envía solo: revísalo y pégalo en un mensaje cuando necesites soporte.
      </p>

      {error && <p role="alert" className="text-xs text-red-700 mt-2">{error}</p>}

      <p className="text-xs font-bold text-gray-700 mt-2">
        {errores.length === 0
          ? 'Sin errores registrados en este equipo.'
          : `${errores.length} error(es) registrado(s); se conservan los últimos 20.`}
      </p>

      {errores.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {errores.slice(0, RESUMEN_VISIBLE).map((entrada, indice) => (
            <li key={`${entrada.hora}-${indice}`} className="text-[11px] text-gray-700 break-words">
              <span className="text-gray-500">{fechaLegible(entrada.hora)}</span>
              {entrada.donde ? <span className="text-gray-500"> · {entrada.donde}</span> : null}
              {' · '}{entrada.mensaje}
              {entrada.repeticiones > 1 ? ` (x${entrada.repeticiones})` : ''}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={copiar}
        className="mt-2.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 transition-colors"
      >
        {copiado ? '✓ Diagnóstico copiado' : '📋 Copiar diagnóstico'}
      </button>

      {copiado && (
        <p role="status" className="text-xs text-teal-700 font-bold mt-1.5">
          Pégalo en un mensaje para pedir ayuda.
        </p>
      )}

      {textoManual && (
        <textarea
          readOnly
          aria-label="Diagnóstico para copiar a mano"
          className="mt-2 w-full h-40 text-[10px] font-mono border border-gray-200 rounded-lg p-2"
          value={textoManual}
          onFocus={evento => evento.target.select()}
        />
      )}
    </section>
  );
}

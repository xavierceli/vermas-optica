// ---------------------------------------------------------------------------
// COMPARACION DE UN CONFLICTO CLINICO
// ---------------------------------------------------------------------------
// Presentacion pura: recibe el cambio pendiente del outbox y, si ya se pidio,
// la fila actual del servidor. No consulta nada por su cuenta; el panel decide
// cuando traer el servidor para no hacer llamadas al abrir la lista.
import { compararClinica } from '../comparacionClinica.js';
import { resumenDeVersion } from '../revisionesResumen.js';

const visible = valor => (valor ? valor : '—');

export default function ComparacionConflicto({
  pendiente = null,
  servidor = null,
  cargando = false,
  error = '',
  onCargar = null
}) {
  if (!pendiente) return null;

  const resumen = resumenDeVersion(pendiente);
  const filas = compararClinica(pendiente, servidor);
  const distintos = filas.filter(fila => fila.distinto).map(fila => fila.etiqueta);

  return (
    <section
      className="mt-3 border-t border-gray-200 pt-3"
      aria-label="Comparación con el servidor"
    >
      <h4 className="text-xs font-black text-gray-700 uppercase tracking-wide">
        Tu cambio pendiente
      </h4>
      <p className="text-[11px] text-gray-500 mb-2">
        Esto es lo que este equipo intentó guardar en la ficha clínica.
      </p>

      {!servidor && (
        <dl className="text-xs text-gray-700 space-y-0.5">
          <div className="flex gap-2">
            <dt className="font-bold shrink-0">Fecha:</dt>
            <dd className="break-words">{visible(resumen.fecha)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-bold shrink-0">OD:</dt>
            <dd className="break-words">{resumen.od}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-bold shrink-0">OI:</dt>
            <dd className="break-words">{resumen.oi}</dd>
          </div>
          {resumen.notas && (
            <div className="flex gap-2">
              <dt className="font-bold shrink-0">Notas:</dt>
              <dd className="break-words">{resumen.notas}</dd>
            </div>
          )}
        </dl>
      )}

      {servidor ? (
        <div className="mt-2">
          <h4 className="text-xs font-black text-gray-700 uppercase tracking-wide">
            Comparación con el servidor
          </h4>
          {distintos.length === 0 ? (
            <p className="text-xs font-semibold text-green-700 mt-1">
              Los datos coinciden con lo guardado en el servidor.
            </p>
          ) : (
            <p className="text-xs font-semibold text-amber-800 mt-1">
              Distinto en: {distintos.join(', ')}.
            </p>
          )}
          <div className="overflow-x-auto mt-1.5">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-gray-600">
                  <th scope="col" className="text-left font-bold py-1 pr-2">Dato</th>
                  <th scope="col" className="text-left font-bold py-1 pr-2">Tu cambio</th>
                  <th scope="col" className="text-left font-bold py-1">Servidor</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(fila => (
                  <tr
                    key={fila.campo}
                    data-testid={`comparacion-${fila.campo}`}
                    className={fila.distinto ? 'bg-amber-50' : ''}
                  >
                    <th scope="row" className="text-left font-bold text-gray-700 py-1 pr-2 align-top">
                      {fila.etiqueta}
                    </th>
                    <td className={`py-1 pr-2 align-top break-words ${fila.distinto ? 'font-bold text-amber-900' : 'text-gray-700'}`}>
                      {visible(fila.pendiente)}
                    </td>
                    <td className="py-1 align-top break-words text-gray-700">
                      {visible(fila.servidor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          {cargando ? (
            <p className="text-xs text-gray-500">Consultando el servidor…</p>
          ) : (
            <button
              type="button"
              onClick={typeof onCargar === 'function' ? onCargar : undefined}
              disabled={typeof onCargar !== 'function'}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100 disabled:opacity-50 transition-colors"
              title="Ver qué quedó guardado en el servidor"
            >
              🔍 Ver lo guardado en el servidor
            </button>
          )}
          {error && (
            <p role="alert" className="text-xs text-red-700 mt-1">{error}</p>
          )}
        </div>
      )}

      <p className="text-[10px] text-gray-500 mt-2">
        Reintentar guarda TU versión y conserva la del servidor en «Versiones».
        Descartar deja la versión del servidor y no sube este cambio.
      </p>
    </section>
  );
}

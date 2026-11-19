// ---------------------------------------------------------------------------
// LISTA DE VERSIONES ANTERIORES DE UNA CONSULTA
// ---------------------------------------------------------------------------
// Presentacion pura: recibe lo que devuelve revisiones_consulta y lo muestra.
// La usan el panel de sincronizacion (conflictos en cola) y el expediente del
// paciente (consultas ya sincronizadas), para que la misma ficha se lea igual
// en los dos sitios.
import { resumenDeVersion } from '../revisionesResumen.js';

const fechaLegible = valor => {
  const fecha = new Date(valor);
  return Number.isFinite(fecha.getTime()) ? fecha.toLocaleString('es-EC') : 'fecha desconocida';
};

export default function ListaVersiones({ lista = [] }) {
  if (lista.length === 0) return null;

  return (
    <ul className="space-y-2">
      {lista.map(revision => {
        const resumen = resumenDeVersion(revision.snapshot);
        return (
          <li
            key={`${revision.version}-${revision.editado_en}`}
            className="rounded-lg bg-white border border-gray-200 p-2.5"
          >
            <p className="text-xs font-bold text-gray-800">
              Versión {revision.version}
              <span className="font-medium text-gray-500"> · {fechaLegible(revision.editado_en)}</span>
              {revision.editado_por && (
                <span className="font-medium text-gray-500"> · {revision.editado_por}</span>
              )}
            </p>
            <p className="text-xs text-gray-700 mt-1">
              <span className="font-bold">OD: </span>{resumen.od}
            </p>
            <p className="text-xs text-gray-700">
              <span className="font-bold">OI: </span>{resumen.oi}
            </p>
            {resumen.notas && (
              <p className="text-xs text-gray-600 mt-1">
                <span className="font-bold">Notas: </span>{resumen.notas}
              </p>
            )}
            {revision.motivo && (
              <p className="text-[10px] text-gray-400 mt-1">Motivo: {revision.motivo}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

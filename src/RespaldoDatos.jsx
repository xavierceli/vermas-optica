// ---------------------------------------------------------------------------
// RESPALDO DE ESTE DISPOSITIVO
// ---------------------------------------------------------------------------
// La app es offline-first: lo que se guarda sin conexion vive unicamente en el
// navegador. Si se rompe el equipo, se limpia la cache o se borra el perfil, esa
// semana de trabajo desaparece sin dejar rastro. Aqui el usuario baja una copia
// en un .json y, si hace falta, la devuelve a otro equipo.
//
// Se ofrece dentro del panel de sincronizacion porque es donde ya se explican
// los problemas de la cola: los dos temas son "mis datos no llegaron al servidor".
import { useCallback, useEffect, useRef, useState } from 'react';
import { localDb } from './localDb';
import {
  construirRespaldo, espacioEnDisco, formatearMB, nombreArchivoRespaldo,
  parsearRespaldo, resumenRespaldo, restaurarRespaldo
} from './respaldo.js';

const BOTON = 'text-xs font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-50';
const COLOR_AVISO = { ok: 'text-teal-700', error: 'text-red-700', info: 'text-gray-600' };

export default function RespaldoDatos() {
  const [espacio, setEspacio] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const refArchivo = useRef(null);

  const medir = useCallback(async () => {
    try {
      setEspacio(await espacioEnDisco());
    } catch { /* sin dato de espacio: no se avisa de nada */ }
  }, []);

  useEffect(() => { void Promise.resolve().then(medir); }, [medir]);

  const descargar = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      const respaldo = await construirRespaldo(localDb);
      const url = URL.createObjectURL(new Blob([JSON.stringify(respaldo)], { type: 'application/json' }));
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombreArchivoRespaldo();
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setAviso({ tipo: 'ok', texto: `Respaldo descargado con ${resumenRespaldo(respaldo.conteos)}.` });
    } catch (e) {
      setAviso({ tipo: 'error', texto: 'No se pudo crear el respaldo: ' + e.message });
    } finally {
      setOcupado(false);
    }
  };

  const restaurar = async evento => {
    const archivo = evento.target.files?.[0];
    evento.target.value = ''; // permite volver a elegir el mismo archivo
    if (!archivo) return;
    setOcupado(true);
    setAviso(null);
    try {
      const respaldo = parsearRespaldo(await archivo.text());
      const conteos = await restaurarRespaldo(localDb, respaldo);
      setAviso({
        tipo: 'ok',
        texto: `Restaurado ${resumenRespaldo(conteos)}. Recarga la página (Ctrl+Shift+R) para verlo.`
      });
      void medir();
    } catch (e) {
      setAviso({ tipo: 'error', texto: e.message });
    } finally {
      setOcupado(false);
      setConfirmando(false);
    }
  };

  const nivel = espacio?.nivel;
  const pocoEspacio = nivel === 'critico' || nivel === 'poco';

  return (
    <section className="p-4 border-t bg-gray-50" aria-labelledby="titulo-respaldo">
      <h3 id="titulo-respaldo" className="text-sm font-black text-gray-800">
        💾 Respaldo de este dispositivo
      </h3>
      <p className="text-xs text-gray-600 mt-1 leading-relaxed">
        Este archivo contiene los datos de este navegador, incluidos los cambios pendientes de
        sincronizar. No es una copia automática de Supabase. Puede incluir datos clínicos y adjuntos:
        guárdalo en un lugar privado y no lo envíes por correo.
      </p>

      {espacio && (
        <p className="text-xs text-gray-500 mt-2">
          Espacio usado: <strong className="font-bold">{formatearMB(espacio.usado)}</strong> de{' '}
          {formatearMB(espacio.cuota)} (libre {formatearMB(espacio.libre)})
        </p>
      )}

      {pocoEspacio && (
        <p className="text-xs text-amber-800 bg-amber-100 border border-amber-300 rounded-lg p-2 mt-2">
          ⚠️ Queda poco espacio. Si el navegador se queda sin disco puede <strong>borrar los datos
          locales</strong>. Descarga un respaldo ya.
        </p>
      )}

      {espacio && espacio.persistente === false && (
        <p className="text-xs text-amber-800 bg-amber-100 border border-amber-300 rounded-lg p-2 mt-2">
          ⚠️ Este navegador puede borrar los datos de la app si necesita espacio. Un respaldo es la
          única copia que no depende de él.
        </p>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" onClick={descargar} disabled={ocupado}
          className={`${BOTON} bg-teal-600 hover:bg-teal-700 text-white`}>
          {ocupado ? 'Preparando...' : '⬇ Descargar respaldo'}
        </button>

        {!confirmando ? (
          <button type="button" onClick={() => setConfirmando(true)} disabled={ocupado}
            className={`${BOTON} bg-white border border-gray-300 hover:bg-gray-50 text-gray-700`}>
            ⬆ Restaurar un respaldo
          </button>
        ) : (
          <>
            <button type="button" onClick={() => refArchivo.current?.click()} disabled={ocupado}
              className={`${BOTON} bg-blue-600 hover:bg-blue-700 text-white`}>
              {ocupado ? 'Restaurando...' : 'Sí, elige el archivo'}
            </button>
            <button type="button" onClick={() => setConfirmando(false)}
              className={`${BOTON} bg-white border border-gray-300 hover:bg-gray-50 text-gray-600`}>
              Cancelar
            </button>
          </>
        )}

        <input ref={refArchivo} type="file" accept="application/json,.json" className="hidden"
          aria-label="Archivo de respaldo" onChange={restaurar} />
      </div>

      {confirmando && !ocupado && (
        <p className="text-xs text-gray-600 mt-2">
          Al restaurar se <strong>actualizan</strong> los registros que ya existan. No se borra
          nada de este dispositivo.
        </p>
      )}

      {aviso && (
        <p role="status" aria-live="polite"
          className={`text-xs font-bold mt-3 ${COLOR_AVISO[aviso.tipo] || COLOR_AVISO.info}`}>
          {aviso.texto}
        </p>
      )}
    </section>
  );
}

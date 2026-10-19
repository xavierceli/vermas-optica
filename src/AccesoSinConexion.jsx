// ---------------------------------------------------------------------------
// ENTRAR SIN CONEXION EN ESTE EQUIPO (PIN local)
// ---------------------------------------------------------------------------
// La app funcionaba sin internet, pero para ABRIRLA hacia falta internet. El
// PIN existia en el codigo (seguridad.js) y ninguna pantalla lo configurara, asi
// que el recuadro "Entrar sin conexion" de la pantalla de acceso nunca salia:
// si se caia la conexion antes de entrar, no habia forma de trabajar con los
// datos que ya estaban en el equipo.
//
// El PIN NO es una credencial de servidor: no crea sesion ni permite tocar
// Supabase. Solo desbloquea los datos guardados en ESTE dispositivo, cifrados
// con PBKDF2 + SHA-256 (210.000 iteraciones, ver seguridad.js). Tras 5 fallos
// el desbloqueo se bloquea 15 minutos.
//
// Se ofrece dentro del panel de sincronizacion, junto al respaldo, porque los
// dos responden a la misma pregunta: que pasa con los datos de este equipo.
import { useState } from 'react';

const BOTON = 'text-xs font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-50';
const CAMPO = 'w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white transition-all font-semibold text-gray-900 text-sm';
const COLOR_AVISO = { ok: 'text-teal-700', error: 'text-red-700', info: 'text-gray-600' };

const soloDigitos = valor => String(valor || '').replace(/\D/g, '').slice(0, 8);

export default function AccesoSinConexion({ gestor }) {
  const [pin, setPin] = useState('');
  const [repetir, setRepetir] = useState('');
  const [verPin, setVerPin] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const enrolado = Boolean(gestor?.dispositivo?.enrolado);

  const activar = async evento => {
    evento.preventDefault();
    setAviso(null);

    if (pin !== repetir) {
      setAviso({ tipo: 'error', texto: 'Los dos PIN no coinciden. Vuelve a escribirlos.' });
      return;
    }

    setTrabajando(true);
    try {
      const ok = await gestor.configurarAccesoSinConexion(pin);
      if (ok) {
        // No hace falta aviso: la seccion cambia sola a "activado".
        setPin('');
        setRepetir('');
      } else {
        setAviso({ tipo: 'error', texto: 'El PIN debe tener entre 4 y 8 dígitos numéricos.' });
      }
    } catch (e) {
      setAviso({ tipo: 'error', texto: 'No se pudo guardar el PIN en este equipo: ' + (e?.message || 'error desconocido') });
    } finally {
      setTrabajando(false);
    }
  };

  const desactivar = async () => {
    setAviso(null);
    setTrabajando(true);
    try {
      await gestor.desactivarAccesoSinConexion();
      setAviso({ tipo: 'info', texto: 'Desactivado: este equipo vuelve a pedir correo y contraseña.' });
    } catch (e) {
      setAviso({ tipo: 'error', texto: 'No se pudo desactivar: ' + (e?.message || 'error desconocido') });
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <section
      className="mt-4 p-4 border border-gray-200 rounded-xl bg-gray-50"
      aria-labelledby="titulo-acceso-sin-conexion"
    >
      <h3 id="titulo-acceso-sin-conexion" className="text-sm font-black text-gray-800">
        🔌 Entrar sin conexión en este equipo
      </h3>
      <p className="text-xs text-gray-600 mt-1 leading-relaxed">
        Con un PIN de 4 a 8 dígitos podrás abrir la app y consultar lo ya guardado en este
        dispositivo aunque no haya internet. El PIN no da acceso al servidor: solo abre los datos
        locales, así que no lo compartas.
      </p>

      {enrolado ? (
        <>
          <p className="text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-lg p-2 mt-2 font-medium">
            ✅ Activado en este equipo. Si no hay internet, en la pantalla de acceso aparecerá
            «Entrar sin conexión» con este PIN.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              onClick={desactivar}
              disabled={trabajando}
              className={`${BOTON} bg-white border border-gray-300 hover:bg-gray-50 text-gray-700`}
            >
              {trabajando ? 'Desactivando…' : 'Desactivar acceso sin conexión'}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={activar} className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="pin-sin-conexion" className="block text-xs font-bold text-gray-800">
              PIN (4 a 8 dígitos)
            </label>
            <button
              type="button"
              onClick={() => setVerPin(v => !v)}
              aria-pressed={verPin}
              title={verPin ? 'Ocultar los PIN' : 'Mostrar los PIN'}
              className="text-xs text-teal-700 hover:text-teal-900 font-bold py-1 transition-colors"
            >
              {verPin ? 'Ocultar' : 'Ver'}
            </button>
          </div>
          <input
            id="pin-sin-conexion"
            type={verPin ? 'text' : 'password'}
            inputMode="numeric"
            autoComplete="new-password"
            value={pin}
            onChange={e => setPin(soloDigitos(e.target.value))}
            className={CAMPO}
            placeholder="0000"
            required
          />

          <label htmlFor="pin-sin-conexion-repetir" className="block text-xs font-bold text-gray-800">
            Repite el PIN
          </label>
          <input
            id="pin-sin-conexion-repetir"
            type={verPin ? 'text' : 'password'}
            inputMode="numeric"
            autoComplete="new-password"
            value={repetir}
            onChange={e => setRepetir(soloDigitos(e.target.value))}
            className={CAMPO}
            placeholder="0000"
            required
          />

          <button
            type="submit"
            disabled={trabajando || pin.length < 4 || repetir.length < 4}
            className={`${BOTON} bg-teal-700 hover:bg-teal-800 text-white`}
          >
            {trabajando ? 'Guardando…' : 'Activar acceso sin conexión'}
          </button>
        </form>
      )}

      {aviso && (
        <p
          role={aviso.tipo === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`text-xs font-bold mt-3 ${COLOR_AVISO[aviso.tipo] || COLOR_AVISO.info}`}
        >
          {aviso.texto}
        </p>
      )}
    </section>
  );
}

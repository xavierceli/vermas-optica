import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { localDb } from '../localDb';
import { fijarSesionAusente } from '../syncEngine';
import { 
  enrolarDispositivo, leerEnrolamiento, intentarDesbloqueo, 
  revocarEnrolamiento, pinValido 
} from '../seguridad';

// ---------------------------------------------------------------------------
// AUTENTICACION Y ACCESO
// ---------------------------------------------------------------------------
// Sesion de Supabase, enrolamiento del dispositivo para entrar sin conexion
// (PIN), y el cierre de sesion. Los dos efectos mantienen la sesion estricta:
// una sesion invalida o un cambio de clave pendiente no dan acceso.
// ---------------------------------------------------------------------------
export function useAutenticacion({ mostrarToast, solicitarConfirmacion, obtenerDatos, limpiarDatos }) {
  const [estaAutenticado, setEstaAutenticado] = useState(false);
  const [cargandoAuth, setCargandoAuth] = useState(true);
  const [modoSinConexion, setModoSinConexion] = useState(false);
  const [dispositivo, setDispositivo] = useState({ enrolado: false, cargando: true, identidad: null });

  const refrescarDispositivo = async () => {
    const enrolamiento = await leerEnrolamiento(localDb.meta);
    setDispositivo({ enrolado: Boolean(enrolamiento), cargando: false, identidad: enrolamiento?.identidad || null });
  };

  const configurarAccesoSinConexion = async pin => {
    if (!pinValido(pin)) {
      mostrarToast('El PIN debe tener entre 4 y 8 dígitos.', 'warning');
      return false;
    }
    await enrolarDispositivo({ pin, identidad: dispositivo.identidad, meta: localDb.meta });
    await refrescarDispositivo();
    mostrarToast('Acceso sin conexión configurado en este dispositivo.', 'success');
    return true;
  };

  const desactivarAccesoSinConexion = async () => {
    await revocarEnrolamiento(localDb.meta);
    await refrescarDispositivo();
    mostrarToast('Acceso sin conexión desactivado.', 'success');
  };

  const cerrarSesion = () => {
    const estabaSinConexion = modoSinConexion;
    const aviso = estabaSinConexion
      ? 'Vas a salir del modo sin conexión. Los datos de este dispositivo NO se borran: puedes volver a entrar con tu PIN.'
      : '¿Estás seguro de cerrar sesión? Tendrás que volver a ingresar con tus credenciales.';
    solicitarConfirmacion(aviso, async () => {
      setModoSinConexion(false);
      fijarSesionAusente(true);
      setEstaAutenticado(false);
      limpiarDatos();
      if (!estabaSinConexion) await supabase.auth.signOut();
    });
  };

  useEffect(() => {
    let vigente = true;
    leerEnrolamiento(localDb.meta).then(enrolamiento => {
      if (vigente) setDispositivo({ enrolado: Boolean(enrolamiento), cargando: false, identidad: enrolamiento?.identidad || null });
    });
    return () => { vigente = false; };
  }, []);

  const entrarSinConexion = async pin => {
    const resultado = await intentarDesbloqueo({
      pin,
      meta: localDb.meta,
      alBloquear: async () => {
        mostrarToast('Demasiados intentos. Espera 15 minutos antes de volver a intentar.', 'error');
      }
    });
    if (resultado.ok) {
      setModoSinConexion(true);
      fijarSesionAusente(true);
      setEstaAutenticado(true);
      await obtenerDatos({ sync: false });
      mostrarToast('Modo sin conexión: los datos locales están disponibles.', 'warning');
      return { ok: true };
    }
    return resultado;
  };

  useEffect(() => {
    let montado = true;
    const cambioClavePendiente = sessionStorage.getItem('vermas_cambio_clave') === '1';

    // 1. Verificación inicial de sesión estricta
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!montado) return;

      if (error || !session || cambioClavePendiente) {
        setEstaAutenticado(false);
        fijarSesionAusente(true);
        setCargandoAuth(false);
        return;
      }

      setEstaAutenticado(true);
      fijarSesionAusente(false);
      setModoSinConexion(false);
      obtenerDatos();
      setCargandoAuth(false);
    }).catch((err) => {
      console.warn('[auth] Error al verificar sesión:', err);
      if (montado) {
        setEstaAutenticado(false);
        fijarSesionAusente(true);
        setCargandoAuth(false);
      }
    });

    // 2. Suscripción a eventos de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!montado) return;

      if (event === 'PASSWORD_RECOVERY') {
        sessionStorage.setItem('vermas_cambio_clave', '1');
        setModoSinConexion(false);
        fijarSesionAusente(true);
        setEstaAutenticado(false);
        setCargandoAuth(false);
        return;
      }

      if (event === 'SIGNED_OUT' || !session) {
        setEstaAutenticado(false);
        fijarSesionAusente(true);
        limpiarDatos();
        setCargandoAuth(false);
        return;
      }

      if (event === 'SIGNED_IN' && session) {
        const siguePendiente = sessionStorage.getItem('vermas_cambio_clave') === '1';
        if (!siguePendiente) {
          setEstaAutenticado(true);
          fijarSesionAusente(false);
          obtenerDatos();
        }
        setCargandoAuth(false);
      }
    });

    return () => {
      montado = false;
      subscription?.unsubscribe();
    };
  }, [obtenerDatos, limpiarDatos]);

  return {
    estaAutenticado, cargandoAuth, modoSinConexion, dispositivo,
    configurarAccesoSinConexion, desactivarAccesoSinConexion, cerrarSesion, entrarSinConexion
  };
}

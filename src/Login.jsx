import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

const CLAVE_RECUPERACION = 'vermas_cambio_clave';

const detectarRecuperacion = () => {
  if (typeof window === 'undefined') return false;
  return window.location.hash.includes('type=recovery')
    || sessionStorage.getItem(CLAVE_RECUPERACION) !== null;
};

export default function Login({ dispositivo, entrarSinConexion }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [modoNuevaClave] = useState(detectarRecuperacion);
  const [mensaje, setMensaje] = useState(() => (modoNuevaClave
    ? { texto: 'Crea tu nueva contraseña para volver a ingresar.', tipo: 'warning' }
    : { texto: '', tipo: '' }));
  
  const [modoRecuperar, setModoRecuperar] = useState(false);
  const [nuevaClave, setNuevaClave] = useState('');
  const [confirmarClave, setConfirmarClave] = useState('');

  const [pinLocal, setPinLocal] = useState('');
  const [verPin, setVerPin] = useState(false);
  const [desbloqueando, setDesbloqueando] = useState(false);

  const manejarDesbloqueoLocal = async (e) => {
    e.preventDefault();
    if (!entrarSinConexion) return;
    setDesbloqueando(true);
    const resultado = await entrarSinConexion(pinLocal);
    setDesbloqueando(false);
    setPinLocal('');
    if (resultado?.ok) return;
    if (resultado?.bloqueado) {
      const minutos = resultado?.minutos;
      setMensaje({
        texto: minutos
          ? `Demasiados intentos. Podrás volver a intentarlo en ${minutos} minuto(s). Tus datos siguen guardados.`
          : 'Demasiados intentos. Espera unos minutos antes de volver a intentar.',
        tipo: 'error'
      });
      return;
    }
    if (resultado?.restantes !== undefined) {
      setMensaje({ texto: `PIN incorrecto. Le quedan ${resultado.restantes} intento(s).`, tipo: 'error' });
      return;
    }
    if (resultado?.error) setMensaje({ texto: resultado.error, tipo: 'error' });
  };

  useEffect(() => {
    if (window.location.hash.includes('type=recovery')) {
      sessionStorage.setItem(CLAVE_RECUPERACION, '1');
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const manejarLogin = async (e) => {
    e.preventDefault();
    setCargando(true);
    setMensaje({ texto: '', tipo: '' });
    
    if (!navigator.onLine) {
      setCargando(false);
      return setMensaje({ texto: '⚠️ Sin conexión a internet. El inicio de sesión requiere internet para validar tus credenciales en el servidor. Si ya tenías sesión abierta en este equipo, simplemente recarga para trabajar con la bóveda local.', tipo: 'warning' });
    }
    
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error) {
      const textoError = String(error?.message || '').toLowerCase();
      const esErrorRed = textoError.includes('fetch') || textoError.includes('network');
      if (esErrorRed) {
        setMensaje({ texto: 'Se perdió la conexión durante el inicio de sesión. Revisa tu internet e intenta de nuevo.', tipo: 'warning' });
      } else {
        setMensaje({ texto: 'Credenciales incorrectas. Verifica tu correo o contraseña.', tipo: 'error' });
      }
    } finally {
      setCargando(false);
    }
  };

  const recuperarContrasena = async (e) => {
    e.preventDefault();
    if (!email) {
      setMensaje({ texto: 'Por favor, ingresa tu correo para enviarte el enlace.', tipo: 'warning' });
      return;
    }
    
    if (!navigator.onLine) {
      return setMensaje({ texto: '⚠️ Sin conexión a internet. El enlace de recuperación se envía por correo electrónico. Reconéctate e intenta de nuevo.', tipo: 'warning' });
    }
    
    setCargando(true);
    setMensaje({ texto: '', tipo: '' });
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin, 
      });
      if (error) throw error;
      
      setMensaje({ texto: '¡Listo! Revisa tu bandeja de entrada o correo no deseado para crear tu nueva clave.', tipo: 'success' });
      
      setTimeout(() => {
        setModoRecuperar(false);
        setMensaje({ texto: '', tipo: '' });
      }, 5000);
      
    } catch (error) {
      console.error("Error en recuperación:", error);
      const textoError = String(error?.message || '').toLowerCase();
      
      if (textoError.includes('fetch') || textoError.includes('network')) {
        setMensaje({ texto: 'Se perdió la conexión. Revisa tu internet e intenta de nuevo.', tipo: 'warning' });
      } else if (textoError.includes('rate') || textoError.includes('limit')) {
        setMensaje({ texto: 'Por seguridad, solo se puede solicitar el enlace periódicamente. Espera unos minutos e intenta de nuevo.', tipo: 'warning' });
      } else {
        setMensaje({ texto: 'Error: ' + (error?.message || 'No se pudo procesar la solicitud'), tipo: 'error' });
      }
    } finally {
      setCargando(false);
    }
  };

  const guardarNuevaClave = async (e) => {
    e.preventDefault();
    if (nuevaClave.length < 6) {
      return setMensaje({ texto: 'La contraseña debe tener al menos 6 caracteres.', tipo: 'warning' });
    }
    if (nuevaClave !== confirmarClave) {
      return setMensaje({ texto: 'Las contraseñas no coinciden.', tipo: 'warning' });
    }
    
    setCargando(true);
    setMensaje({ texto: '', tipo: '' });
    
    try {
      const { error } = await supabase.auth.updateUser({ password: nuevaClave });
      if (error) throw error;
      
      sessionStorage.removeItem('vermas_cambio_clave');
      setMensaje({ texto: '¡Contraseña actualizada! Entrando al sistema...', tipo: 'success' });
      
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      setMensaje({ texto: 'Error al actualizar: ' + error.message, tipo: 'error' });
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-xl w-full max-w-md border-t-8 border-teal-600">
        
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-black text-teal-800 tracking-wider">VER+ ÓPTICA</h1>
          <p className="text-gray-600 font-medium text-xs sm:text-sm mt-1">
            {modoNuevaClave ? 'Crear Nueva Contraseña' : modoRecuperar ? 'Recuperación de Acceso' : 'Sistema de Gestión Integrada'}
          </p>
        </div>

        {mensaje.texto && (
          <div className={`p-3.5 sm:p-4 rounded-lg mb-6 text-xs sm:text-sm font-bold text-center ${
            mensaje.tipo === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 
            mensaje.tipo === 'warning' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
            'bg-green-50 text-green-800 border border-green-200'
          }`}>
            {mensaje.texto}
          </div>
        )}

        {modoNuevaClave ? (
          <form onSubmit={guardarNuevaClave} className="space-y-4 sm:space-y-5">
            <div>
              <label htmlFor="nueva-clave" className="block text-xs sm:text-sm font-bold text-gray-800 mb-1">Nueva Contraseña</label>
              <input 
                id="nueva-clave"
                type="password" 
                value={nuevaClave}
                onChange={(e) => setNuevaClave(e.target.value)}
                className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white transition-all font-semibold text-gray-900 text-sm"
                placeholder="Mínimo 6 caracteres"
                required 
              />
            </div>
            <div>
              <label htmlFor="confirmar-clave" className="block text-xs sm:text-sm font-bold text-gray-800 mb-1">Confirmar Contraseña</label>
              <input 
                id="confirmar-clave"
                type="password" 
                value={confirmarClave}
                onChange={(e) => setConfirmarClave(e.target.value)}
                className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white transition-all font-semibold text-gray-900 text-sm"
                placeholder="Repite la nueva contraseña"
                required 
              />
            </div>
            <button 
              type="submit" 
              disabled={cargando}
              className={`w-full p-3 rounded-lg font-black text-white shadow-md transition-all text-sm sm:text-base ${cargando ? 'bg-gray-400 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-700 active:scale-95'}`}
            >
              {cargando ? 'Guardando...' : '🔐 Guardar Nueva Contraseña'}
            </button>
          </form>
        ) : (
          <form onSubmit={modoRecuperar ? recuperarContrasena : manejarLogin} className="space-y-4 sm:space-y-5">
            <div>
              <label htmlFor="login-email" className="block text-xs sm:text-sm font-bold text-gray-800 mb-1">Correo Electrónico</label>
              <input 
                id="login-email"
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value.toLowerCase())}
                className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white transition-all font-semibold text-gray-900 text-sm"
                placeholder="tu@correo.com"
                required
              />
            </div>

            {!modoRecuperar && (
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="login-password" className="block text-xs sm:text-sm font-bold text-gray-800">Contraseña</label>
                  <button 
                    type="button" 
                    onClick={() => { setModoRecuperar(true); setMensaje({texto:'', tipo:''}); }}
                    className="text-xs text-teal-700 hover:text-teal-900 font-bold transition-colors py-1"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
                <input 
                  id="login-password"
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white transition-all font-semibold text-gray-900 text-sm"
                  placeholder="••••••••"
                  required={!modoRecuperar}
                />
              </div>
            )}

            <button 
              type="submit" 
              disabled={cargando}
              className={`w-full p-3 rounded-lg font-black text-white shadow-md transition-all text-sm sm:text-base ${
                cargando ? 'bg-gray-400 cursor-not-allowed' : 
                modoRecuperar ? 'bg-amber-500 hover:bg-amber-600 active:scale-95' : 'bg-teal-600 hover:bg-teal-700 active:scale-95'
              }`}
            >
              {cargando ? 'Procesando...' : (modoRecuperar ? '📧 Enviar Enlace' : '🔐 Ingresar al Sistema')}
            </button>
          </form>
        )}

        {modoRecuperar && !modoNuevaClave && (
          <div className="mt-5 text-center">
            <button 
              type="button" 
              onClick={() => { setModoRecuperar(false); setMensaje({texto:'', tipo:''}); }}
              className="text-xs sm:text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors py-1"
            >
              🔙 Volver al inicio de sesión
            </button>
          </div>
        )}

        {dispositivo?.enrolado && !modoNuevaClave && (
          <div className="mt-6 pt-6 border-t border-dashed border-gray-300">
            <p className="text-center text-xs text-gray-600 font-medium mb-3">
              ¿Sin internet? Entra con el PIN configurado en este dispositivo.
            </p>
            <form onSubmit={manejarDesbloqueoLocal} className="space-y-2">
              <input
                id="pin-local"
                aria-label="PIN de acceso sin conexión, de 4 a 8 dígitos"
                type={verPin ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                value={pinLocal}
                onChange={(e) => setPinLocal(e.target.value.replace(/\D/g, ''))}
                placeholder="PIN de 4 a 8 dígitos"
                className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 text-center tracking-[0.4em] font-bold text-gray-900 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={desbloqueando || pinLocal.length < 4}
                  className="flex-1 py-2.5 rounded-lg font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 transition-colors text-xs sm:text-sm"
                >
                  {desbloqueando ? 'Abriendo…' : 'Entrar sin conexión'}
                </button>
                <button
                  type="button"
                  onClick={() => setVerPin(v => !v)}
                  className="px-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs transition-colors"
                >
                  {verPin ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </form>
            <p className="text-[11px] text-gray-500 text-center mt-2 font-medium">
              Solo abre los datos guardados en este equipo. No accede al servidor.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
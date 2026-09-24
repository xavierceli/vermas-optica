import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });
  
  const [modoRecuperar, setModoRecuperar] = useState(false);
  const [modoNuevaClave, setModoNuevaClave] = useState(false);
  const [nuevaClave, setNuevaClave] = useState('');
  const [confirmarClave, setConfirmarClave] = useState('');

  // Detectar si venimos del enlace de recuperación (por la URL o por el flag)
  useEffect(() => {
    if (window.location.hash.includes('type=recovery')) {
      sessionStorage.setItem('vermas_cambio_clave', '1');
      // Limpiar la URL para no dejar tokens visibles en la barra del navegador
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (sessionStorage.getItem('vermas_cambio_clave')) {
      setModoNuevaClave(true);
      setModoRecuperar(false);
      setMensaje({ texto: 'Crea tu nueva contraseña para volver a ingresar.', tipo: 'warning' });
    }
  }, []);

  const manejarLogin = async (e) => {
    e.preventDefault();
    setCargando(true);
    setMensaje({ texto: '', tipo: '' });
    
    // Honestidad primero: sin internet no se puede validar una contraseña
    if (!navigator.onLine) {
      setCargando(false);
      return setMensaje({ texto: '⚠️ Sin conexión a internet. El inicio de sesión requiere internet (tu contraseña se valida en el servidor, por seguridad). Si ya habías ingresado en este dispositivo y NO cerraste sesión, simplemente abre la app: el sistema funciona sin internet con la bóveda local.', tipo: 'warning' });
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
    
    // Honestidad primero: el enlace se envía por correo, requiere internet
    if (!navigator.onLine) {
      return setMensaje({ texto: '⚠️ Sin conexión a internet. El enlace de recuperación se envía por correo electrónico, por lo que necesita conexión. Reconéctate e intenta de nuevo.', tipo: 'warning' });
    }
    
    setCargando(true);
    setMensaje({ texto: '', tipo: '' });
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin, 
      });
      if (error) throw error;
      
      setMensaje({ texto: '¡Listo! Revisa tu bandeja de entrada o spam para crear tu nueva clave.', tipo: 'success' });
      
      setTimeout(() => {
        setModoRecuperar(false);
        setMensaje({ texto: '', tipo: '' });
      }, 5000);
      
    } catch (error) {
      console.error("Error en recuperación:", error);
      const textoError = String(error?.message || '').toLowerCase();
      
      if (textoError.includes('fetch') || textoError.includes('network')) {
        setMensaje({ texto: 'Se perdió la conexión. Revisa tu internet e intenta de nuevo.', tipo: 'warning' });
      } else if (textoError.includes('60 seconds') || textoError.includes('rate')) {
        setMensaje({ texto: 'Por seguridad, solo se puede pedir el enlace cada 60 segundos. Espera un minuto e intenta de nuevo.', tipo: 'warning' });
      } else {
        setMensaje({ texto: 'Error: ' + (error?.message || 'desconocido'), tipo: 'error' });
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
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border-t-8 border-teal-600">
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-teal-800 tracking-wider">VER+ ÓPTICA</h1>
          <p className="text-gray-500 font-medium mt-1">
            {modoNuevaClave ? 'Crear Nueva Contraseña' : modoRecuperar ? 'Recuperación de Acceso' : 'Sistema de Gestión Integrada'}
          </p>
        </div>

        {mensaje.texto && (
          <div className={`p-4 rounded-lg mb-6 text-sm font-bold text-center ${
            mensaje.tipo === 'error' ? 'bg-red-50 text-red-600 border border-red-200' : 
            mensaje.tipo === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
            'bg-green-50 text-green-700 border border-green-200'
          }`}>
            {mensaje.texto}
          </div>
        )}

        {modoNuevaClave ? (
          <form onSubmit={guardarNuevaClave} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Nueva Contraseña</label>
              <input 
                type="password" 
                value={nuevaClave}
                onChange={(e) => setNuevaClave(e.target.value)}
                className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white transition-all font-medium"
                placeholder="Mínimo 6 caracteres"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Confirmar Contraseña</label>
              <input 
                type="password" 
                value={confirmarClave}
                onChange={(e) => setConfirmarClave(e.target.value)}
                className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white transition-all font-medium"
                placeholder="Repite la nueva contraseña"
                required 
              />
            </div>
            <button 
              type="submit" 
              disabled={cargando}
              className={`w-full p-3 rounded-lg font-black text-white shadow-md transition-all ${cargando ? 'bg-gray-400 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-700'}`}
            >
              {cargando ? 'Guardando...' : '🔐 Guardar Nueva Contraseña'}
            </button>
          </form>
        ) : (
          <form onSubmit={modoRecuperar ? recuperarContrasena : manejarLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Correo Electrónico</label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value.toLowerCase())}
                className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white transition-all font-medium"
                placeholder="tu@correo.com"
                required
              />
            </div>

            {!modoRecuperar && (
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-sm font-bold text-gray-700">Contraseña</label>
                  <button 
                    type="button" 
                    onClick={() => { setModoRecuperar(true); setMensaje({texto:'', tipo:''}); }}
                    className="text-xs text-teal-600 hover:text-teal-800 font-bold transition-colors"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white transition-all font-medium"
                  placeholder="••••••••"
                  required={!modoRecuperar}
                />
              </div>
            )}

            <button 
              type="submit" 
              disabled={cargando}
              className={`w-full p-3 rounded-lg font-black text-white shadow-md transition-all ${
                cargando ? 'bg-gray-400 cursor-not-allowed' : 
                modoRecuperar ? 'bg-amber-500 hover:bg-amber-600' : 'bg-teal-600 hover:bg-teal-700'
              }`}
            >
              {cargando ? 'Procesando...' : (modoRecuperar ? '📧 Enviar Enlace' : '🔐 Ingresar al Sistema')}
            </button>
          </form>
        )}

        {modoRecuperar && !modoNuevaClave && (
          <div className="mt-6 text-center">
            <button 
              type="button" 
              onClick={() => { setModoRecuperar(false); setMensaje({texto:'', tipo:''}); }}
              className="text-sm font-bold text-gray-500 hover:text-gray-800 transition-colors"
            >
              🔙 Volver al inicio de sesión
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
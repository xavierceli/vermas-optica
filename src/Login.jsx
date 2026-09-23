import { useState } from 'react';
import { supabase } from './supabaseClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });
  
  // Controlador para cambiar entre modo "Ingresar" y "Recuperar"
  const [modoRecuperar, setModoRecuperar] = useState(false);

  const manejarLogin = async (e) => {
    e.preventDefault();
    setCargando(true);
    setMensaje({ texto: '', tipo: '' });
    
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Si es exitoso, App.jsx detectará la sesión automáticamente y cargará el sistema
    } catch (error) {
      setMensaje({ texto: 'Credenciales incorrectas. Verifica tu correo o contraseña.', tipo: 'error' });
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
    
    setCargando(true);
    setMensaje({ texto: '', tipo: '' });
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin, 
      });
      if (error) throw error;
      
      setMensaje({ texto: '¡Listo! Revisa tu bandeja de entrada o spam para crear tu nueva clave.', tipo: 'success' });
      
      // Volver a la pantalla normal después de 5 segundos
      setTimeout(() => {
        setModoRecuperar(false);
        setMensaje({ texto: '', tipo: '' });
      }, 5000);
      
    } catch (error) {
      setMensaje({ texto: 'Hubo un error conectando con el servidor. Intenta de nuevo.', tipo: 'error' });
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
            {modoRecuperar ? 'Recuperación de Acceso' : 'Sistema de Gestión Integrada'}
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

        <form onSubmit={modoRecuperar ? recuperarContrasena : manejarLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Correo Electrónico</label>
            <input 
              type="email" 
              value={email}
              // Forzamos minúsculas para correos
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

        {modoRecuperar && (
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
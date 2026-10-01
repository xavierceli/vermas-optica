import { createClient } from '@supabase/supabase-js';

// 1. Lee las variables del entorno si existen o usa los valores de respaldo
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://uaflmzuklixcpqspiyqi.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_6OdeKTv6wQwNHok7iOUb0A_bSgZyH7s';

// 2. Comprobación de seguridad
if (!supabaseUrl || !supabaseKey) {
  console.warn('[Supabase] Advertencia: Faltan credenciales de conexión. La app operará únicamente en modo local.');
}

// 3. Adapter de almacenamiento seguro para PWA y navegadores móviles
const storageAdapter = (() => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const prueba = '__sb_test__';
      window.localStorage.setItem(prueba, prueba);
      window.localStorage.removeItem(prueba);
      return window.localStorage;
    }
  } catch {
    console.warn('[Supabase] localStorage no disponible; utilizando almacenamiento en memoria temporal.');
  }

  const memoria = new Map();
  return {
    getItem: key => memoria.get(key) ?? null,
    setItem: (key, val) => { memoria.set(key, String(val)); },
    removeItem: key => { memoria.delete(key); }
  };
})();

// 4. Exporta el cliente de Supabase optimizado
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: storageAdapter
  }
});
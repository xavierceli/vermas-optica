import { createClient } from '@supabase/supabase-js';

// 1. Lee las variables del entorno si existen, o usa las claves directas de respaldo
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://uaflmzuklixcpqspiyqi.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_6OdeKTv6wQwNHok7iOUb0A_bSgZyH7s';

// 2. Comprobación de seguridad para evitar pantallas blancas
if (!supabaseUrl || !supabaseKey) {
  console.error('[Supabase] Advertencia: Faltan credenciales de conexión. La app operará en modo local.');
}

// 3. Exporta la conexión de forma segura
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
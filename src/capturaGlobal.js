// ---------------------------------------------------------------------------
// CAPTURA DE ERRORES QUE NINGUN BLOQUE CAPTURA
// ---------------------------------------------------------------------------
// Un error de render lo atrapa <ErrorBoundary>. Pero hay errores que ocurren
// fuera de React: un promesa rechazada sin await, un error en un manejador de
// evento, un fallo de un script. Esos solo aparecian en la consola, que se
// cerraba al cerrar la pestana, y el soporte no tenia con que trabajar.
//
// Aqui se recogen y se guardan en el dispositivo. NO se muestra ningun aviso:
// un error que no rompio la app no debe interrumpir al optometria.
import { localDb } from './localDb';
import { registrarError } from './registroErrores';

let instalado = false;
const desuscribir = [];

/**
 * Idempotente: se puede llamar varias veces (StrictMode monta dos veces en
 * desarrollo) sin duplicar los oyentes ni contar dos veces el mismo error.
 * Devuelve la funcion de limpieza.
 */
export const instalarCapturaGlobal = () => {
  if (instalado || typeof window === 'undefined') return () => {};
  instalado = true;

  const anotar = (error, contexto) => {
    // Un fallo al registrar no debe crear otro fallo: se traga en silencio.
    void Promise.resolve(registrarError(localDb.meta, error, contexto)).catch(() => {});
  };

  const alError = evento => {
    // Los recursos que no cargan (una foto, un script de Vercel) no son fallos
    // de la aplicacion: solo se guardan los de codigo propio.
    if (evento?.target && evento.target !== window) return;
    anotar(evento?.error || evento?.message, 'ventana');
  };

  const alRechazo = evento => {
    // Una peticion que falla por falta de red es lo normal en una optica sin
    // internet: el motor de sincronizacion ya la reintenta y la informa.
    const razon = evento?.reason;
    if (razon?.name === 'AbortError') return;
    if (razon?.message && /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(razon.message)) return;
    anotar(razon, 'promesa');
  };

  window.addEventListener('error', alError);
  window.addEventListener('unhandledrejection', alRechazo);
  desuscribir.push(
    () => window.removeEventListener('error', alError),
    () => window.removeEventListener('unhandledrejection', alRechazo)
  );

  return () => {
    desuscribir.splice(0).forEach(quitar => quitar());
    instalado = false;
  };
};
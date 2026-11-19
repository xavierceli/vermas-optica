import { localDb } from '../localDb.js';
import { leerErrores } from '../registroErrores.js';

// La app ya guarda los ultimos errores en la meta de Dexie (los registra el
// ErrorBoundary y la captura global), pero solo se veian cuando la pantalla
// reventaba. Desde el panel de problemas se pueden leer para pedir ayuda.
export const leerErroresLocales = () => leerErrores(localDb.meta);

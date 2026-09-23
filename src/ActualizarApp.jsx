import React, { useState, useEffect } from 'react';
import { leerBoveda } from './motorOffline';

export function ActualizarApp() {
  const [hayNuevaVersion, setHayNuevaVersion] = useState(false);
  const [actualizador, setActualizador] = useState(null);

  useEffect(() => {
    // Intentamos cargar el registrador de PWA de forma segura sin romper la app
    try {
      import('virtual:pwa-register').then(({ registerSW }) => {
        const update = registerSW({
          onNeedRefresh() {
            setHayNuevaVersion(true);
          },
          onOfflineReady() {
            console.log("App lista para uso offline.");
          },
        });
        setActualizador(() => update);
      }).catch((e) => {
        console.warn("PWA Service Worker no soportado en este entorno:", e);
      });
    } catch (err) {
      console.warn("Modulo virtual PWA omitido de forma segura.");
    }
  }, []);

  const intentarActualizar = async () => {
    try {
      const bandeja = await leerBoveda('bandeja_salida') || [];
      if (bandeja.length > 0) {
        alert(`⚠️ ATENCIÓN: Tienes ${bandeja.length} operaciones pendientes de sincronizar. Conecta tu internet para subirlas antes de actualizar.`);
        return;
      }
      if (actualizador) {
        actualizador(true);
      } else {
        window.location.reload();
      }
    } catch (e) {
      window.location.reload();
    }
  };

  if (!hayNuevaVersion) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-teal-800 text-white p-4 rounded-xl shadow-2xl border-2 border-teal-400 flex items-center gap-4 animate-bounce">
      <div>
        <p className="font-bold text-sm">🚀 ¡Nueva versión disponible!</p>
        <p className="text-xs text-teal-200">Tus datos están protegidos.</p>
      </div>
      <button
        onClick={intentarActualizar}
        className="bg-white text-teal-900 px-3 py-1.5 rounded-lg font-bold text-xs hover:bg-teal-100 transition-all shadow"
      >
        Actualizar Ahora
      </button>
    </div>
  );
}
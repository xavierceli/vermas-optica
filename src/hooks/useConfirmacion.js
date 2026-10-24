import { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// DIALOGO DE CONFIRMACION GLOBAL
// ---------------------------------------------------------------------------
// Reemplaza a window.confirm()/alert(): una sola instancia de dialogo por
// aplicacion. `solicitarConfirmacion` se dispara y olvida (fire and forget),
// mientras que `confirmar` devuelve una promesa con la decision del usuario.
// Se aisla aqui para que useGestor sea solo el orquestador.
// solicitarConfirmacion y confirmar son estables (deps vacias): viajan como
// props hasta componentes memoizados y no deben cambiar de referencia.
// ---------------------------------------------------------------------------
export function useConfirmacion() {
  const [confirmDialog, setConfirmDialog] = useState({
    visible: false, mensaje: '', onConfirm: null, onCancel: null
  });

  const cancelarConfirmacion = useCallback(() => {
    const pendiente = confirmDialog.onCancel;
    setConfirmDialog({ visible: false, mensaje: '', onConfirm: null, onCancel: null });
    if (typeof pendiente === 'function') pendiente();
  }, [confirmDialog]);

  const aceptarConfirmacion = useCallback(() => {
    const pendiente = confirmDialog.onConfirm;
    setConfirmDialog({ visible: false, mensaje: '', onConfirm: null, onCancel: null });
    if (typeof pendiente === 'function') pendiente();
  }, [confirmDialog]);

  const solicitarConfirmacion = useCallback((mensaje, onConfirmCallback) => {
    setConfirmDialog({ visible: true, mensaje, onConfirm: onConfirmCallback, onCancel: null });
  }, []);

  const confirmar = useCallback((mensaje, textoSi = 'Sí, Continuar') => new Promise(resolve => {
    let respondido = false;
    const responder = valor => {
      if (respondido) return;
      respondido = true;
      setConfirmDialog({ visible: false, mensaje: '', onConfirm: null, onCancel: null });
      resolve(valor);
    };
    setConfirmDialog({
      visible: true, mensaje, textoSi,
      onConfirm: () => responder(true), onCancel: () => responder(false)
    });
  }), []);

  return {
    confirmDialog, setConfirmDialog,
    cancelarConfirmacion, aceptarConfirmacion, solicitarConfirmacion, confirmar
  };
}

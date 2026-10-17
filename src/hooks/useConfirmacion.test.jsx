// ---------------------------------------------------------------------------
// useConfirmacion: el diálogo global de la app
// ---------------------------------------------------------------------------
// Es la pieza que sustituyó a window.confirm()/alert(). Se prueba la promesa
// (`confirmar`) y el disparo y olvido (`solicitarConfirmacion`).
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfirmacion } from './useConfirmacion.js';

describe('useConfirmacion', () => {
  it('confirmar() resuelve true al aceptar', async () => {
    const { result } = renderHook(() => useConfirmacion());

    let respuesta;
    act(() => { respuesta = result.current.confirmar('¿Seguir?'); });

    expect(result.current.confirmDialog.visible).toBe(true);
    expect(result.current.confirmDialog.mensaje).toBe('¿Seguir?');

    act(() => { result.current.aceptarConfirmacion(); });

    await expect(respuesta).resolves.toBe(true);
    expect(result.current.confirmDialog.visible).toBe(false);
  });

  it('confirmar() resuelve false al cancelar', async () => {
    const { result } = renderHook(() => useConfirmacion());

    let respuesta;
    act(() => { respuesta = result.current.confirmar('¿Seguir?'); });
    act(() => { result.current.cancelarConfirmacion(); });

    await expect(respuesta).resolves.toBe(false);
    expect(result.current.confirmDialog.visible).toBe(false);
  });

  it('solicitarConfirmacion() ejecuta el callback solo si se acepta', () => {
    const { result } = renderHook(() => useConfirmacion());
    let ejecuciones = 0;
    const tarea = () => { ejecuciones += 1; };

    act(() => { result.current.solicitarConfirmacion('¿Borrar?', tarea); });
    act(() => { result.current.cancelarConfirmacion(); });
    expect(ejecuciones).toBe(0);

    act(() => { result.current.solicitarConfirmacion('¿Borrar?', tarea); });
    act(() => { result.current.aceptarConfirmacion(); });
    expect(ejecuciones).toBe(1);
  });
});

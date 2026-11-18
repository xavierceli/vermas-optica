import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PanelSincronizacion from './PanelSincronizacion.jsx';

// ---------------------------------------------------------------------------
// El panel debe avisar cuando el tiempo real lleva caido de verdad, sin
// alarmar: el sondeo de 30 s sigue trayendo los cambios.
// ---------------------------------------------------------------------------
vi.mock('./RespaldoDatos.jsx', () => ({ default: () => null }));
vi.mock('./AccesoSinConexion.jsx', () => ({ default: () => null }));

const gestorBase = {
  syncEstado: { online: true, phase: 'synced', pending: 0, lastSync: null },
  obtenerDetalleCola: vi.fn(async () => []),
  sincronizarAhora: vi.fn(async () => {}),
  modoSinConexion: false
};

describe('PanelSincronizacion y tiempo real', () => {
  it('avisa si el canal lleva 6 minutos caído', async () => {
    render(
      <PanelSincronizacion
        abierta
        cerrar={() => {}}
        gestor={{
          ...gestorBase,
          tiempoReal: { estado: 'CHANNEL_ERROR', caidoMs: 6 * 60 * 1000 }
        }}
      />
    );

    expect(await screen.findByText(/Tiempo real sin conexión desde hace 6 min/)).toBeTruthy();
    expect(screen.getByText(/cada 30 s/)).toBeTruthy();
  });

  it('no avisa si el canal está conectado', async () => {
    render(
      <PanelSincronizacion
        abierta
        cerrar={() => {}}
        gestor={{
          ...gestorBase,
          tiempoReal: { estado: 'SUBSCRIBED', caidoMs: 0 }
        }}
      />
    );

    expect(await screen.findByText(/Tiempo real conectado/)).toBeTruthy();
    expect(screen.queryByText(/sin conexión desde hace/)).toBeNull();
  });

  it('sin internet no duplica el aviso de tiempo real', async () => {
    render(
      <PanelSincronizacion
        abierta
        cerrar={() => {}}
        gestor={{
          ...gestorBase,
          syncEstado: { ...gestorBase.syncEstado, online: false },
          tiempoReal: { estado: 'CHANNEL_ERROR', caidoMs: 10 * 60 * 1000 }
        }}
      />
    );

    expect(await screen.findByText(/Sin conexión: los cambios están seguros/)).toBeTruthy();
    expect(screen.queryByText(/Tiempo real sin conexión desde hace/)).toBeNull();
  });
});

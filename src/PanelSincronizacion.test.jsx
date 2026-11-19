import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  it('resume los conflictos por tipo y por equipo', async () => {
    render(
      <PanelSincronizacion
        abierta
        cerrar={() => {}}
        gestor={{
          ...gestorBase,
          obtenerDetalleCola: vi.fn(async () => [
            { id: 'op-1', tipo: 'GUARDAR_CONSULTA', estado: 'conflict', intentos: 1, motivo: 'modificada en otro dispositivo', creada: '2026-03-01T10:00:00Z' },
            { id: 'op-2', tipo: 'CREAR_VENTA', estado: 'conflict', intentos: 1, motivo: 'Stock insuficiente', creada: '2026-03-01T10:05:00Z' }
          ]),
          obtenerResumenConflictos: vi.fn(async () => ({
            total: 3,
            activos: 2,
            porCategoria: { version_clinica: 2, stock: 1, version_venta: 0, otro: 0 },
            porEquipo: [
              { equipoId: 'equipo-12345678', equipo: 'Chrome en Windows', usuario: 'ana@vermas', total: 3, porCategoria: { version_clinica: 2, stock: 1, version_venta: 0, otro: 0 } }
            ],
            recientes: [],
            ultimo: '2026-03-01T10:05:00Z',
            equipo: { id: 'equipo-12345678', etiqueta: 'Chrome en Windows', usuario: 'ana@vermas' }
          }))
        }}
      />
    );

    expect(await screen.findByText('Resumen de conflictos')).toBeTruthy();
    expect(screen.getByText(/2 activo\(s\) en la cola/)).toBeTruthy();

    const clinica = screen.getByTestId('conflicto-version_clinica');
    expect(within(clinica).getByText('2')).toBeTruthy();
    const stock = screen.getByTestId('conflicto-stock');
    expect(within(stock).getByText('1')).toBeTruthy();

    expect(screen.getByText(/Chrome en Windows/)).toBeTruthy();
    expect(screen.getByText(/ana@vermas/)).toBeTruthy();
  });
});

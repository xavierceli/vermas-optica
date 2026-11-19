import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import PanelSincronizacion from './PanelSincronizacion.jsx';
import { listarRevisionesConsulta } from './repositorio/revisiones.js';
import {
  leerUltimaCopiaMensual,
  registrarCopiaMensual
} from './repositorio/copiaMensual.js';

// ---------------------------------------------------------------------------
// El panel debe avisar cuando el tiempo real lleva caido de verdad, sin
// alarmar: el sondeo de 30 s sigue trayendo los cambios.
// ---------------------------------------------------------------------------
vi.mock('./RespaldoDatos.jsx', () => ({ default: () => null }));
vi.mock('./AccesoSinConexion.jsx', () => ({ default: () => null }));
vi.mock('./repositorio/revisiones.js', () => ({ listarRevisionesConsulta: vi.fn() }));
vi.mock('./repositorio/copiaMensual.js', () => ({
  leerUltimaCopiaMensual: vi.fn(async () => null),
  registrarCopiaMensual: vi.fn(async () => {})
}));
vi.mock('./repositorio/diagnostico.js', () => ({ leerErroresLocales: vi.fn(async () => []) }));

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

  it('pide confirmación antes de descartar y conserva la operación si se cancela', async () => {
    const descartarOperacion = vi.fn(async () => {});
    const confirmar = vi.fn(async () => false);

    render(
      <PanelSincronizacion
        abierta
        cerrar={() => {}}
        gestor={{
          ...gestorBase,
          confirmar,
          descartarOperacion,
          obtenerDetalleCola: vi.fn(async () => [
            { id: 'op-1', tipo: 'GUARDAR_CONSULTA', estado: 'conflict', intentos: 1, motivo: 'modificada en otro dispositivo', creada: '2026-03-01T10:00:00Z' }
          ])
        }}
      />
    );

    fireEvent.click(await screen.findByTitle('Quitar de la cola de subida'));

    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1));
    const [mensaje, etiqueta] = confirmar.mock.calls[0];
    expect(mensaje).toMatch(/Consulta clínica/);
    expect(mensaje).toMatch(/no llegará al servidor/);
    expect(mensaje).toMatch(/otro equipo/);
    expect(etiqueta).toBe('Sí, quitar');
    expect(descartarOperacion).not.toHaveBeenCalled();
  });

  it('descarta la operación solo después de confirmar', async () => {
    const descartarOperacion = vi.fn(async () => []);
    const confirmar = vi.fn(async () => true);

    render(
      <PanelSincronizacion
        abierta
        cerrar={() => {}}
        gestor={{
          ...gestorBase,
          confirmar,
          descartarOperacion,
          obtenerDetalleCola: vi.fn(async () => [
            { id: 'op-2', tipo: 'CREAR_VENTA', estado: 'conflict', intentos: 1, motivo: 'Stock insuficiente', creada: '2026-03-01T10:05:00Z' }
          ])
        }}
      />
    );

    fireEvent.click(await screen.findByTitle('Quitar de la cola de subida'));

    await waitFor(() => expect(descartarOperacion).toHaveBeenCalledWith('op-2'));
  });

  it('muestra las versiones anteriores de una consulta en conflicto', async () => {
    listarRevisionesConsulta.mockResolvedValue([
      {
        version: 2,
        motivo: 'edicion',
        editado_en: '2026-03-01T10:00:00Z',
        editado_por: 'ana@vermas',
        snapshot: {
          fecha: '2026-03-01',
          avsl_od: '20/20', esfera_od: '-1.00', cilindro_od: '-0.50', eje_od: '90',
          esfera_oi: '-2.00',
          notas_clinicas: 'Control anual'
        }
      }
    ]);

    render(
      <PanelSincronizacion
        abierta
        cerrar={() => {}}
        gestor={{
          ...gestorBase,
          obtenerDetalleCola: vi.fn(async () => [
            { id: 'op-3', tipo: 'GUARDAR_CONSULTA', entidad: 'consulta-1', estado: 'conflict', intentos: 1, motivo: 'modificada en otro dispositivo', creada: '2026-03-01T10:00:00Z' }
          ])
        }}
      />
    );

    fireEvent.click(await screen.findByTitle('Ver versiones anteriores guardadas en el servidor'));

    expect(await screen.findByText(/Versión 2/)).toBeTruthy();
    expect(screen.getByText(/Esf -1\.00/)).toBeTruthy();
    expect(screen.getByText(/Esf -2\.00/)).toBeTruthy();
    expect(screen.getByText(/Control anual/)).toBeTruthy();
    expect(listarRevisionesConsulta).toHaveBeenCalledWith('consulta-1');
  });

  it('recuerda la copia mensual de fotos cuando nunca se registró', async () => {
    leerUltimaCopiaMensual.mockResolvedValue(null);

    render(<PanelSincronizacion abierta cerrar={() => {}} gestor={{ ...gestorBase }} />);

    expect(await screen.findByText(/Nunca se registró la copia mensual de comprobantes/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ya hice la copia/ })).toBeTruthy();
  });

  it('avisa cuando la última copia de fotos tiene más de un mes', async () => {
    const hace45 = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    leerUltimaCopiaMensual.mockResolvedValue(hace45);

    render(<PanelSincronizacion abierta cerrar={() => {}} gestor={{ ...gestorBase }} />);

    expect(await screen.findByText(/está pendiente: la última fue hace 45 días/)).toBeTruthy();
  });

  it('anota la copia mensual al confirmarla y deja de avisar', async () => {
    leerUltimaCopiaMensual.mockResolvedValue(null);
    registrarCopiaMensual.mockClear();

    render(<PanelSincronizacion abierta cerrar={() => {}} gestor={{ ...gestorBase }} />);

    fireEvent.click(await screen.findByRole('button', { name: /Ya hice la copia/ }));

    await waitFor(() => expect(registrarCopiaMensual).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Última copia de comprobantes/)).toBeTruthy();
    expect(screen.queryByText(/Nunca se registró la copia mensual/)).toBeNull();
  });

  it('en modo resolver problemas ofrece el diagnóstico y no el recordatorio de fotos', async () => {
    render(
      <PanelSincronizacion
        abierta
        cerrar={() => {}}
        soloProblemas
        gestor={{ ...gestorBase }}
      />
    );

    expect(await screen.findByText(/Diagnóstico para pedir ayuda/)).toBeTruthy();
    expect(screen.queryByText(/Copia mensual de fotos y comprobantes/)).toBeNull();
  });
});

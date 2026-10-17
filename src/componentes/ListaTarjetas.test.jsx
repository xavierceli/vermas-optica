// ---------------------------------------------------------------------------
// LISTA DE TARJETAS: EL DIÁLOGO DE CONFIRMACIÓN DE UNA VENTA ANULADA
// ---------------------------------------------------------------------------
// Antes esto usaba window.confirm(), que bloquea la página y no tiene el estilo
// de la app. Ahora la tarjeta llama a `confirmarAccion` (el diálogo global). Como
// no había forma de comprobarlo, estas pruebas MONTAN el componente de verdad y
// hacen clic, en vez de leer el código como texto.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ListaTarjetas from './ListaTarjetas.jsx';
import { useConfirmacion } from '../hooks/useConfirmacion.js';

// Una consulta anulada con una venta asociada: es el caso que muestra los
// botones "Ver Anulado" y "Editar".
const consultaAnulada = {
  id: 'p1',
  nombre: 'Ana Pérez',
  cedula: '1712345678',
  estado: 'anulado',
  pedido_id: 'venta-1',
  venta: '100',
  fecha: '2026-01-01',
};

const propsTarjeta = (overrides = {}) => ({
  busquedaTexto: '',
  setBusquedaTexto: () => {},
  hayTermino: false,
  pacientesAgrupados: [consultaAnulada],
  filasPorMostrar: 50,
  filasVisibles: [consultaAnulada],
  visibles: 50,
  setVisibles: () => {},
  incremento: 50,
  buscando: false,
  aliasVisibles: {},
  toggleAlias: () => {},
  abrirExpedienteCompleto: () => {},
  cargarParaEditarClinico: () => {},
  iniciarNuevaConsulta: () => {},
  abrirPedido: () => {},
  enviarWhatsApp: () => {},
  manejarBorradoCompleto: () => {},
  crearNuevoPaciente: () => {},
  ...overrides,
});

const TITULO_EDITAR = 'Editar pedido anulado';
const TITULO_VER = 'Ver los datos del pedido anulado';

describe('ListaTarjetas — venta anulada', () => {
  it('"Editar" pide confirmación a la app y no abre el pedido hasta aceptar', () => {
    const confirmarAccion = vi.fn();
    const abrirPedido = vi.fn();
    render(<ListaTarjetas {...propsTarjeta({ confirmarAccion, abrirPedido })} />);

    fireEvent.click(screen.getByTitle(TITULO_EDITAR));

    // Preguntó, con el mensaje correcto, y todavía no abrió nada.
    expect(confirmarAccion).toHaveBeenCalledTimes(1);
    const [mensaje, alConfirmar] = confirmarAccion.mock.calls[0];
    expect(mensaje).toMatch(/anulada/i);
    expect(typeof alConfirmar).toBe('function');
    expect(abrirPedido).not.toHaveBeenCalled();

    // El usuario acepta en el diálogo de la app.
    alConfirmar();
    expect(abrirPedido).toHaveBeenCalledWith(consultaAnulada);
  });

  it('sin diálogo disponible abre el pedido igualmente (nunca se queda sin responder)', () => {
    const abrirPedido = vi.fn();
    render(<ListaTarjetas {...propsTarjeta({ abrirPedido })} />);

    fireEvent.click(screen.getByTitle(TITULO_EDITAR));

    expect(abrirPedido).toHaveBeenCalledWith(consultaAnulada);
  });

  it('"Ver Anulado" abre el pedido sin preguntar', () => {
    const confirmarAccion = vi.fn();
    const abrirPedido = vi.fn();
    render(<ListaTarjetas {...propsTarjeta({ confirmarAccion, abrirPedido })} />);

    fireEvent.click(screen.getByTitle(TITULO_VER));

    expect(confirmarAccion).not.toHaveBeenCalled();
    expect(abrirPedido).toHaveBeenCalledWith(consultaAnulada);
  });
});

// ---------------------------------------------------------------------------
// El flujo completo: la tarjeta + el diálogo global juntos.
// ---------------------------------------------------------------------------
describe('Flujo completo de confirmación', () => {
  function Arnes({ abrirPedido }) {
    const confirmacion = useConfirmacion();
    return (
      <>
        <ListaTarjetas
          {...propsTarjeta({ abrirPedido, confirmarAccion: confirmacion.solicitarConfirmacion })}
        />
        {confirmacion.confirmDialog.visible && (
          <div role="dialog" aria-modal="true">
            <p>{confirmacion.confirmDialog.mensaje}</p>
            <button type="button" onClick={() => confirmacion.cancelarConfirmacion()}>Cancelar</button>
            <button type="button" onClick={() => confirmacion.aceptarConfirmacion()}>Aceptar</button>
          </div>
        )}
      </>
    );
  }

  it('cancelar no abre el pedido; aceptar sí', () => {
    const abrirPedido = vi.fn();
    render(<Arnes abrirPedido={abrirPedido} />);

    // Primer intento: cancelar.
    fireEvent.click(screen.getByTitle(TITULO_EDITAR));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByText('Cancelar'));
    expect(abrirPedido).not.toHaveBeenCalled();

    // Segundo intento: aceptar.
    fireEvent.click(screen.getByTitle(TITULO_EDITAR));
    fireEvent.click(screen.getByText('Aceptar'));
    expect(abrirPedido).toHaveBeenCalledWith(consultaAnulada);
  });
});

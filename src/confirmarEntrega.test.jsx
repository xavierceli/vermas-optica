// ---------------------------------------------------------------------------
// PEDIDOS: entregar una venta es un clic, y se pregunta antes
// ---------------------------------------------------------------------------
// Marcar "Entregado" desde el desplegable de la lista es un solo clic. Si la
// venta ya estaba pagada, la tarjeta desaparece de la pestaña donde estaba y se
// va a "Entregados y Pagados": el usuario puede creer que se borro la venta.
// Ahora el dialogo dice el nombre y que pasara con el dinero, y si el usuario
// cancela, no se toca la base de datos.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PedidosLista from './PedidosLista.jsx';
import { cambiarEstadoVentaLocal } from './localRepository';

vi.mock('./localRepository', () => ({
  cambiarEstadoVentaLocal: vi.fn(async () => {}),
  registrarPagoLocal: vi.fn(async () => {}),
  guardarAdjuntoLocal: vi.fn(async () => {})
}));

vi.mock('./syncEngine', () => ({
  sincronizarAhora: vi.fn(async () => ({ phase: 'idle' }))
}));

const pedido = {
  id: 'v1',
  pedido_id: 'venta-1',
  nombre: 'Ana Pérez',
  cedula: '1712345678',
  venta: '100',
  abono: '0',
  estado: 'En laboratorio',
  codigo_armazon: 'X',
  fecha: '2026-01-01'
};

const propsPedidos = (overrides = {}) => ({
  crearVentaDirecta: () => {},
  busqueda: '',
  setBusqueda: () => {},
  pedidosFiltrados: [pedido],
  imprimirRecibo: () => {},
  imprimirOrdenTrabajo: () => {},
  cancelarPedido: () => {},
  abrirPedido: () => {},
  refrescarDatos: async () => {},
  ...overrides
});

const cambiarEstado = valor =>
  fireEvent.change(screen.getByLabelText(/estado del pedido/i), { target: { value: valor } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PedidosLista — entregar una venta pide confirmacion', () => {
  it('si el usuario cancela, la venta no cambia de estado', async () => {
    const confirmar = vi.fn(async () => false);
    const refrescarDatos = vi.fn(async () => {});
    render(<PedidosLista {...propsPedidos({ confirmar, refrescarDatos })} />);

    cambiarEstado('Entregado');

    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1));
    expect(cambiarEstadoVentaLocal).not.toHaveBeenCalled();
    expect(refrescarDatos).not.toHaveBeenCalled();
    // y el desplegable vuelve a lo que dice la base, no se queda en "Entregado"
    expect(screen.getByLabelText(/estado del pedido/i).value).toBe('En laboratorio');
  });

  it('el aviso nombra al paciente y avisa cuanto queda por cobrar', async () => {
    const confirmar = vi.fn(async () => false);
    render(
      <PedidosLista {...propsPedidos({
        confirmar,
        pedidosFiltrados: [{ ...pedido, venta: '100', abono: '40' }]
      })} />
    );

    cambiarEstado('Entregado');

    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1));
    const mensaje = confirmar.mock.calls[0][0];
    expect(mensaje).toMatch(/Ana P/);
    expect(mensaje).toMatch(/\$60\.00/);
    expect(mensaje).toMatch(/Con Saldo/);
  });

  it('si el usuario confirma, se guarda el estado Entregado', async () => {
    const confirmar = vi.fn(async () => true);
    const refrescarDatos = vi.fn(async () => {});
    render(<PedidosLista {...propsPedidos({ confirmar, refrescarDatos })} />);

    cambiarEstado('Entregado');

    await waitFor(() => expect(cambiarEstadoVentaLocal).toHaveBeenCalledWith({
      saleId: 'venta-1', estado: 'Entregado'
    }));
    expect(refrescarDatos).toHaveBeenCalled();
  });

  it('cualquier otro estado se guarda sin preguntar nada', async () => {
    const confirmar = vi.fn(async () => true);
    const refrescarDatos = vi.fn(async () => {});
    render(<PedidosLista {...propsPedidos({ confirmar, refrescarDatos })} />);

    cambiarEstado('Listo para Entrega');

    await waitFor(() => expect(cambiarEstadoVentaLocal).toHaveBeenCalledWith({
      saleId: 'venta-1', estado: 'Listo para Entrega'
    }));
    expect(confirmar).not.toHaveBeenCalled();
  });
});

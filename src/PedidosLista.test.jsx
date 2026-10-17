// ---------------------------------------------------------------------------
// PEDIDOS: anular una venta (devuelve dinero) es solo para el administrador
// ---------------------------------------------------------------------------
// Anular puede implicar devolver lo abonado (reembolso), asi que el boton
// "Cancelar" solo lo ve el admin. El servidor lo vuelve a comprobar.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PedidosLista from './PedidosLista.jsx';

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
  refrescarDatos: () => {},
  ...overrides
});

describe('PedidosLista — anular venta solo para el administrador', () => {
  it('el administrador ve el botón Cancelar', () => {
    render(<PedidosLista {...propsPedidos({ esAdmin: true })} />);
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeTruthy();
  });

  it('el personal NO ve el botón Cancelar', () => {
    render(<PedidosLista {...propsPedidos({ esAdmin: false })} />);
    expect(screen.queryByRole('button', { name: /cancelar/i })).toBeNull();
  });
});

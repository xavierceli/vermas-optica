import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CombosPromocionales from './CombosPromocionales.jsx';

const COMBO = {
  id: 7,
  tipo_lente: 'COMBO',
  material: 'MONOFOCAL',
  tratamiento: 'Combo',
  rango_medida: 'COMBO: Armazón + AR',
  precio_sugerido: '40.00',
  costo_laboratorio: '12.00',
  notas: JSON.stringify({ v: 1, tratamientos: ['tratam_ar'], topeArmazon: 25 })
};

const INVENTARIO = [
  { id: 1, codigo: 'MIRA-4017', categoria: 'Armazon', precio: '45.00' }
];

describe('CombosPromocionales', () => {
  it('al elegir un combo fija el precio cerrado y marca sus tratamientos', () => {
    const setPedido = vi.fn();
    render(
      <CombosPromocionales
        pedido={{}}
        listaPrecios={[COMBO]}
        inventario={INVENTARIO}
        setPedidoSeleccionado={setPedido}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Armazón \+ AR/ }));

    const actualizar = setPedido.mock.calls[0][0];
    const siguiente = actualizar({
      codigo_armazon: 'MIRA-4017',
      venta: '',
      tratam_ar: 'NO',
      tratam_ninguno: 'SI'
    });

    expect(siguiente.combo_id).toBe('7');
    expect(siguiente.combo_nombre).toBe('Armazón + AR');
    expect(siguiente.combo_precio).toBe(40);
    expect(siguiente.venta).toBe(40, 'el armazón NO se suma encima del combo');
    expect(siguiente.tratam_ar).toBe('SI');
    expect(siguiente.tratam_ninguno).toBe('NO');
    expect(siguiente.codigo_armazon).toBe('MIRA-4017', 'el armazón elegido se conserva');
  });

  it('quitar el combo vuelve al precio normal', () => {
    const setPedido = vi.fn();
    const pedido = {
      combo_id: '7',
      combo_nombre: 'Armazón + AR',
      combo_precio: 40,
      venta: 40
    };
    render(
      <CombosPromocionales
        pedido={pedido}
        listaPrecios={[COMBO]}
        inventario={INVENTARIO}
        setPedidoSeleccionado={setPedido}
      />
    );

    expect(screen.getByText(/Combo aplicado/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Quitar combo/i }));

    const actualizar = setPedido.mock.calls[0][0];
    const siguiente = actualizar(pedido);
    expect(siguiente.combo_id).toBe('');
    expect(siguiente.combo_precio).toBe('');
    expect(siguiente.venta).toBe(0);
  });

  it('avisa si el armazón supera el tope del combo', () => {
    render(
      <CombosPromocionales
        pedido={{
          combo_id: '7',
          combo_nombre: 'Armazón + AR',
          combo_precio: 40,
          codigo_armazon: 'MIRA-4017'
        }}
        listaPrecios={[COMBO]}
        inventario={INVENTARIO}
        setPedidoSeleccionado={() => {}}
      />
    );

    expect(screen.getByText(/hasta \$25\.00/)).toBeTruthy();
    expect(screen.getByText(/cuesta \$45\.00/)).toBeTruthy();
  });

  it('no pinta nada si el tarifario no tiene combos', () => {
    const { container } = render(
      <CombosPromocionales
        pedido={{}}
        listaPrecios={[]}
        inventario={[]}
        setPedidoSeleccionado={() => {}}
      />
    );
    expect(container.innerHTML).toBe('');
  });
});

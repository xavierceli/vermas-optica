// ---------------------------------------------------------------------------
// VENTA: aviso de medidas antes de armar la orden de trabajo
// ---------------------------------------------------------------------------
// Una venta sin medidas se guarda igual (un armazon o un accesorio no llevan
// receta), pero el laboratorio no puede tallar un lente con la orden vacia. El
// formulario lo dice en vivo, dice QUE falta y lleva a la casilla.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PedidosForm from './PedidosForm.jsx';

beforeAll(() => {
  // jsdom no implementa scrollIntoView; la app lo usa para llevar al campo.
  Element.prototype.scrollIntoView = () => {};
});

const MEDIDAS = {
  esfera_od: '-1.00', cilindro_od: '0', eje_od: '0', adicion_od: '0', dnp_od: '30',
  esfera_oi: '-1.00', cilindro_oi: '0', eje_oi: '0', adicion_oi: '0', dnp_oi: '30'
};

const pedido = (overrides = {}) => ({
  id: 'c1',
  pedido_id: 'v1',
  nombre: 'ANA PEREZ',
  cedula: '1712345678',
  venta: '100',
  abono: '0',
  descuento: '0',
  forma_pago: 'Efectivo',
  estado: 'En laboratorio',
  fecha: '2026-01-01',
  ...MEDIDAS,
  ...overrides
});

function Formulario({ inicial, guardarPedido = async () => true }) {
  const [pedidoActual, setPedido] = useState(inicial);
  return (
    <PedidosForm
      pedidoSeleccionado={pedidoActual}
      setPedidoSeleccionado={setPedido}
      setVistaActual={() => {}}
      guardarPedido={guardarPedido}
      manejarCambioPedido={(e) => setPedido((prev) => ({ ...prev, [e.target.name]: e.target.value }))}
      cambiarMedicionPedido={() => {}}
      medidasPaciente={[]}
      inventario={[]}
      accesorioOriginalId=""
      forzarRecalculo={() => {}}
      confirmarAccion={() => true}
    />
  );
}

describe('PedidosForm — medidas de la orden', () => {
  it('con las diez medidas escritas dice que esta completa', () => {
    render(<Formulario inicial={pedido()} />);
    expect(screen.getByText(/Medidas completas/)).toBeTruthy();
  });

  it('si falta una, dice cual falta y lleva a esa casilla', () => {
    render(<Formulario inicial={pedido({ eje_od: '' })} />);

    const aviso = screen.getByText(/Faltan 1: Eje OD/);
    expect(aviso.getAttribute('title')).toMatch(/Eje OD/);

    fireEvent.click(aviso);
    expect(document.activeElement?.name).toBe('eje_od');
  });

  it('sin ninguna medida avisa que la orden saldria sin receta', () => {
    const vacias = Object.fromEntries(Object.keys(MEDIDAS).map((k) => [k, '']));
    render(<Formulario inicial={pedido(vacias)} />);
    expect(screen.getByText(/Sin medidas: la orden saldrá sin receta/)).toBeTruthy();
  });

  it('al escribir la medida que faltaba, el aviso desaparece solo', () => {
    render(<Formulario inicial={pedido({ eje_od: '' })} />);
    expect(screen.getByText(/Faltan 1/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Eje ojo derecho'), { target: { name: 'eje_od', value: '90' } });

    expect(screen.queryByText(/Faltan 1/)).toBeNull();
    expect(screen.getByText(/Medidas completas/)).toBeTruthy();
  });

  it('el aviso no envia el formulario ni guarda el pedido', () => {
    const guardar = vi.fn(async () => true);
    render(<Formulario inicial={pedido({ eje_od: '' })} guardarPedido={guardar} />);

    const aviso = screen.getByText(/Faltan 1: Eje OD/);
    expect(aviso.getAttribute('type')).toBe('button');

    fireEvent.click(aviso);
    expect(guardar).not.toHaveBeenCalled();
  });
});

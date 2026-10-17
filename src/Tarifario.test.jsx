// ---------------------------------------------------------------------------
// TARIFARIO: gestion solo para el administrador
// ---------------------------------------------------------------------------
// El personal puede CONSULTAR la lista de precios, pero no agregar, editar ni
// eliminar tarifas. La pantalla lo refleja escondiendo el formulario y la lista
// de acciones; el servidor lo vuelve a comprobar (migracion 022). Esta prueba
// monta el componente de verdad y comprueba que el formulario aparece o no.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Tarifario from './Tarifario.jsx';

const tarifaVacia = {
  tipo_lente: 'Monofocal',
  material: 'Plástico',
  tratamiento: 'Ninguno / Blanco',
  rango_medida: '',
  costo_laboratorio: '',
  precio_sugerido: '',
  notas: ''
};

const propsTarifario = (overrides = {}) => ({
  nuevoPrecio: { ...tarifaVacia },
  setNuevoPrecio: () => {},
  precioInicial: { ...tarifaVacia },
  editandoPrecioId: null,
  setEditandoPrecioId: () => {},
  manejarCambioPrecio: () => {},
  guardarPrecio: () => {},
  busquedaPrecio: '',
  setBusquedaPrecio: () => {},
  listaPreciosFiltrada: [],
  cargarParaEditarPrecio: () => {},
  eliminarPrecio: () => {},
  ...overrides
});

describe('Tarifario — gestión solo para el administrador', () => {
  it('el administrador ve el formulario para agregar tarifas', () => {
    render(<Tarifario {...propsTarifario({ esAdmin: true })} />);
    expect(screen.getByText(/Agregar Nueva Tarifa Sugerida/i)).toBeTruthy();
    expect(screen.getByText(/Guardar en Tarifario/i)).toBeTruthy();
  });

  it('el personal NO ve el formulario y recibe un aviso de solo lectura', () => {
    render(<Tarifario {...propsTarifario({ esAdmin: false })} />);
    expect(screen.queryByText(/Agregar Nueva Tarifa Sugerida/i)).toBeNull();
    expect(screen.queryByText(/Guardar en Tarifario/i)).toBeNull();
    expect(screen.getByRole('note')).toBeTruthy();
  });
});

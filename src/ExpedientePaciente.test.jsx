import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExpedientePaciente from './componentes/ExpedientePaciente.jsx';
import { listarRevisionesConsulta } from './repositorio/revisiones.js';

// Las versiones de una ficha se guardan en el servidor. Antes solo se podian
// ver mientras la operacion seguia en la cola; desde el expediente se pueden
// consultar meses despues, cuando el conflicto ya se resolvio.

vi.mock('./repositorio/revisiones.js', () => ({ listarRevisionesConsulta: vi.fn() }));

const noop = () => {};

const propsBase = {
  expediente: {
    nombre: 'ANA PEREZ',
    cedula: '1712345678',
    fecha_nacimiento: '1990-01-01',
    telefono: '0999999999'
  },
  claveExpediente: 'paciente-1',
  aliasVisibles: {},
  cargando: false,
  filasExpandidas: {},
  onToggleAlias: noop,
  onToggleExpandir: noop,
  onEliminarRegistro: noop,
  onNuevaConsulta: noop,
  onCargarParaEditar: noop,
  onAbrirPedido: noop,
  onVolver: noop
};

const consulta = (extra = {}) => ({
  id: 'consulta-9',
  fecha: '2026-03-01',
  esfera_od: '-1.00',
  ...extra
});

describe('ExpedientePaciente y versiones anteriores', () => {
  it('muestra las versiones al pulsar el botón de la consulta', async () => {
    listarRevisionesConsulta.mockResolvedValue([
      {
        version: 3,
        motivo: 'edicion',
        editado_en: '2026-03-01T10:00:00Z',
        editado_por: 'ana@vermas',
        snapshot: {
          fecha: '2026-03-01',
          esfera_od: '-1.25',
          esfera_oi: '-2.50',
          notas_clinicas: 'Control anual'
        }
      }
    ]);

    render(<ExpedientePaciente {...propsBase} registros={[consulta()]} />);

    fireEvent.click(screen.getByTitle('Ver versiones anteriores de esta consulta'));

    expect(await screen.findByText(/Versión 3/)).toBeTruthy();
    expect(screen.getByText(/Esf -1\.25/)).toBeTruthy();
    expect(screen.getByText(/Esf -2\.50/)).toBeTruthy();
    expect(screen.getByText(/Control anual/)).toBeTruthy();
    expect(listarRevisionesConsulta).toHaveBeenCalledWith('consulta-9');
  });

  it('no ofrece versiones para una consulta que aún no llegó al servidor', () => {
    render(<ExpedientePaciente {...propsBase} registros={[consulta({ id: 'temp_123' })]} />);

    expect(screen.queryByTitle('Ver versiones anteriores de esta consulta')).toBeNull();
    expect(listarRevisionesConsulta).not.toHaveBeenCalled();
  });

  it('avisa sin romper el expediente si el servidor no responde', async () => {
    listarRevisionesConsulta.mockRejectedValue(new Error('sin conexión'));

    render(<ExpedientePaciente {...propsBase} registros={[consulta()]} />);

    fireEvent.click(screen.getByTitle('Ver versiones anteriores de esta consulta'));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'No se pudo cargar el historial de versiones. Inténtalo de nuevo.'
    );
    expect(screen.getByText('ANA PEREZ')).toBeTruthy();
  });
});

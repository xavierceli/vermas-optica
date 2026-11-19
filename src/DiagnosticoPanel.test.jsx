import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DiagnosticoPanel from './DiagnosticoPanel.jsx';
import { leerErroresLocales } from './repositorio/diagnostico.js';

// Los errores ya se guardaban en el equipo, pero solo se veian cuando la
// pantalla reventaba. Desde el panel de problemas se pueden copiar para pedir
// ayuda sin abrir la consola ni enviar nada automaticamente.

vi.mock('./repositorio/diagnostico.js', () => ({ leerErroresLocales: vi.fn(async () => []) }));

const erroresDeEjemplo = [
  {
    mensaje: 'No se pudo sincronizar la venta',
    nombre: 'Error',
    donde: 'sincronización',
    pila: '',
    hora: '2026-03-01T10:00:00Z'
  },
  {
    mensaje: 'Falta la columna precio',
    nombre: 'TypeError',
    donde: 'Inventario',
    pila: '',
    hora: '2026-03-01T09:00:00Z',
    repeticiones: 3
  }
];

const conPortapapeles = writeText => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true
  });
};

describe('DiagnosticoPanel', () => {
  it('muestra los errores guardados y las repeticiones', async () => {
    leerErroresLocales.mockResolvedValue(erroresDeEjemplo);

    render(<DiagnosticoPanel pendientes={2} online />);

    expect(await screen.findByText(/2 error\(es\) registrado\(s\)/)).toBeTruthy();
    expect(screen.getByText(/No se pudo sincronizar la venta/)).toBeTruthy();
    expect(screen.getByText(/Falta la columna precio \(x3\)/)).toBeTruthy();
  });

  it('dice claramente cuando no hay errores', async () => {
    leerErroresLocales.mockResolvedValue([]);

    render(<DiagnosticoPanel pendientes={0} online />);

    expect(await screen.findByText('Sin errores registrados en este equipo.')).toBeTruthy();
  });

  it('copia el diagnóstico con versión, cola y errores', async () => {
    leerErroresLocales.mockResolvedValue(erroresDeEjemplo);
    const writeText = vi.fn(async () => {});
    conPortapapeles(writeText);

    render(<DiagnosticoPanel pendientes={4} online />);
    fireEvent.click(await screen.findByRole('button', { name: /Copiar diagnóstico/ }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const texto = writeText.mock.calls[0][0];
    expect(texto).toMatch(/VER\+ Óptica — diagnóstico/);
    expect(texto).toMatch(/Operaciones en cola: 4/);
    expect(texto).toMatch(/No se pudo sincronizar la venta/);
    expect(await screen.findByText(/Diagnóstico copiado/)).toBeTruthy();
  });

  it('si el navegador niega el portapapeles, muestra el texto para copiarlo a mano', async () => {
    leerErroresLocales.mockResolvedValue([]);
    conPortapapeles(vi.fn(async () => { throw new Error('sin permiso'); }));

    render(<DiagnosticoPanel pendientes={0} online={false} />);
    fireEvent.click(await screen.findByRole('button', { name: /Copiar diagnóstico/ }));

    const caja = await screen.findByLabelText('Diagnóstico para copiar a mano');
    expect(caja.value).toMatch(/Conexión: sin conexión/);
  });
});

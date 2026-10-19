// ---------------------------------------------------------------------------
// VER LA CONTRASEÑA MIENTRAS SE ESCRIBE
// ---------------------------------------------------------------------------
// El error mas frecuente al entrar es teclear mal la clave y pensar que el
// sistema falla. El boton del campo cambia el <input> a texto plano para poder
// comprobarlo. Estas pruebas MONTAN la pantalla de acceso de verdad y hacen
// clic, en vez de leer el codigo como texto.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Login from './Login.jsx';

const props = { dispositivo: null, entrarSinConexion: vi.fn() };

afterEach(() => sessionStorage.clear());

describe('Login — ver la contraseña', () => {
  it('empieza oculta: el campo es de tipo contraseña', () => {
    render(<Login {...props} />);
    expect(screen.getByLabelText('Contraseña').type).toBe('password');
  });

  it('"Ver" muestra lo escrito sin perderlo y "Ocultar" lo vuelve a tapar', () => {
    render(<Login {...props} />);
    const campo = screen.getByLabelText('Contraseña');

    fireEvent.change(campo, { target: { value: 'mi-clave-123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));

    // El campo se ve, y sigue conteniendo exactamente lo tecleado.
    expect(campo.type).toBe('text');
    expect(campo.value).toBe('mi-clave-123');

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar' }));

    expect(campo.type).toBe('password');
    expect(campo.value).toBe('mi-clave-123');
  });

  it('el boton anuncia su estado con aria-pressed', () => {
    render(<Login {...props} />);

    const ver = screen.getByRole('button', { name: 'Ver' });
    expect(ver.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(ver);
    expect(screen.getByRole('button', { name: 'Ocultar' }).getAttribute('aria-pressed')).toBe('true');
  });
});

// Al crear una contraseña nueva el riesgo es el mismo (y ademas hay que
// repetirla), asi que el formulario de recuperacion destapa las dos casillas.
describe('Login — ver las contraseñas nuevas', () => {
  it('destapa "Nueva" y "Confirmar" a la vez, conservando lo escrito', () => {
    sessionStorage.setItem('vermas_cambio_clave', '1');
    render(<Login {...props} />);

    const nueva = screen.getByLabelText('Nueva Contraseña');
    const confirmar = screen.getByLabelText('Confirmar Contraseña');
    expect(nueva.type).toBe('password');
    expect(confirmar.type).toBe('password');

    fireEvent.change(nueva, { target: { value: 'abcdef' } });
    fireEvent.change(confirmar, { target: { value: 'abcdef' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver contraseñas' }));

    expect(nueva.type).toBe('text');
    expect(confirmar.type).toBe('text');
    expect(nueva.value).toBe('abcdef');
    expect(confirmar.value).toBe('abcdef');
  });
});

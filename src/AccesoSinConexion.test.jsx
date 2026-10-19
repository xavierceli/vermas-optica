// ---------------------------------------------------------------------------
// PIN DE ACCESO SIN CONEXION: LA PANTALLA QUE FALTABA
// ---------------------------------------------------------------------------
// El PIN ya existia en seguridad.js, pero ninguna pantalla lo configuraba, asi
// que el recuadro "Entrar sin conexion" del acceso nunca aparecia. Estas pruebas
// MONTAN la seccion de verdad y comprueban que llama a las funciones correctas.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AccesoSinConexion from './AccesoSinConexion.jsx';

const gestorFalso = (extra = {}) => ({
  dispositivo: { enrolado: false },
  configurarAccesoSinConexion: vi.fn(async () => true),
  desactivarAccesoSinConexion: vi.fn(async () => true),
  ...extra,
});

const campoPin = () => screen.queryByLabelText('PIN (4 a 8 dígitos)');
const campoRepetir = () => screen.queryByLabelText('Repite el PIN');
const botonActivar = () => screen.getByRole('button', { name: /Activar acceso sin conexión/i });

describe('AccesoSinConexion', () => {
  it('sin configurar pide el PIN dos veces', () => {
    render(<AccesoSinConexion gestor={gestorFalso()} />);
    expect(campoPin()).toBeTruthy();
    expect(campoRepetir()).toBeTruthy();
    expect(botonActivar()).toBeTruthy();
  });

  it('no admite letras ni mas de 8 digitos', () => {
    render(<AccesoSinConexion gestor={gestorFalso()} />);
    fireEvent.change(campoPin(), { target: { value: 'a1b2c3' } });
    expect(campoPin().value).toBe('123');

    fireEvent.change(campoPin(), { target: { value: '1234567890123' } });
    expect(campoPin().value).toBe('12345678');
  });

  it('si los dos PIN no coinciden avisa y NO configura nada', () => {
    const gestor = gestorFalso();
    render(<AccesoSinConexion gestor={gestor} />);

    fireEvent.change(campoPin(), { target: { value: '1234' } });
    fireEvent.change(campoRepetir(), { target: { value: '4321' } });
    fireEvent.click(botonActivar());

    expect(screen.getByRole('alert').textContent).toMatch(/no coinciden/i);
    expect(gestor.configurarAccesoSinConexion).not.toHaveBeenCalled();
  });

  it('con los dos PIN iguales configura el acceso en este equipo', () => {
    const gestor = gestorFalso();
    render(<AccesoSinConexion gestor={gestor} />);

    fireEvent.change(campoPin(), { target: { value: '4821' } });
    fireEvent.change(campoRepetir(), { target: { value: '4821' } });
    fireEvent.click(botonActivar());

    expect(gestor.configurarAccesoSinConexion).toHaveBeenCalledWith('4821');
  });

  it('"Ver" muestra los dos PIN escritos (para comprobar que no hay erratas)', () => {
    render(<AccesoSinConexion gestor={gestorFalso()} />);
    expect(campoPin().type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));

    expect(campoPin().type).toBe('text');
    expect(campoRepetir().type).toBe('text');
  });

  it('ya configurado avisa de que esta activo y deja desactivarlo', () => {
    const gestor = gestorFalso({ dispositivo: { enrolado: true } });
    render(<AccesoSinConexion gestor={gestor} />);

    expect(screen.getByText(/Activado en este equipo/i)).toBeTruthy();
    // Ya no se pide el PIN: solo se puede desactivar.
    expect(campoPin()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Desactivar acceso sin conexión/i }));
    expect(gestor.desactivarAccesoSinConexion).toHaveBeenCalledTimes(1);
  });
});

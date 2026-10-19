import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = dirname(fileURLToPath(import.meta.url));

const archivosJsx = (carpeta) => {
  const salida = [];
  for (const entrada of readdirSync(carpeta)) {
    const ruta = join(carpeta, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...archivosJsx(ruta));
    else if (entrada.endsWith('.jsx')) salida.push(ruta);
  }
  return salida;
};

// Devuelve el texto de la cadena de clases que contiene 'outline-none'. Se
// busca entre el delimitador anterior y el siguiente para no confundir clases
// de elementos distintos que esten en la misma linea.
const clasesConOutline = (texto) => {
  const clases = [];
  let i = texto.indexOf('outline-none');
  while (i !== -1) {
    const antes = texto.slice(0, i);
    const inicio = Math.max(antes.lastIndexOf('"'), antes.lastIndexOf("'"), antes.lastIndexOf('`'));
    const delimitador = texto[inicio];
    const fin = texto.indexOf(delimitador, i);
    if (inicio !== -1 && fin !== -1) clases.push(texto.slice(inicio + 1, fin));
    i = texto.indexOf('outline-none', i + 1);
  }
  return clases;
};

test('ningun campo que quita el contorno se queda sin foco visible', () => {
  // Con teclado hay que ver donde esta el cursor. Todo campo que use
  // outline-none debe declarar su propio anillo de foco.
  const fallos = [];
  for (const ruta of archivosJsx(raiz)) {
    const texto = readFileSync(ruta, 'utf8');
    for (const clase of clasesConOutline(texto)) {
      if (!/focus:/.test(clase)) fallos.push(`${ruta.split('src').pop()}: ${clase.slice(0, 70)}`);
    }
  }
  assert.deepEqual(fallos, [], `campos sin foco visible: ${fallos.join(' | ')}`);
});

test('el buscador del historial tiene etiqueta para lectores de pantalla', () => {
  const fuente = readFileSync(join(raiz, 'componentes', 'ListaTarjetas.jsx'), 'utf8');
  assert.match(fuente, /aria-label="Buscar paciente por cédula, nombre o alias"/);
});

test('el acceso permite que el gestor de contraseñas guarde y rellene', () => {
  const fuente = readFileSync(join(raiz, 'Login.jsx'), 'utf8');
  assert.match(fuente, /id="login-email"[\s\S]{0,200}autoComplete="email"/);
  assert.match(fuente, /id="login-password"[\s\S]{0,200}autoComplete="current-password"/);
});

test('cedula, telefono y medidas del armazon abren el teclado adecuado', () => {
  const clinica = readFileSync(join(raiz, 'Clinica.jsx'), 'utf8');
  const pedidos = readFileSync(join(raiz, 'PedidosForm.jsx'), 'utf8');
  const inventario = readFileSync(join(raiz, 'Inventario.jsx'), 'utf8');

  assert.match(clinica, /name="telefono" inputMode="tel"/);
  assert.match(pedidos, /name="cedula" inputMode="numeric"/);

  for (const medidas of [pedidos, inventario]) {
    assert.equal((medidas.match(/name="param_(horizontal|puente|vertical|diagonal)" inputMode="decimal"/g) || []).length, 4);
  }
});

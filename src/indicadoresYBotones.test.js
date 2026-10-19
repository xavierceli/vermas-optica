import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)));
const leer = nombre => readFileSync(join(SRC, nombre), 'utf8');

// TRES COSAS QUE SE VEIAN MAL EN EL DIA A DIA:
//
//  1. El estado de sincronizacion salia DOS veces en pantalla: una barra
//     flotante arriba con una frase larga y la pildora del encabezado con el
//     mismo resumen. El usuario leia lo mismo dos veces y el contenido saltaba
//     de sitio cada vez que aparecia la barra.
//  2. En la tarjeta de una venta habia CUATRO botones solidos de cuatro colores
//     distintos (azul, gris, indigo, verde) y el "Cancelar" destructivo pegado
//     al boton principal.
//  3. La deuda pendiente de un paciente parpadeaba sin parar (saldo, contador),
//     incluso cuando esa deuda era normal y llevaba meses asi.
//
// Estos tests no prueban pixeles: fijan las decisiones para que no se pierdan
// en el proximo cambio de estilos.

test('el estado de sincronizacion se muestra UNA sola vez (la pildora del encabezado)', () => {
  const fuente = leer('App.jsx');
  // La barra flotante duplicada ya no existe.
  assert.doesNotMatch(fuente, /Estado de conexión y sincronización/);
  assert.doesNotMatch(fuente, /tieneAvisoSuperior/);
  // La pildora sigue siendo el acceso permanente al panel y muestra el resumen.
  assert.match(fuente, /setPanelSync\(true\)/);
  assert.match(fuente, /estadoOutbox\.texto/);
});

test('los botones de la tarjeta de venta tienen un color por intencion', () => {
  const fuente = leer('PedidosLista.jsx');
  const inicio = fuente.indexOf('flex gap-1.5 sm:gap-2 flex-wrap justify-start sm:justify-end w-full md:w-auto');
  assert.ok(inicio > -1, 'debe existir la fila de acciones de la venta');
  const bloque = fuente.slice(inicio, fuente.indexOf('</div>', fuente.indexOf('abrirPedido(item)')));

  // Imprimir es secundario: contorno, no relleno.
  assert.match(bloque, /onClick=\{\(\) => imprimirRecibo\(item\)\} className="bg-white border border-gray-300/);
  assert.match(bloque, /onClick=\{\(\) => imprimirOrdenTrabajo\(item\)\} className="bg-white border border-gray-300/);

  // Un solo boton relleno en la fila: "Ver / Editar" (indigo).
  const rellenos = bloque.match(/className="bg-(blue|gray|indigo|green|red|amber|teal|purple)-\d{3}[^"]*text-white/g) || [];
  assert.equal(rellenos.length, 1, `botones rellenos en la venta: ${rellenos.join(' | ')}`);
  assert.match(rellenos[0], /bg-indigo-600/);

  // El destructivo va primero, lejos del boton principal.
  assert.ok(
    bloque.indexOf('manejarCancelarOptimista(item)') < bloque.indexOf('abrirPedido(item)'),
    'Cancelar debe quedar antes de Ver / Editar'
  );
});

test('una deuda normal no parpadea para siempre', () => {
  const tarjetas = leer('componentes/ListaTarjetas.jsx');
  // El saldo pendiente y la etiqueta roja de deuda se quedan quietos.
  assert.doesNotMatch(tarjetas, /animate-pulse flex items-center gap-1/);
  assert.doesNotMatch(tarjetas, /text-red-600 animate-pulse/);

  const pedidos = leer('PedidosLista.jsx');
  // El contador de "Con Saldo" tampoco late.
  assert.doesNotMatch(pedidos, /bg-red-600 text-white animate-pulse/);
});

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

test('el formulario clinico guarda desde una barra que no se pierde de vista', () => {
  // La consulta tiene decenas de campos: el boton de guardar del final queda a
  // varios pantallazos del principio. Se ancla abajo y dice de quien es.
  const fuente = leer('Clinica.jsx');
  const inicio = fuente.indexOf('{/* Barra de guardado');
  assert.ok(inicio > -1, 'debe existir la barra de guardado');
  const bloque = fuente.slice(inicio, inicio + 3200);

  assert.match(bloque, /sm:sticky sm:bottom-0/, 'debe quedarse pegada al borde inferior');
  assert.match(bloque, /guardarPacienteClinico/, 'debe guardar con el mismo manejador de siempre');
  assert.match(bloque, /paciente\.nombre/, 'debe recordar el nombre del paciente mientras se baja');
});

test('la lista de pedidos recibe el dialogo de confirmacion de la app', () => {
  // Sin este cableado, entregar una venta no preguntaria nada y el usuario
  // volveria a ver desaparecer la tarjeta sin explicacion.
  assert.match(leer('App.jsx'), /<PedidosLista[^>]*confirmar=\{g\.confirmar\}/);
});

test('la consulta avisa en vivo que datos de refraccion faltan, y lleva al primero', () => {
  // Sin estos datos el lente no se puede tallar. La app NO relaja la regla (que
  // fue lo que pidio el usuario): avisa de lo que falta y te deja saltar ahi.
  const clinica = leer('Clinica.jsx');
  assert.match(clinica, /const faltantesRefraccion = refraccionFaltante\(paciente\)/);
  assert.match(clinica, /onClick=\{irAlPrimerFaltante\}/, 'el aviso debe ser accionable');
  assert.match(clinica, /scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
  assert.match(clinica, /input\[name="\$\{nombre\}"\]/, 'debe enfocar el campo por su name');

  // Y si se pulsa Guardar con huecos, va solo al primero (no hay que buscarlo).
  assert.match(clinica, /if \(!intentosGuardado\) return;[\s\S]{0,140}irAlCampoClinico/);
  assert.match(leer('hooks/useClinica.js'), /setIntentosGuardado\(n => n \+ 1\)/);
  assert.match(leer('useGestor.js'), /intentosGuardado,/, 'useGestor debe exponerlo a la vista');
  assert.match(leer('App.jsx'), /intentosGuardado=\{g\.intentosGuardado\}/);

  // Y la regla estricta sigue en pie: sin los 18 datos no se guarda.
  assert.match(leer('hooks/useClinica.js'), /if \(!validacion\.ok\)[\s\S]*?setIntentadoGuardar\(true\)/);
  assert.match(leer('validacion.js'), /const REFRACCION_OBLIGATORIA = Object\.keys\(ETIQUETAS_CAMPOS\)/);
});

test('la venta avisa si la orden va a salir sin medidas, y no bloquea', () => {
  // Un armazon o un accesorio no llevan receta: la venta se guarda igual. Pero
  // una orden para tallar un lente sin medidas es un pedido perdido.
  const form = leer('PedidosForm.jsx');
  assert.match(form, /const medidasFaltantes = medidasOrdenFaltantes\(pedidoSeleccionado\)/);
  assert.match(form, /Sin medidas: la orden saldrá sin receta/);
  assert.match(form, /Faltan \$\{medidasFaltantes\.length\}/);
  assert.match(form, /onClick=\{\(\) => irACampoDeLaOrden\(medidasFaltantes\[0\]\?\.campo\)\}/);
  assert.match(form, /type="button"/, 'el aviso no debe enviar el formulario');
  assert.ok(
    !/medidasFaltantes[\s\S]{0,80}return false/.test(form),
    'el aviso no debe impedir guardar una venta sin receta'
  );
});

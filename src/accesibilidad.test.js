import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)));
const leer = nombre => readFileSync(join(SRC, nombre), 'utf8');

// Un lector de pantalla anuncia cada control por su nombre accesible. Si un
// <input> se queda sin nombre, el optometria oye "campo de texto, sin nombre" y
// no sabe si esta escribiendo la esfera del ojo derecho o el eje del izquierdo.
// Estos tests fallan si alguien anade un campo nuevo sin etiquetar, que es
// exactamente como se colaron los 30+ campos que habia sin ningun nombre.

const CONTROLES = /<(input|select|textarea)\b([^>]*)>/g;

const ARCHIVOS_CON_FORMULARIOS = [
  'Clinica.jsx',
  'PedidosForm.jsx',
  'Inventario.jsx',
  'Login.jsx'
];

/**
 * Un control sin nombre accesible solo es un problema real si ademas esta
 * "suelto". Si el <input> esta DENTRO de un <label>...</label>, el texto de esa
 * etiqueta es su nombre accesible y no hace falta aria-label ni id: asi es como
 * estan marcados los checkbox de tratamientos y los radio de material.
 */
const controlesSueltos = (fuente) => {
  // Se parte por los <label>...</label> y se descarta su contenido: lo que hay
  // dentro ya tiene nombre.
  const fueraDeLabels = fuente.replace(/<label\b[\s\S]*?<\/label>/g, '');
  const lista = [];
  let m;
  while ((m = CONTROLES.exec(fueraDeLabels)) !== null) {
    const atributos = m[2];
    if (/\btype="(hidden|button|submit)"/.test(atributos)) continue;
    lista.push({ etiqueta: m[1], atributos });
  }
  return lista;
};

for (const archivo of ARCHIVOS_CON_FORMULARIOS) {
  test(`${archivo}: todo control de formulario tiene nombre accesible`, () => {
    const fuente = leer(archivo);
    const sinNombre = [];
    for (const { etiqueta, atributos } of controlesSueltos(fuente)) {
      const tieneAria = /\baria-label(="[^"]*")?/.test(atributos) || /\baria-labelledby=/.test(atributos);
      const tieneId = /\bid="/.test(atributos);
      if (tieneAria || tieneId) continue;
      sinNombre.push(`${etiqueta}[${atributos.trim().slice(0, 60)}]`);
    }
    assert.deepEqual(sinNombre, [], `controles sin nombre accesible en ${archivo}`);
  });
}

test('ningun htmlFor apunta a un id inexistente', () => {
  for (const archivo of ARCHIVOS_CON_FORMULARIOS) {
    const fuente = leer(archivo);
    const declarados = new Set([...fuente.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    const huerfanos = [...fuente.matchAll(/\bhtmlFor="([^"]+)"/g)]
      .map(m => m[1])
      .filter(id => !declarados.has(id));
    assert.deepEqual(huerfanos, [], `htmlFor sin id en ${archivo}`);
  }
});

test('la app declara el idioma correcto y un titulo real', () => {
  const html = readFileSync(join(SRC, '..', 'index.html'), 'utf8');
  // lang="en" hacia que los lectores de pantalla pronunciaran en ingles una app
  // entera en espanol.
  assert.match(html, /<html lang="es"/);
  assert.doesNotMatch(html, /<title>asistencia-app<\/title>/);
});

test('los campos de la tabla clinica distinguen ojo derecho de izquierdo', () => {
  const fuente = leer('Clinica.jsx');
  // Sin esto los 20 campos de la tabla de refraccion eran indistinguibles.
  assert.match(fuente, /ojo derecho/);
  assert.match(fuente, /ojo izquierdo/);
});

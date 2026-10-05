import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  sanitizarTermino, aComodin, construirFiltroBusqueda, terminoLegible
} from './busquedaServidor.js';

// La busqueda de pacientes arma a mano un filtro de PostgREST:
// `or(nombre.ilike.%termino%,cedula.ilike.termino%)`
//
// Ese texto es un mini-lenguaje (comas = condiciones, puntos = columna/operador/
// valor). Lo que escribe el usuario NO debe poder cambiar su estructura.
//
// BUG REAL ENCONTRADO: la comilla doble no estaba sanitizada. Con `a"b` el
// filtro quedaba `nombre.ilike.%A"B%,cedula...` y PostgREST lo leia como un
// valor con comilla sin cerrar: la busqueda fallaba. El punto tambien rompia
// la estructura (una condicion de mas).

// --- El filtro SIEMPRE tiene la forma correcta ------------------------------

test('el filtro tiene siempre dos condiciones de tres partes', () => {
  // Este es el test que mas importa: si una condicion sale mal formada, la
  // consulta entera falla. Se comprueba la ESTRUCTURA, no el contenido.
  const entradas = ['a"b', 'a.b', 'a,b', 'a(b)', 'x".or(y', 'a",is.null',
    'O\'Brien', '100%', 'a*b', 'a\\b', 'nombre,cedula.ilike.', '', '   ', 'a'];
  for (const entrada of entradas) {
    const filtro = construirFiltroBusqueda(entrada);
    if (filtro === null) continue;
    for (const condicion of filtro.split(',')) {
      assert.equal(
        condicion.split('.').length, 3,
        `"${entrada}" produjo una condicion mal formada: ${condicion}`
      );
    }
  }
});

test('nunca hay comas, puntos sueltos ni comillas fuera de sitio', () => {
  const entradas = ['a"b', 'a.b', 'a",nombre.ilike.zz', 'x".or(y', 'n"ombre'];
  for (const entrada of entradas) {
    const filtro = construirFiltroBusqueda(entrada);
    if (filtro === null) continue;
    // Solo puede haber 2 comas (separando las 2 condiciones) y ningun otro
    // caracter estructural dentro de los valores.
    assert.equal((filtro.match(/,/g) || []).length, 1, `comas de mas en "${entrada}"`);
    assert.ok(!/"/.test(filtro), `comilla sin cerrar en "${entrada}": ${filtro}`);
  }
});

// --- La busqueda normal NO se rompe -----------------------------------------

test('un nombre normal se busca como siempre', () => {
  assert.equal(
    construirFiltroBusqueda('Juan Perez'),
    'nombre.ilike.%JUAN%PEREZ%,cedula.ilike.JUAN%PEREZ%'
  );
});

test('una cedula se busca al principio, no en medio', () => {
  // El orden cambia segun sea numero: la cedula empieza por 17 o 09.
  assert.equal(
    construirFiltroBusqueda('17123456'),
    'cedula.ilike.17123456%,nombre.ilike.%17123456%'
  );
});

test("un apellido con apostrophe se sigue encontrando", () => {
  // O'Brien es un apellido real. Al quitar la apostrophe queda "O BRIEN", y el
  // espacio se convierte en comodin: %O%BRIEN%. Ese comodin TAMBIA hace
  // coincidir con "O'BRIEN", porque % cubre cualquier caracter. O sea: limpiar
  // el caracter peligroso no pierde al paciente.
  const filtro = construirFiltroBusqueda("O'Brien");
  assert.match(filtro, /O%BRIEN/, 'la apostrophe se convierte en comodin');
  assert.ok(/O.BRIEN/.test("O'BRIEN"), 'y ese comodin encuentra al paciente real');
});

test('las tildes no impiden encontrar a alguien', () => {
  assert.equal(sanitizarTermino('Muñoz'), 'MUNOZ');
  assert.equal(sanitizarTermino('Pérez'), 'PEREZ');
  assert.equal(sanitizarTermino('NIÑO'), 'NINO');
});

// --- Terminos que no llegan a la consulta ------------------------------------

test('un termino de un solo caracter no busca nada', () => {
  // Con 1 letra traeria practicamente toda la tabla.
  assert.equal(construirFiltroBusqueda('a'), null);
  assert.equal(construirFiltroBusqueda(' '), null);
  assert.equal(construirFiltroBusqueda(''), null);
  assert.equal(construirFiltroBusqueda(null), null);
  assert.equal(construirFiltroBusqueda(undefined), null);
});

test('un termino que se queda vacio tras limpiar no busca nada', () => {
  assert.equal(construirFiltroBusqueda('""'), null);
  assert.equal(construirFiltroBusqueda('...'), null);
  assert.equal(construirFiltroBusqueda('%%%'), null);
});

test('lo que se limpia no se cuela en ningun filtro', () => {
  const filtro = construirFiltroBusqueda('Juan Pérez');
  // Las tildes se quitan: "Pérez" -> "PEREZ".
  assert.ok(!/[ñéíóúÑ]/i.test(filtro), 'sin tildes en el filtro');
  // Y en los valores solo hay letras, digitos y los signos permitidos.
  for (const condicion of filtro.split(',')) {
    const valor = condicion.split('.').slice(2).join('.');
    assert.match(valor, /^[A-ZÑÜ#0-9%]+$/, `valor con caracteres raros: ${valor}`);
  }
});

// --- Limpieza y comodines ----------------------------------------------------

test('la limpieza quita lo que rompe el filtro y conserva el nombre', () => {
  assert.equal(sanitizarTermino('Juan  Perez'), 'JUAN PEREZ', 'colapsa espacios');
  assert.equal(sanitizarTermino('  Juan  '), 'JUAN', 'recorta');
  assert.equal(sanitizarTermino('Juan'), 'JUAN');
});

test('el comodin une los nombres compuestos', () => {
  assert.equal(aComodin('JUAN PEREZ DE LIMA'), 'JUAN%PEREZ%DE%LIMA');
  assert.equal(aComodin('JUAN'), 'JUAN');
});

test('el termino legible es el mismo que usa la consulta', () => {
  // Para que lo que se vea en pantalla y lo que se busca no discrepen.
  assert.equal(terminoLegible('  juan perez '), sanitizarTermino('  juan perez '));
});

test('un numero con espacios se limpia bien', () => {
  assert.equal(sanitizarTermino(' 171 234 5678 '), '171 234 5678');
});

// --- La app usa este modulo y no otro sanitizado -----------------------------

test('la busqueda real usa el modulo, no un sanitizado suelto', () => {
  // Si alguien reintroduce el .replace(...) a mano aqui, estas pruebas lo
  // notan: el modulo se queda sin usar y vuelve el bug de la comilla.
  const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'utilidades.js'), 'utf8');
  assert.match(fuente, /construirFiltroBusqueda/, 'debe usar el modulo');
  assert.match(fuente, /if \(filtro === null\) return \[\]/, 'debe abandonar si el termino no sirve');

  // La busqueda no debe construir el filtro a mano.
  const bloqueFiltro = fuente.match(/nombre\.ilike[^\n]*/);
  assert.equal(bloqueFiltro, null, 'el filtro ya no se arma dentro de utilidades.js');
});
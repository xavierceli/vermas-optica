import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  MAX_ERRORES, agregarError, borrarErrores, describirError, detalleTecnicoError, leerErrores,
  normalizarError,
  registrarError, resumenErrores, textoDiagnostico
} from './registroErrores.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)));
const leer = nombre => readFileSync(join(SRC, nombre), 'utf8');

// La app es offline-first: los datos viven en IndexedDB. Si un componente
// revienta al dibujarse, React borra el arbol y el optometria se queda con una
// pantalla en blanco: los datos siguen ahi, pero sin forma de llegar a ellos.
// Estos tests fijan que esa situacion no pueda volver a darse.

const crearMeta = () => {
  const filas = new Map();
  return {
    put: async fila => { filas.set(fila.key, fila); },
    get: async key => filas.get(key),
    delete: async key => { filas.delete(key); }
  };
};

test('un error se guarda y se vuelve a leer', async () => {
  const meta = crearMeta();
  await registrarError(meta, new Error("No se puede leer la properties de undefined"), 'Inventario');
  const errores = await leerErrores(meta);
  assert.equal(errores.length, 1);
  assert.match(errores[0].mensaje, /properties de undefined/);
  assert.equal(errores[0].donde, 'Inventario');
});

test('los errores repetidos se agrupan en vez de llenar el historial', async () => {
  const meta = crearMeta();
  for (let i = 0; i < 5; i += 1) await registrarError(meta, new Error('Fallo repetido'), 'Clinica');
  const errores = await leerErrores(meta);
  assert.equal(errores.length, 1, 'cinco errores iguales son un error, no cinco');
  assert.equal(errores[0].repeticiones, 5);
});

test('el historial esta acotado y conserva lo mas reciente', async () => {
  const meta = crearMeta();
  for (let i = 0; i < MAX_ERRORES + 10; i += 1) await registrarError(meta, new Error(`Fallo ${i}`));
  const errores = await leerErrores(meta);
  assert.equal(errores.length, MAX_ERRORES);
  assert.equal(errores[0].mensaje, `Fallo ${MAX_ERRORES + 9}`);
});

test('borrarErrores deja el historial limpio', async () => {
  const meta = crearMeta();
  await registrarError(meta, new Error('Fallo'));
  await borrarErrores(meta);
  assert.deepEqual(await leerErrores(meta), []);
});

test('el resumen es una linea legible, no un volcado de datos', () => {
  assert.equal(resumenErrores([]), 'Sin errores registrados');
  assert.equal(resumenErrores([describirError(new Error('Se rompio'))]), 'Se rompio');
  const repetido = agregarError([describirError(new Error('Se rompio'))], describirError(new Error('Se rompio')));
  assert.match(resumenErrores(repetido), /x2/);
});

test('el diagnostico incluye lo justo para pedir ayuda', () => {
  const texto = textoDiagnostico({
    errores: [describirError(new Error('Se rompio'), 'Inventario')],
    pendientes: 3,
    version: 'ABC123'
  });
  assert.match(texto, /ABC123/);
  assert.match(texto, /Operaciones en cola: 3/);
  assert.match(texto, /Inventario: Se rompio/);
});

test('un error sin mensaje ni pila no rompe el registro', () => {
  const d = describirError(undefined, 'X');
  assert.equal(d.mensaje, 'Sin mensaje');
  assert.ok(d.hora);
});

// --- La pantalla en blanco no puede volver -------------------------------

test('la app se dibuja dentro de un ErrorBoundary', () => {
  const fuente = leer('main.jsx');
  assert.ok(fuente.includes('<ErrorBoundary'), 'main.jsx debe envolver la app');
  assert.ok(fuente.includes('instalarCapturaGlobal()'), 'debe instalarse la captura global');
});

test('cada vista se dibuja dentro de su propio ErrorBoundary', () => {
  const fuente = leer('App.jsx');
  assert.ok(
    /<ErrorBoundary[^>]*clave=\{g\.vistaActual\}/.test(fuente),
    'el borde debe depender de la vista: asi al cambiar de seccion se olvida el error'
  );
  assert.match(fuente, /import\('\.\/Historial\.jsx'\)/,
    'Historial necesita extension explicita porque existe historial.js con distinto uso de mayusculas');
});

test('el panel ofrece salidas claras y NUNCA borra datos', () => {
  const fuente = leer('ErrorBoundary.jsx');
  assert.ok(fuente.includes('role="alert"'), 'debe anunciarse a un lector de pantalla');
  for (const salida of ['Reintentar', 'Recargar la página', 'Copiar diagnóstico']) {
    assert.ok(fuente.includes(salida), 'falta la salida: ' + salida);
  }
  assert.ok(
    !/resetLocalDatabase|localDb\.delete|\.clear\(\)/.test(fuente),
    'el panel no puede borrar datos ni vaciar la cola de salida'
  );
});

test('un error lanzado con objeto no estándar se puede registrar y mostrar sin provocar otro fallo', () => {
  const objeto = Object.create(null);
  objeto.message = 'No se pudo cargar el módulo';
  assert.equal(normalizarError(objeto).message, 'No se pudo cargar el módulo');
  assert.equal(describirError(objeto).mensaje, 'No se pudo cargar el módulo');
  assert.equal(detalleTecnicoError(Object.create(null)), 'Error con formato inesperado (object).');
});

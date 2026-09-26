import test from 'node:test';
import assert from 'node:assert/strict';
import { paginarConsulta } from './paginacion.js';

// Simula la vista: N pacientes ordenados, servidos en paginas de `pageSize`.
const crearVista = (total, { inestables = false } = {}) => {
  const filas = Array.from({ length: total }, (_, i) => ({
    id: `consulta-${String(i).padStart(4, '0')}`,
    cedula: `17123456${String(i).padStart(3, '0')}`,
    nombre: `Paciente ${i}`
  }));
  return async (desde, limite) => {
    // Orden inestable: dos filas con la misma "fecha" pueden intercambiarse entre
    // peticiones, que es justo lo que hace la vista real con DISTINCT ON.
    if (inestables) filas.sort((a, b) => (a.id.charCodeAt(10) % 2) - (b.id.charCodeAt(10) % 2));
    return filas.slice(desde, desde + limite);
  };
};

test('descarga mas de 100 filas (el limite que dejaba pacientes invisibles)', async () => {
  const resultado = await paginarConsulta({ fetchPagina: crearVista(450), pageSize: 200 });
  assert.equal(resultado.filas.length, 450);
  assert.equal(resultado.paginasDescargadas, 3);
});

test('se detiene en la ultima pagina parcial', async () => {
  const resultado = await paginarConsulta({ fetchPagina: crearVista(250), pageSize: 100 });
  assert.equal(resultado.filas.length, 250);
  assert.equal(resultado.paginasDescargadas, 3, 'la tercera pagina vino incompleta y debe cerrar el recorrido');
});

test('respeta el tope de paginas para no descargar infinitamente', async () => {
  let llamadas = 0;
  const resultado = await paginarConsulta({
    pageSize: 100,
    maxPaginas: 3,
    fetchPagina: async (desde, limite) => {
      llamadas += 1;
      return Array.from({ length: limite }, (_, i) => ({ id: `x-${desde + i}` }));
    }
  });
  assert.equal(llamadas, 3, 'no debe superar maxPaginas');
  assert.equal(resultado.filas.length, 300);
});

test('se detiene si la vista devuelve una pagina sin filas nuevas', async () => {
  let llamadas = 0;
  const resultado = await paginarConsulta({
    pageSize: 50,
    maxPaginas: 20,
    fetchPagina: async () => {
      llamadas += 1;
      // Simula un orden inestable: siempre la misma pagina.
      return [{ id: 'a' }, { id: 'b' }];
    }
  });
  assert.equal(llamadas, 1, 'debe abandonar en vez de repetir la misma pagina 20 veces');
  assert.equal(resultado.filas.length, 2);
});

test('deduplica filas repetidas entre paginas', async () => {
  const resultado = await paginarConsulta({
    pageSize: 3,
    maxPaginas: 5,
    fetchPagina: async desde => {
      if (desde === 0) return [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      if (desde === 3) return [{ id: 'c' }, { id: 'd' }];
      return [];
    }
  });
  assert.equal(resultado.filas.length, 4);
  assert.deepEqual(resultado.filas.map(f => f.id), ['a', 'b', 'c', 'd']);
});

test('una vista vacia no lanza ni devuelve paginas', async () => {
  const resultado = await paginarConsulta({ fetchPagina: async () => [], pageSize: 100 });
  assert.equal(resultado.filas.length, 0);
  assert.equal(resultado.paginasDescargadas, 0);
});

test('un error de red se propaga para que el sync lo reporte', async () => {
  await assert.rejects(
    () => paginarConsulta({
      pageSize: 10,
      fetchPagina: async () => { throw new Error('sin conexion'); }
    }),
    /sin conexion/
  );
});

test('informa cada pagina descargada para poder mostrar progreso', async () => {
  const vistas = [];
  await paginarConsulta({
    pageSize: 2,
    fetchPagina: crearVista(5),
    onPagina: (lote, indice) => vistas.push({ indice, cantidad: lote.length })
  });
  assert.deepEqual(vistas, [{ indice: 0, cantidad: 2 }, { indice: 1, cantidad: 2 }, { indice: 2, cantidad: 1 }]);
});
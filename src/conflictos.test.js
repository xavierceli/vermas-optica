import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATEGORIAS_CONFLICTO,
  categoriaDeConflicto,
  etiquetaDeNavegador,
  resumirConflictos
} from './conflictos.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = ruta => readFileSync(join(RAIZ, ruta), 'utf8');

test('un rechazo de stock se cuenta como stock, no como otro', () => {
  assert.equal(
    categoriaDeConflicto('Stock insuficiente para el armazón 2905', 'CREAR_VENTA'),
    'stock'
  );
  assert.equal(categoriaDeConflicto('23514: excede el stock disponible', 'CREAR_VENTA'), 'stock');
});

test('un conflicto de venta sin detalle se atribuye a stock', () => {
  // El servidor a veces responde status 'conflict' con un texto genérico. Una
  // venta que choca solo puede hacerlo por inventario, así que no debe caer en
  // "otros" y perderse en el resumen.
  assert.equal(categoriaDeConflicto('Conflicto de datos', 'CREAR_VENTA'), 'stock');
  assert.equal(categoriaDeConflicto('', 'UPSERT_INVENTARIO'), 'stock');
});

test('un choque de versión clínica se distingue del de una venta', () => {
  const motivo = 'La evaluación clínica fue modificada en otro dispositivo (servidor 7, local 5).';
  assert.equal(categoriaDeConflicto(motivo, 'GUARDAR_CONSULTA'), 'version_clinica');
  assert.equal(categoriaDeConflicto('40001 could not serialize access', 'GUARDAR_CONSULTA'), 'version_clinica');

  assert.equal(
    categoriaDeConflicto('La venta fue modificada en otro dispositivo (servidor 3, local 1).', 'EDITAR_VENTA'),
    'version_venta'
  );
});

test('una ficha clínica con conflicto genérico se atribuye a versión clínica', () => {
  assert.equal(categoriaDeConflicto('Conflicto de datos', 'GUARDAR_CONSULTA'), 'version_clinica');
  assert.equal(categoriaDeConflicto('Conflicto de datos', 'ARCHIVAR_CONSULTA'), 'version_clinica');
});

test('lo que no se reconoce no se inventa: cae en otros', () => {
  assert.equal(categoriaDeConflicto('Permiso denegado', 'REGISTRAR_PAGO'), 'otro');
  assert.equal(categoriaDeConflicto(null, null), 'otro');
});

test('el resumen separa versión clínica de stock y agrupa por equipo', () => {
  const eventos = [
    { categoria: 'version_clinica', equipoId: 'a', equipo: 'Chrome en Windows', usuario: 'ana@vermas' },
    { categoria: 'version_clinica', equipoId: 'a', equipo: 'Chrome en Windows', usuario: 'ana@vermas' },
    { categoria: 'stock', equipoId: 'a', equipo: 'Chrome en Windows', usuario: 'ana@vermas' },
    { categoria: 'stock', equipoId: 'b', equipo: 'Safari en macOS', usuario: 'luis@vermas' },
    { categoria: 'otro', equipoId: 'b', equipo: 'Safari en macOS', usuario: 'luis@vermas' }
  ];

  const resumen = resumirConflictos(eventos);
  assert.equal(resumen.total, 5);
  assert.equal(resumen.porCategoria.version_clinica, 2);
  assert.equal(resumen.porCategoria.stock, 2);
  assert.equal(resumen.porCategoria.version_venta, 0);
  assert.equal(resumen.porCategoria.otro, 1);

  assert.equal(resumen.porEquipo.length, 2);
  assert.equal(resumen.porEquipo[0].equipoId, 'a');
  assert.equal(resumen.porEquipo[0].total, 3);
  assert.equal(resumen.porEquipo[1].equipoId, 'b');
  assert.equal(resumen.porEquipo[1].total, 2);
});

test('el resumen deduce la categoria si el evento no la trae', () => {
  const resumen = resumirConflictos([
    { motivo: 'Stock insuficiente', tipoOperacion: 'CREAR_VENTA', equipoId: 'a' },
    { motivo: 'La evaluación clínica fue modificada en otro dispositivo', tipoOperacion: 'GUARDAR_CONSULTA', equipoId: 'a' }
  ]);
  assert.equal(resumen.porCategoria.stock, 1);
  assert.equal(resumen.porCategoria.version_clinica, 1);
});

test('una lista vacía o con datos raros no rompe el resumen', () => {
  for (const entrada of [null, undefined, [], [null], ['texto'], [{}, 42]]) {
    const resumen = resumirConflictos(entrada);
    assert.equal(typeof resumen.total, 'number');
    assert.ok(resumen.porCategoria);
    assert.ok(Array.isArray(resumen.porEquipo));
  }
  assert.equal(resumirConflictos(null).total, 0);
});

test('el equipo se identifica por navegador y sistema, sin datos personales', () => {
  assert.equal(
    etiquetaDeNavegador('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'),
    'Chrome en Windows'
  );
  assert.equal(
    etiquetaDeNavegador('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'),
    'Safari en macOS'
  );
  assert.equal(
    etiquetaDeNavegador('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'),
    'Chrome en Android'
  );
  assert.equal(etiquetaDeNavegador(''), 'Equipo sin identificar');
});

test('cada categoria tiene etiqueta visible en el panel', () => {
  for (const clave of Object.keys(CATEGORIAS_CONFLICTO)) {
    assert.ok(CATEGORIAS_CONFLICTO[clave].etiqueta);
    assert.ok(CATEGORIAS_CONFLICTO[clave].descripcion);
  }
});

test('el motor registra los conflictos con su operacion y motivo', () => {
  const motor = leer('src/syncEngine.js');
  assert.match(motor, /import\s*\{\s*registrarConflicto\s*\}\s*from\s*'\.\/registroConflictos'/);
  const llamadas = motor.match(/registrarConflicto\(/g) || [];
  assert.ok(llamadas.length >= 2, 'deben registrarse tanto el conflicto del servidor como el clasificado');
  assert.match(motor, /registrarConflicto\(\{\s*operation,\s*motivo/);
});

test('el registro limita el historial y guarda equipo y usuario', () => {
  const registro = leer('src/registroConflictos.js');
  assert.match(registro, /MAX_EVENTOS\s*=\s*200/);
  assert.match(registro, /RETENCION_MS\s*=\s*90/);
  assert.match(registro, /equipoId:/);
  assert.match(registro, /usuario:/);
  assert.match(registro, /operacionId:/);
});

test('el panel muestra el resumen por tipo y por equipo', () => {
  const panel = leer('src/PanelSincronizacion.jsx');
  assert.match(panel, /Resumen de conflictos/);
  assert.match(panel, /CATEGORIAS_CONFLICTO/);
  assert.match(panel, /porCategoria/);
  assert.match(panel, /resumenVisible\.equipo/);
  assert.match(panel, /obtenerResumenConflictos/);
});

test('el gestor expone el resumen y la sesión guarda el correo', () => {
  assert.match(leer('src/useGestor.js'), /obtenerResumenConflictos/);
  assert.match(leer('src/hooks/useAutenticacion.js'), /usuarioEmail/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PanelSincronizacion.jsx'), 'utf8');
const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8');

test('descartar siempre libera los botones aunque la operación falle', () => {
  const inicio = fuente.indexOf('const descartar = async op => {');
  const fin = fuente.indexOf('\n  };', inicio);
  assert.notEqual(inicio, -1, 'debe existir la acción para descartar');
  const accion = fuente.slice(inicio, fin);
  assert.match(accion, /finally\s*\{\s*setTrabajando\(false\);\s*\}/);
  assert.match(accion, /catch\s*\{[\s\S]*?setErrorPanel\(/);
});

test('el panel explica la conexión y muestra la sincronización más reciente de la sesión', () => {
  assert.match(fuente, /Sin conexión: los cambios quedan guardados en este dispositivo/);
  assert.match(fuente, /Con conexión a internet/);
  assert.match(fuente, /Última sincronización en esta sesión/);
});

test('un error al consultar la cola se comunica en lugar de quedar sin explicación', () => {
  assert.match(fuente, /No se pudo consultar la cola de sincronización/);
  assert.match(fuente, /role="alert"/);
});

test('el panel de sincronización y respaldo siempre tiene un acceso visible', () => {
  const boton = app.match(/<button\s+type="button"\s+onClick=\{\(\) => setPanelSync\(true\)\}[\s\S]*?aria-label="Abrir sincronización y respaldo"[\s\S]*?<\/button>/);
  assert.ok(boton, 'debe existir un botón permanente que abra el panel');
  assert.match(boton[0], /Sincronización y respaldo/);
});

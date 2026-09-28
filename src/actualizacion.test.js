import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)));
const leer = nombre => readFileSync(join(SRC, nombre), 'utf8');

// Con registerType:'prompt' el service worker NO se activa solo: espera. Al
// pulsar "Actualizar" hay que activarlo (SKIP_WAITING) Y recargar la pagina.
//
// BUG REAL: el updateServiceWorker() de vite-plugin-pwa IGNORA su argumento y
// solo envia el mensaje SKIP_WAITING; nunca recarga. Y como el proyecto no usa
// clientsClaim(), el evento 'controlling' que la libreria escucha para recargar
// tampoco llega. Resultado: el boton se quedaba en "Actualizando..." para
// siempre, sin salida, y habia que cerrar sesion a mano.
//
// Estos tests fallan si alguien vuelve a confiar solo en la libreria.

test('activar la version nueva acaba recargando la pagina', () => {
  const fuente = leer('AvisoActualizacion.jsx');
  assert.ok(
    fuente.includes('window.location.reload()'),
    'tras activar el worker hay que recargar explicitamente: la libreria no lo hace'
  );
});

test('el boton de actualizar nunca queda bloqueado sin salida', () => {
  const fuente = leer('AvisoActualizacion.jsx');
  // Solo el boton "Ahora no" puede quedar deshabilitado mientras actualiza.
  const deshabilitados = fuente.match(/disabled=\{actualizando\}/g) || [];
  assert.equal(
    deshabilitados.length,
    1,
    'el boton de actualizar no puede quedar deshabilitado para siempre'
  );
  assert.ok(fuente.includes('Recargar ahora'), 'debe ofrecerse recargar a mano');
});

test('el worker en espera se activa sin depender de la libreria', () => {
  const fuente = leer('AvisoActualizacion.jsx');
  assert.ok(fuente.includes('getRegistration()'), 'debeverse el registro a mano');
  assert.ok(fuente.includes('SKIP_WAITING'), 'debe enviar SKIP_WAITING');
});

test('no se manda SKIP_WAITING al desmontar el componente', () => {
  const fuente = leer('AvisoActualizacion.jsx');
  assert.ok(
    !/return \(\) => \{[^}]*actualizar\(/s.test(fuente),
    'el cleanup no debe llamar a actualizar: registerSW no devuelve un "desregistrar"'
  );
});

test('si la recarga no llega, se avisa en vez de dejar el boton muerto', () => {
  const fuente = leer('AvisoActualizacion.jsx');
  assert.ok(fuente.includes('setFallo(true)'), 'debe existir un estado de fallo');
  assert.ok(
    /No se pudo activar la versi/i.test(fuente),
    'el fallo debe explicarse al usuario'
  );
});
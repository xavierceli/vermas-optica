import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  avisarAviso, avisarError, cerrarAviso, leerAviso, mostrarAviso, suscribirAvisos
} from './avisos.js';
import { esFalloDeRed } from './reglas.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)));
const leer = nombre => readFileSync(join(SRC, nombre), 'utf8');

// ---------------------------------------------------------------------------
// EL AVISO
// ---------------------------------------------------------------------------
test('mostrar un aviso lo entrega a quien esta suscrito', () => {
  let recibido = null;
  const baja = suscribirAvisos(v => { recibido = v; });
  mostrarAviso('Consulta guardada', 'success');
  assert.equal(recibido.mensaje, 'Consulta guardada');
  assert.equal(recibido.tipo, 'success');
  cerrarAviso();
  baja();
});

test('el aviso desaparece solo pasado el tiempo', async () => {
  mostrarAviso('Se va solo', 'success', 20);
  assert.ok(leerAviso());
  await new Promise(r => setTimeout(r, 40));
  assert.equal(leerAviso(), null, 'el toast no puede quedarse pegado para siempre');
  cerrarAviso();
});

test('un aviso nuevo sustituye al anterior en vez de apilarse', () => {
  mostrarAviso('Primero', 'success', 0);
  mostrarAviso('Segundo', 'error', 0);
  assert.equal(leerAviso().mensaje, 'Segundo');
  assert.equal(leerAviso().tipo, 'error');
  cerrarAviso();
  assert.equal(leerAviso(), null);
});

test('un mensaje vacio no crea un aviso en blanco', () => {
  assert.equal(mostrarAviso(''), null);
  assert.equal(mostrarAviso(null), null);
  assert.equal(leerAviso(), null);
});

test('cerrar a mano limpia el aviso y avisa a los suscriptores', () => {
  let ultimo = 'sin valor';
  const baja = suscribirAvisos(v => { ultimo = v; });
  mostrarAviso('Algo', 'warning', 0);
  cerrarAviso();
  assert.equal(ultimo, null);
  baja();
});

test('el atajo de error joins el detalle al mensaje', () => {
  avisarError('No se pudo guardar', 'disco lleno');
  assert.match(leerAviso().mensaje, /No se pudo guardar: disco lleno/);
  assert.equal(leerAviso().tipo, 'error');
  cerrarAviso();
  avisarAviso('Revisa el monto');
  assert.equal(leerAviso().tipo, 'warning');
  cerrarAviso();
});

test('un suscriptor que se rompe no impide que el aviso llegue a los demas', () => {
  let bueno = null;
  const baja1 = suscribirAvisos(() => { throw new Error('este suscriptor esta roto'); });
  const baja2 = suscribirAvisos(v => { bueno = v; });
  mostrarAviso('Aun asi debe verse', 'success', 0);
  assert.equal(bueno.mensaje, 'Aun asi debe verse');
  baja1(); baja2(); cerrarAviso();
});

// --- Cabeceras de seguridad y honestidad del sincronizador --------------
test('la app declara las cabeceras de seguridad que necesita', () => {
  const raiz = join(SRC, '..');
  const conf = JSON.parse(readFileSync(join(raiz, 'vercel.json'), 'utf8'));
  const todas = (conf.headers || []).flatMap(regla => (regla.headers || []).map(h => `${h.key}: ${h.value}`));
  for (const clave of [
    'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy',
    'Permissions-Policy', 'Strict-Transport-Security', 'Content-Security-Policy'
  ]) {
    assert.ok(todas.some(cabecera => cabecera.startsWith(clave + ':')), 'falta la cabecera ' + clave);
  }
  const csp = todas.find(c => c.startsWith('Content-Security-Policy:'));
  assert.match(csp, /script-src 'self'/, 'la CSP debe permitir los scripts propios');
  // 'unsafe-inline' en script-src anula la CSP por completo: cualquier texto que
  // se cuele en el DOM se ejecuta. Solo lo justificaba el <script> en linea de
  // las plantillas de impresion, que ya no existe (impresion.js usa alCargar).
  const scriptSrc = csp.split(';').map(d => d.trim()).find(d => d.startsWith('script-src'));
  assert.ok(
    !/unsafe-inline|unsafe-eval/.test(scriptSrc),
    `script-src no debe permitir ejecucion en linea: ${scriptSrc}`
  );
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  // El service worker cacheado es lo que hacia que el aviso de version nueva se
  // repitiera sin converger nunca.
  const sw = (conf.headers || []).find(regla => regla.source === '/sw.js');
  assert.ok(sw, 'falta la regla de /sw.js');
  assert.match(sw.headers.find(h => h.key === 'Cache-Control').value, /no-cache/);
});

test('el sincronizador avisa cuando el historial le queda incompleto', () => {
  const fuente = leer('syncEngine.js');
  assert.match(fuente, /historialParcial/, 'el estado debe llevar si el historial esta completo');
  // Un aviso que solo sale por consola no es un aviso: el optometria no la abre.
  assert.match(fuente, /status\.historialParcial = descargado\.paginasDescargadas >= MAX_PAGINAS_HISTORIAL/);
  assert.match(leer('App.jsx'), /Historial parcial/, 'la interfaz debe decirlo, no solo la consola');
});

// --- La cola de escritura del motor de sincronizacion ---------------------
test('el motor de sincronizacion no envuelve lo que YA pasa por la cola', () => {
  // markLocalOperationSynced y cacheServerHistorial ya se encolan dentro de
  // localRepository. Envolverlos aqui otra vez haria que la cola esperase a si
  // misma: TODO se quedaria colgado sin ningun error visible. Es la trampa mas
  // peligrosa de este archivo, asi que queda vigilada por test.
  const fuente = leer('syncEngine.js');
  const bloques = [...fuente.matchAll(/enColaEscritura\([\s\S]{0,400}?\)\s*[,;]/g)].map(m => m[0]);
  assert.ok(bloques.length > 0, 'deberia haber bloques encolados: si no hay ninguno, la guarda no comprueba nada');
  for (const bloque of bloques) {
    for (const yaEncolado of ['markLocalOperationSynced', 'cacheServerHistorial', 'cacheServerCatalog']) {
      assert.ok(
        !bloque.includes(yaEncolado),
        `enColaEscritura envuelve a ${yaEncolado}, que ya pasa por la cola: interbloqueo garantizado`
      );
    }
  }
});

test('el stock que reconcilia el servidor pasa por la cola', () => {
  // Lee, MODIFICA y escribe. Sin la cola, un cambio de precio o de stock hecho
  // por el optometria en ese instante se pierde con el valor viejo del servidor.
  const fuente = leer('syncEngine.js');
  const i = fuente.indexOf('const reconciliarStockVenta');
  assert.ok(i >= 0, 'no se encuentra reconciliarStockVenta');
  assert.ok(
    fuente.slice(i, i + 900).includes('enColaEscritura'),
    'la reconciliacion de stock debe ir por la cola de escritura'
  );
});

// --- Las plantillas de impresion y la CSP ---------------------------------
// Los comentarios hablan de <script> y de CDN, y no ejecutan nada: lo que se
// analiza es el codigo de verdad.
const codigo = nombre => leer(nombre)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('ninguna plantilla de impresion lleva un <script> en linea', () => {
  // Cada plantilla se escribe con document.write dentro de una ventana nueva. Un
  // <script> ahi es la unica excepcion que hacia falta en script-src, y con el
  // desaparecio la CSP puede cerrarse de verdad.
  const enLinea = [...codigo('impresiones.js').matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)].map(m => m[0]);
  assert.deepEqual(enLinea, [], `script en linea en una plantilla: ${enLinea.join(', ')}`);
});

test('las plantillas de impresion no cargan nada de un CDN', () => {
  // El codigo de barras venía de un CDN externo. Sin internet la etiqueta se
  // imprimia con el hueco del codigo y sin avisar: el try/catch se lo tragaba.
  // Ni el dominio ni ninguna URL externa, ni en codigo ni en los comentarios
  // HTML de la plantilla: si vuelve a aparecer, el test lo para.
  const fuente = codigo('impresiones.js');
  assert.ok(
    !/cdn\.jsdelivr\.net|unpkg\.com|cdnjs|googleapis/.test(fuente),
    'el generador de codigo de barras debe servirse desde /vendor, no desde un CDN'
  );
  const externos = [...fuente.matchAll(/https?:\/\/[^\s"')]+/g)]
    .map(m => m[0]).filter(u => !u.includes('w3.org'));
  assert.deepEqual(externos, [], `origen externo en una plantilla: ${externos.join(', ')}`);
});

test('el generador de codigo de barras esta en public/vendor', () => {
  // Si se borra o no se copia, la etiqueta se imprime sin barras: el fallo es
  // silencioso porque el SVG vacio es un documento valido.
  const vendor = join(SRC, '..', 'public', 'vendor', 'JsBarcode.all.min.js');
  assert.ok(existsSync(vendor), 'falta public/vendor/JsBarcode.all.min.js');
  assert.ok(statSync(vendor).size > 1000, 'el fichero de vendor parece vacio o truncado');
});

test('al cargar la ventana se imprime, y con un codigo de barras valido', () => {
  const fuente = leer('impresiones.js');
  assert.match(fuente, /const alCargar = \(win, fn\)/, 'falta el helper alCargar');
  // Cada plantilla debe imprimir al cargar; si no, el documento sale en blanco.
  const cierres = (fuente.match(/win\.document\.close\(\);/g) || []).length;
  const esperas = (fuente.match(/alCargar\(win, \(\) =>/g) || []).length;
  assert.equal(esperas, cierres, 'cada plantilla debe imprimir con alCargar tras cerrar el documento');
  assert.match(fuente, /win\.JsBarcode\('#barcode', codigoPlano/, 'el codigo se pasa por la API, no por un literal JS');
});

// --- El esquema de vercel.json, que es donde se rompio el despliegue --------
// ESTO NO ES COSA DEL AVISO, pero vive aqui porque vigila las mismas cabeceras.
//
// Vercel valida vercel.json contra un esquema ESTRICTO antes de construir nada.
// Cualquier clave que no exista ahi hace fallar el despliegue entero. Lo que
// paso: para dejar el porque de cada cabecera, se metio una clave "//" con un
// comentario. Build en verde, lint en verde, 238 tests en verde... y Vercel
// rechazando el fichero: "should NOT have additional property '//'". La app
// llego a publicarse con las cabeceras de hace semanas, sin que nadie lo viera.
//
// El porque de la CSP, entonces, vive aqui (JSON no admite comentarios):
//   - script-src 'self' y SIN unsafe-inline. Antes lo llevaba porque cada
//     plantilla de impresion llevaba su <script> en linea. Ese script era el
//     unico agujero de verdad: permitia ejecutar arbitrario dentro de un
//     documento impreso con datos reales de pacientes. AlCargar lo sustituyo.
//   - style-src SI lleva 'unsafe-inline', y es a proposito: las plantillas
//     imprimen con <style> dentro del documento y React pone estilos en linea.
//     Sin ahi no se imprime nada, y un <style> no ejecuta codigo.
//   - /sw.js nunca se cachea: si se sirve una copia vieja, la app no se
//     actualiza nunca y el aviso de version nueva se repite sin converger.
const CLAVES_VERCEL = new Set([
  '$schema', 'buildCommand', 'outputDirectory', 'installCommand', 'devCommand',
  'framework', 'ignoreCommand', 'public', 'regions', 'functions', 'headers',
  'redirects', 'rewrites', 'cleanUrls', 'trailingSlash', 'git', 'github',
  'gitlab', 'bitbucket'
]);
const CLAVES_REGLA = new Set(['source', 'headers', 'has', 'missing', 'continue']);
const CLAVES_CABECERA = new Set(['key', 'value']);

test('vercel.json solo usa claves que Vercel acepta', () => {
  const conf = JSON.parse(leer('../vercel.json'));
  const comprobarClaves = (obj, permitidas, donde) => {
    for (const clave of Object.keys(obj || {})) {
      assert.ok(
        permitidas.has(clave),
        `vercel.json${donde} tiene la clave "${clave}", que Vercel no admite: ` +
        'rechaza el despliegue ENTERO antes de construir. Sin build, sin lint y sin tests.'
      );
    }
  };
  comprobarClaves(conf, CLAVES_VERCEL, '');
  for (const [i, regla] of (conf.headers || []).entries()) {
    comprobarClaves(regla, CLAVES_REGLA, ` > headers[${i}]`);
    for (const [j, cabecera] of (regla.headers || []).entries()) {
      comprobarClaves(cabecera, CLAVES_CABECERA, ` > headers[${i}].headers[${j}]`);
    }
  }
});

test('vercel.json no esconde comentarios en claves "//"', () => {
  // El intento de documentar el fichero con una clave "//" es justo lo que
  // tumbaba el despliegue. Si alguien lo vuelve a intentar, que lo sepa aqui y
  // no en el panel de Vercel.
  const conf = JSON.parse(leer('../vercel.json'));
  assert.ok(
    !JSON.stringify(conf).includes('"//"'),
    'vercel.json no admite comentarios: pon la explicacion en avisos.test.js'
  );
});

// ---------------------------------------------------------------------------
// QUE LA APP NO SE DIGA "SINCRONIZADA" CUANDO NO HAY RED
// ---------------------------------------------------------------------------
test('un fallo de red se reconoce como falta de red', () => {
  // El aviso rojo de "Sin conexion" desaparecia: con el wifi del negocio
  // conectado a un router sin salida, navigator.onLine sigue diciendo true, el
  // fetch fallaba y la barra se quedaba en "Sincronizado / Nube al dia".
  assert.equal(esFalloDeRed(new TypeError('Failed to fetch')), true);
  assert.equal(esFalloDeRed(new Error('NetworkError when attempting to fetch resource')), true);
  assert.equal(esFalloDeRed(new Error('Tiempo agotado (10s) en aplicar_operaciones')), true);
  assert.equal(esFalloDeRed(new Error('Load failed')), true);
});

test('un rechazo del servidor NO se disfraza de falta de red', () => {
  // Si no, el optometria veria "Modo local" cuando el problema es que el servidor
  // le esta rechazando los datos, y no arreglaria nada.
  assert.equal(esFalloDeRed(new Error('violates check constraint "venta_positiva"')), false);
  assert.equal(esFalloDeRed(new Error('duplicate key value violates unique constraint')), false);
  assert.equal(esFalloDeRed(new Error('401 Unauthorized')), false);
});

test('el motor marca offline ante un fallo de red, y vuelve a online al responder', () => {
  // Las dos mitades. Sin la segunda, un solo fallo dejaba la app "Sin conexion"
  // para siempre: el evento 'online' del navegador no vuelve a dispararse si el
  // enlace nunca se llego a caer.
  const fuente = leer('syncEngine.js');
  assert.match(fuente, /esFalloDeRed\(error\)/, 'un fallo de red debe marcar la app como offline');
  assert.match(fuente, /status\.online = true;[\s\S]{0,80}status\.phase/, 'un ciclo completo debe devolver la app a online');
});

test('los items de una venta se reconstruyen antes de enviarla', () => {
  // BUG REAL: el payload se congelaba al crear la operacion. Arreglar el filtro
  // al guardar NO desbloqueaba la venta atascada, porque la operacion ya estaba en
  // la cola con el payload viejo y se reenviaba identica cada 30 s. La venta se
  // quedaba rechazada para siempre.
  const fuente = leer('syncEngine.js');
  const i = fuente.indexOf('const refrescarItemsDeVenta');
  const bloque = fuente.slice(i, i + 1200);
  assert.match(bloque, /saleItems\.where\('saleId'\)/,
    'los items deben salir de la venta local, no del payload congelado');
  assert.match(bloque, /inventoryId !== null/,
    'y solo los que tienen inventario resuelto');
  assert.match(bloque, /attempts: 0/,
    'con un payload nuevo hay que devolver los intentos: si no, una venta corregida a la cuarta se descarta sin subirse nunca');
});

test('un rechazo permanente no se reintenta cinco veces', () => {
  // "Item de venta invalido." es un dato malo, no un corte de red. Reintentar no
  // lo arregla: solo deja la barra roja semanas hasta que alguien pulse "Resolver".
  const fuente = leer('syncEngine.js');
  assert.match(fuente, /esRechazoPermanente/);
  const i = fuente.indexOf('const intentos = (operation.attempts || 0) + 1;');
  const bloque = fuente.slice(i, i + 460);
  assert.match(bloque, /esRechazoPermanente\(motivo\)/,
    'un rechazo permanente debe descartarse de inmediato');
});

test('nunca se envia un item de venta sin inventario resuelto', () => {
  // BUG REAL: al editar una venta y poner medidas, salia "Item de venta invalido."
  // El filtro dejaba pasar items con `inventario_id: null` (solo codigo), y el
  // servidor los rechaza con 22023. El optometria no tenia forma de saber que
  // el problema era un armazon sin correspondencia en el inventario.
  const fuente = leer('localRepository.js');
  const i = fuente.indexOf('items: resolvedItems');
  const bloque = fuente.slice(i, i + 420);
  assert.match(bloque, /filter\(item => item\.inventoryId !== null\)/,
    'solo deben salir los items con id de inventario resuelto');
  assert.ok(!/inventario_id: item\.inventoryId,[\s\S]{0,120}codigo: item\.inventoryId === null/.test(bloque),
    'no se debe enviar un item cuyo inventario_id pueda ser null');
});

test('imprimir no revienta si la ventana ya esta cargada', () => {
  // BUG REAL, visto en la consola del navegador: "ReferenceError: Cannot access
  // 'salvavidas' before initialization". Al imprimir desde OTRO navegador la
  // ventana llega ya cargada, se llamaba a la funcion de inmediato y esta
  // usaba una `const` declarada justo despues. Consecuencia: la impresion se
  // caia entera con un error en vez de imprimir.
  const fuente = leer('impresiones.js');
  const i = fuente.indexOf('const alCargar');
  const bloque = fuente.slice(i, i + 1200);
  assert.match(bloque, /let salvavidas = null/,
    'el temporizador debe declararse ANTES de poder usarse');
  const declara = bloque.indexOf('salvavidas = null');
  const usa = bloque.search(/salvavidas\s*=\s*setTimeout/);
  assert.ok(declara >= 0 && usa > declara, 'no se puede asignar antes de declarar');
  assert.match(bloque, /if \(salvavidas !== null\)/,
    'y debe limpiarse solo si llego a crearse');
});

test('un paciente archivado no se ofrece como coincidencia en Clinica', () => {
  // BUG REAL: se borro el paciente "PRUEBA", no aparecia en el Historial, pero al
  // escribir su cedula en Clinica ofrecia la coincidencia y RELLENABA sus datos:
  // un paciente borrado que hacia falta el mismo.
  const clinica = leer('Clinica.jsx');
  assert.match(clinica, /cedulasArchivadas/,
    'Clinica debe conocer las cedulas archivadas en este dispositivo');
  assert.match(clinica, /!borradas\.has\(normalizeCedula\(r\?\.cedula\)\)/,
    'y filtrar por ellas las sugerencias de la nube');
  // La nube no sabe que se archivó aqui: la vista no trae archived_at.
  const app = leer('../src/App.jsx');
  assert.match(app, /cedulasArchivadas=\{g\.cedulasArchivadas\}/,
    'el gestor debe pasarle la lista a Clinica');
});

test('el borrado de un paciente es un hecho del SERVIDOR, no del dispositivo', () => {
  // PREGUNTA DEL OPTOMETRIA: "¿por qué al entrar en otro navegador vuelven a salir
  // los pacientes que ya había eliminado?" Porque el borrado se guardaba solo en
  // el equipo que lo hizo. En un navegador nuevo, con la memoria vacía, el
  // historial se descargaba entero y los pacientes "PRUEBA" volvían a estar ahí.
  //
  // El arreglo: el pull PREGUNTA a la base qué cédulas están archivadas, y ese
  // dato se mezcla con el local. Un borrado pasa a valer en todos los equipos.
  const motor = leer('syncEngine.js');
  assert.match(motor, /leerCedulasArchivadasDelServidor/,
    'el sincronizador debe leer del servidor las cedulas archivadas');
  // `consultas_clinicas` NO tiene columna `cedula`: la cedula vive en el PACIENTE.
  // Pedirla a la consulta devuelve un error 42703 y, como este bloque traga los
  // errores a proposito, el fallo pasaba DESAPARECIDO: los pacientes borrados
  // seguian apareciendo igual. Este test existe para que no vuelva a pasar.
  assert.ok(
    !/from\('consultas_clinicas'\)[\s\S]{0,60}select\('cedula'\)/.test(motor),
    'cedula no existe en consultas_clinicas: hay que pasar por paciente_id y pacientes_perfil'
  );
  assert.match(motor, /from\('pacientes_perfil'\)[\s\S]{0,60}select\('cedula'\)/,
    'la cedula se lee de la tabla de pacientes');
  assert.match(motor, /\.is\('archived_at', null\)/,
    'y hay que distinguir las consultas VIVAS: un paciente sigue existiendo si tiene alguna viva');

  const repo = leer('localRepository.js');
  assert.match(repo, /getMeta\('cedulasArchivadasServidor', \[\]\)/,
    'el snapshot debe mezclar las archivadas del servidor con las locales');
});

test('eliminar un paciente archiva TODO su historial, no solo la ultima visita', () => {
  // BUG DE FONDO, encontrado al mirar los datos del paciente de prueba: 10
  // consultas, se archivaba 1. Las otras 9 seguian VIVAS en el servidor, asi que
  // el paciente existia de verdad y volvia a salir en cada sincronizacion. El
  // boton de la tarjeta solo escondia la visita que se estaba viendo.
  const fuente = leer('localRepository.js');
  const i = fuente.indexOf('const idsAArchivar = new Set');
  const bloque = fuente.slice(i, i + 1400);
  assert.match(bloque, /localDb\.consultations\.toArray\(\)/,
    'debe buscar TODAS las consultas del paciente, no solo la de la tarjeta');
  assert.match(bloque, /normalizeCedula\(c\.cedula\) === cedulaNormalizada/,
    'y archivarlas todas');
  assert.match(bloque, /row\.kind !== 'historial'/, 'incluidas las que solo viven en la copia del servidor');
  assert.match(bloque, /for \(const id of idsAArchivar\)/,
    'y encolarlas una a una: cada consulta necesita su propio ARCHIVAR_CONSULTA');
});

test('eliminar un paciente pide confirmacion y dice lo que hace', () => {
  // Antes era un boton sin confirmar: un toque de más y sin aviso. Y el mensaje
  // decia "Consulta archivada", que no es lo que hace: archiva todo el historial.
  const vista = leer('Historial.jsx');
  assert.match(vista, /confirmarAccion\(/, 'eliminar un paciente debe pedir confirmacion');
  assert.match(vista, /TODO su historial/, 'y el aviso debe decirlo claro');
  const gestor = leer('../src/useGestor.js');
  assert.match(gestor, /se archivó todo su historial/,
    'el mensaje de exito tambien debe decir que se archivo todo');
  assert.ok(!/mostrarToast\('Consulta archivada\.'/.test(gestor),
    '"Consulta archivada" hacia creer que solo se habia escondido una visita');
});

test('el archivado se reconoce en los dos idiomas', () => {
  // La app escribe `archivedAt` (camelCase) y la base devuelve `archived_at`
  // (snake_case). Mirar solo uno de los dos hacía que un borrado hecho en otro
  // equipo no ocultase nada aquí: la mitad de la causa de este bug.
  const repo = leer('localRepository.js');
  assert.match(repo, /archivada = fila => Boolean\(fila\?\.archivedAt \|\| fila\?\.archived_at\)/,
    'el archivado se debe reconocer en las dos grafias');
  assert.ok(!/!c\.archivedAt\b/.test(repo),
    'no se puede filtrar solo por la grafia local');
});

test('un fallo de red NO se cuenta como rechazo del servidor', () => {
  // BUG REAL, confirmado con una captura: sin internet la barra se ponia roja
  // diciendo "El servidor rechazo 1 operacion(es): Failed to fetch". El servidor
  // no habia rechazado nada: no llego a responder. Y como la barra prioriza
  // `fallos` sobre `esOffline`, el aviso de "Sin conexion" no se veia NUNCA.
  const fuente = leer('syncEngine.js');
  assert.match(fuente, /if \(esFalloDeRed\(motivo\)\)/,
    'un fallo de red debe detectarse al aplicar los resultados');
  assert.match(fuente, /marcarPendientePorRed/,
    'y la operacion debe quedar en espera, no rechazada');
});

test('un corte de internet NO gasta los intentos de la operacion', () => {
  // Si cada corte sumara un intento, una venta acabaria en 'descartada' por no
  // tener internet: se perderia el trabajo del optometria por una causa que no
  // es de los datos.
  const fuente = leer('syncEngine.js');
  const i = fuente.indexOf('const marcarPendientePorRed');
  const bloque = fuente.slice(i, i + 700);
  assert.match(bloque, /status: 'pending'/, 'debe quedar pendiente');
  assert.ok(!bloque.includes('attempts'), 'y no debe contar un intento mas');
});

test('la barra da prioridad a "sin conexion" sobre los fallos', () => {
  // El orden de los ternarios es lo que decide el color. Con `fallos` delante,
  // un "Failed to fetch" sin clasificar tapaba el aviso de red.
  const fuente = leer('../src/App.jsx');
  const color = fuente.slice(fuente.indexOf('const colorBarra'), fuente.indexOf('const colorBarra') + 320);
  assert.match(color, /esOffline[\s\S]*fallos\.length/, 'sin conexion debe evaluarse antes que los fallos');
});

test('una venta nueva no arrastra el armazon de la venta anterior', () => {
  // BUG REAL: el optometria abria el formulario de una segunda venta y el
  // armazon de la primera ya estaba puesto. Si no lo cambiaba, se vendia el
  // armazon equivocado y el precio se calculaba sobre el, en silencio.
  const fuente = leer('../src/useGestor.js');
  const i = fuente.indexOf('const esVentaNueva');
  const bloque = fuente.slice(i, i + 1900);
  assert.match(bloque, /CAMPOS_DE_LA_VENTA/, 'debe limpiar los campos de la venta');
  assert.match(bloque, /'codigo_armazon'/, 'empezando por el codigo de armazon');
  assert.match(bloque, /itemFormateado\[k\] = ''/, 'dejandolos en blanco');
  // Y los datos clinicos del paciente NO se tocan: son suyos, no de la venta.
  assert.ok(!bloque.includes('esfera_od'), 'no debe limpiar la refraccion del paciente');
});

test('las estadisticas se releen cuando el servidor recalcula, no solo al entrar', () => {
  // BUG REAL: con una venta nueva, "Ingresos Mes" no cambiaba hasta recargar la
  // app. El motor escribe 'remoteStats' en cada pull, pero la pantalla solo lo
  // copiaba al ENTRAR, y el sincronizador corre solo cada 30 s.
  const fuente = leer('../src/useGestor.js');
  assert.match(
    fuente,
    /\[ultimaSync\]|syncEstado\?\.lastSync/,
    'las stats deben releerse cuando termina una sincronizacion'
  );
  assert.match(fuente, /localDb\.meta\.get\('remoteStats'\)/,
    'y leerlas de la base local, que es donde el motor las deja');
});

test('imprimir no depende SOLO del evento load de la ventana', () => {
  // BUG REAL: sin internet, la etiqueta no imprimia NADA. El <script src> del
  // generador de codigo de barras no se resolvía y el evento 'load' de la
  // ventana nunca llegaba a dispararse, asi que el trabajo se quedaba colgado
  // para siempre. Una etiqueta sin barras es mejor que ninguna etiqueta.
  const fuente = leer('impresiones.js');
  assert.match(fuente, /ESPERA_MAX_SIN_LOAD_MS/,
    'debe existir un tope de espera para el caso de que load no llegue');
  assert.match(fuente, /setTimeout\([\s\S]{0,240}ESPERA_MAX_SIN_LOAD_MS/,
    'el salvavidas debe usar ese tope');
});

test('la etiqueta se imprime aunque el codigo de barras no se pueda dibujar', () => {
  // El fallo real de la etiqueta offline era un `catch` vacio: se comia el
  // error y la etiqueta salia con el hueco del codigo, sin decir nada. Ahora
  // avisa y, aun asi, imprime.
  const fuente = leer('impresiones.js');
  assert.match(fuente, /typeof win\.JsBarcode !== 'function'/,
    'debe comprobar si el generador esta disponible antes de usarlo');
  assert.match(fuente, /win\.print\(\)/, 'y debe imprimir igualmente');
  assert.ok(!/catch\s*\(\s*e\s*\)\s*\{\s*\}/.test(fuente),
    'ningun catch puede estar vacio: un fallo silencioso en una impresion es un fallo invisible');
});

test('el aviso de "Sin conexion" depende del motor, no de navigator.onLine', () => {
  // Es lo que fallaba: la barra se alimentaba de navigator.onLine, que dice
  // "conectado" con el wifi enganchado a un router sin salida.
  const fuente = leer('../src/App.jsx');
  assert.match(fuente, /esOffline = g\.syncEstado\?\.online === false/,
    'el aviso debe leer el estado que el motor deduce de si el servidor responde');
  assert.ok(
    !/navigator\.onLine/.test(fuente),
    'App.jsx no debe decidir la conexion con navigator.onLine: solo sabe si hay interfaz, no si hay internet'
  );
});

// ---------------------------------------------------------------------------
// Y QUE NO VUELVAN LOS ALERT DEL NAVEGADOR
// ---------------------------------------------------------------------------
test('ninguna pantalla vuelve a usar alert() ni window.confirm()', () => {
  // Es la regla que sostiene todo lo demas: alert() bloquea la pagina, no tiene
  // estilo y el confirm() corta el flujo. Para volver a usarlos hay que quitar
  // este test, y se veria en la revision.
  const culpables = [];
  for (const archivo of readdirSync(SRC).filter(f => /\.(js|jsx)$/.test(f))) {
    const fuente = leer(archivo);
    fuente.split('\n').forEach((linea, i) => {
      // Se ignoran los .test.js (comprueban el patron) y las lineas de comentario.
      if (archivo.endsWith('.test.js') || linea.trim().startsWith('//')) return;
      if (/(^|[^.\w])alert\s*\(/.test(linea) || /window\.confirm\s*\(/.test(linea)) {
        culpables.push(`${archivo}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(culpables, [], 'usa mostrarAviso()/avisarError(), no el alert del navegador: ' + culpables.join(', '));
});